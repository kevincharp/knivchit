//! Migración de datos del nombre anterior del producto (ViewClip → Knivchit).
//!
//! El identificador de Tauri cambió de `org.viewclip.app` a `org.knivchit.app`,
//! y con él el directorio de datos. Al primer arranque se COPIA (nunca se
//! mueve: el directorio viejo queda intacto como respaldo) el contenido del
//! directorio viejo al nuevo, renombrando la base `viewclip.db*` a `knivchit.db*`.
//!
//! Reglas de seguridad de la copia:
//!
//! - Con la instancia vieja ABIERTA no se migra (copiar una base SQLite viva
//!   da una copia incoherente sin error): `MigrationError::OldInstanceRunning`.
//! - Se copia a un directorio temporal único junto al nuevo; ahí se valida
//!   (`validate`: `integrity_check` y tabla `clipboard_history`, que hace
//!   `db::check_database`) y solo entonces se coloca en su sitio SIN pisar
//!   nada (`hard_link`): dos arranques simultáneos no se estorban.
//! - `-shm` no se copia (SQLite lo regenera). El orden de colocación es el
//!   resto de archivos, `-wal`, la base y, al final, el marcador
//!   `.migrated-from-viewclip`: un fallo a medias nunca deja la base sin su WAL.
//! - Directorios 0700 y archivos 0600; no se siguen enlaces simbólicos.
//!
//! Las referencias al nombre viejo de este archivo son a propósito.
//!
//! Aquí solo se cuentan archivos: jamás se registra el contenido de
//! `clipboard_history`. Este módulo no abre SQLite (solo copia bytes), así que
//! `db/` sigue siendo el único que lo abre.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Identificador de Tauri del nombre anterior (directorio de datos hermano del nuevo).
pub const LEGACY_IDENTIFIER: &str = "org.viewclip.app";
/// Nombre de bus de la app anterior: si tiene dueño, sigue abierta.
pub const LEGACY_BUS_NAME: &str = "org.viewclip.App";
const LEGACY_DB_NAME: &str = "viewclip.db";
const NEW_DB_NAME: &str = "knivchit.db";
/// Se escribe al final: «la migración terminó».
pub const MIGRATED_MARKER: &str = ".migrated-from-viewclip";

#[derive(Debug, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// No hay directorio viejo: instalación nueva.
    NothingToMigrate,
    /// Ya se migró, o el directorio nuevo ya tiene su base: no se toca.
    AlreadyInUse,
    /// Se colocaron `files` archivos del directorio viejo.
    Migrated { files: usize },
}

#[derive(Debug)]
pub enum MigrationError {
    /// La versión anterior sigue abierta: hay que cerrarla y reabrir.
    OldInstanceRunning,
    /// Los datos viejos no pasan la validación; no se migran (siguen intactos).
    InvalidOldDatabase(String),
    Io(io::Error),
}

impl MigrationError {
    /// Texto para el usuario. Nunca incluye contenido de la base.
    pub fn user_message(&self) -> String {
        match self {
            Self::OldInstanceRunning => {
                "Cierra ViewClip y reabre Knivchit: la versión anterior sigue abierta y sus datos no se pueden copiar con seguridad."
                    .to_string()
            }
            Self::InvalidOldDatabase(_) => {
                "Los datos de ViewClip no se pudieron validar y no se migraron; siguen intactos en su carpeta."
                    .to_string()
            }
            Self::Io(e) => format!("No se pudieron migrar los datos de ViewClip ({:?}).", e.kind()),
        }
    }
}

impl From<io::Error> for MigrationError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// Nombre que tendrá en el directorio nuevo un archivo del viejo: `viewclip.db`
/// y `viewclip.db-wal` pasan a `knivchit.db…`; el resto igual. (`-shm` no se copia.)
fn migrated_name(name: &str) -> String {
    match name.strip_prefix(LEGACY_DB_NAME) {
        Some(suffix) => format!("{NEW_DB_NAME}{suffix}"),
        None => name.to_string(),
    }
}

/// Crea `dir` (y padres) con modo 0700: el directorio de datos guarda el
/// historial del portapapeles. Uno que ya exista no se toca.
fn create_private_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)
}

/// Copia un archivo regular a `target` (nuevo, 0600, aunque el original fuera
/// más abierto). No sigue enlaces: `from` ya es un archivo regular.
fn copy_file_private(from: &Path, target: &Path) -> io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut input = fs::File::open(from)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(target)?;
    io::copy(&mut input, &mut output)?;
    output.flush()
}

/// `true` si ya hay ALGO en `path`, incluso un enlace simbólico roto.
fn occupied(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// `-shm` es un índice en memoria que SQLite regenera; copiarlo es inútil.
fn is_shm(name: &str) -> bool {
    name.strip_prefix(LEGACY_DB_NAME).is_some_and(|suffix| suffix == "-shm")
}

/// Copia `src` a `dst` (nuevo): archivos regulares y subdirectorios; nada más.
fn copy_tree(src: &Path, dst: &Path, top: bool) -> io::Result<()> {
    create_private_dir(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Enlaces simbólicos y archivos especiales se ignoran: nunca se sigue un enlace.
        if file_type.is_dir() {
            copy_tree(&entry.path(), &dst.join(&name), false)?;
        } else if file_type.is_file() {
            if top && is_shm(&name) {
                continue;
            }
            let target_name = if top { migrated_name(&name) } else { name };
            copy_file_private(&entry.path(), &dst.join(target_name))?;
        }
    }
    Ok(())
}

/// Archivos (rutas relativas) bajo `root`, en orden de colocación: primero el
/// resto, luego el `-wal` y por último la base (en la raíz).
fn placement_order(root: &Path) -> io::Result<Vec<PathBuf>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let ft = entry.file_type()?;
            if ft.is_dir() {
                walk(root, &entry.path(), out)?;
            } else if ft.is_file() {
                out.push(entry.path().strip_prefix(root).unwrap().to_path_buf());
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    let rank = |p: &PathBuf| match p.to_str() {
        Some(n) if n == NEW_DB_NAME => 2,
        Some(n) if n == format!("{NEW_DB_NAME}-wal") => 1,
        _ => 0,
    };
    files.sort_by_key(rank);
    Ok(files)
}

/// Coloca los archivos de `staging` en `new_dir` sin pisar nada: `hard_link`
/// falla si el destino existe (también un enlace roto), y entonces se salta.
fn place(staging: &Path, new_dir: &Path) -> io::Result<usize> {
    let mut placed = 0;
    for rel in placement_order(staging)? {
        let target = new_dir.join(&rel);
        if let Some(parent) = target.parent() {
            create_private_dir(parent)?;
        }
        match fs::hard_link(staging.join(&rel), &target) {
            Ok(()) => placed += 1,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
    }
    Ok(placed)
}

/// Borra el directorio temporal al salir, también ante un error.
struct Staging(PathBuf);

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// `true` si hay datos viejos que migrar: el directorio viejo existe (y no es
/// un enlace) y el nuevo no está migrado ni tiene ya su base.
pub fn needs_migration(old_dir: &Path, new_dir: &Path) -> bool {
    fs::symlink_metadata(old_dir).map(|m| m.is_dir()).unwrap_or(false)
        && !occupied(&new_dir.join(MIGRATED_MARKER))
        && !occupied(&new_dir.join(NEW_DB_NAME))
}

/// Migra `old_dir` a `new_dir` si hace falta. `old_running`: la versión
/// anterior sigue abierta (dueña de `LEGACY_BUS_NAME`). `validate` recibe la
/// ruta de la base ya copiada (en el directorio temporal) y decide si vale.
pub fn migrate_data_dir(
    old_dir: &Path,
    new_dir: &Path,
    old_running: bool,
    validate: impl Fn(&Path) -> Result<(), String>,
) -> Result<MigrationOutcome, MigrationError> {
    if !fs::symlink_metadata(old_dir).map(|m| m.is_dir()).unwrap_or(false) {
        return Ok(MigrationOutcome::NothingToMigrate);
    }
    if !needs_migration(old_dir, new_dir) {
        return Ok(MigrationOutcome::AlreadyInUse);
    }
    if old_running {
        return Err(MigrationError::OldInstanceRunning);
    }
    let parent = new_dir.parent().ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let new_name = new_dir.file_name().and_then(|n| n.to_str()).unwrap_or("data");
    let staging = Staging(parent.join(format!(".{new_name}.migrating-{}", uuid::Uuid::new_v4())));
    copy_tree(old_dir, &staging.0, true)?;

    let staged_db = staging.0.join(NEW_DB_NAME);
    if occupied(&staged_db) {
        validate(&staged_db).map_err(MigrationError::InvalidOldDatabase)?;
    }
    // Otro arranque pudo terminar mientras copiábamos.
    if !needs_migration(old_dir, new_dir) {
        return Ok(MigrationOutcome::AlreadyInUse);
    }
    create_private_dir(new_dir)?;
    let files = place(&staging.0, new_dir)?;
    // Marcador al final; si otro ya lo escribió, da igual.
    let _ = copy_file_private_marker(&new_dir.join(MIGRATED_MARKER));
    Ok(MigrationOutcome::Migrated { files })
}

fn copy_file_private_marker(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path).map(|_| ())
}

/// Directorio viejo hermano del nuevo (`…/org.viewclip.app` junto a `…/org.knivchit.app`).
pub fn legacy_dir_for(new_dir: &Path) -> Option<PathBuf> {
    Some(new_dir.parent()?.join(LEGACY_IDENTIFIER))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(_: &Path) -> Result<(), String> {
        Ok(())
    }

    fn scratch() -> PathBuf {
        let d = std::env::temp_dir().join(format!("knivchit-legacy-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn legacy_dir_is_a_sibling_of_the_new_one() {
        let new = Path::new("/home/u/.local/share/org.knivchit.app");
        assert_eq!(
            legacy_dir_for(new).unwrap(),
            Path::new("/home/u/.local/share/org.viewclip.app")
        );
    }

    #[test]
    fn copies_the_db_renamed_and_keeps_the_old_directory() {
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(old.join("sub")).unwrap();
        fs::write(old.join("viewclip.db"), b"base").unwrap();
        fs::write(old.join("viewclip.db-wal"), b"wal").unwrap();
        fs::write(old.join("sub/otro.bin"), b"x").unwrap();

        let out = migrate_data_dir(&old, &new, false, ok).unwrap();
        assert_eq!(out, MigrationOutcome::Migrated { files: 3 });
        assert_eq!(fs::read(new.join("knivchit.db")).unwrap(), b"base");
        assert_eq!(fs::read(new.join("knivchit.db-wal")).unwrap(), b"wal");
        assert_eq!(fs::read(new.join("sub/otro.bin")).unwrap(), b"x");
        assert!(!new.join("viewclip.db").exists());
        // copiar, no mover
        assert_eq!(fs::read(old.join("viewclip.db")).unwrap(), b"base");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn does_nothing_without_the_old_directory() {
        let root = scratch();
        let out = migrate_data_dir(&root.join("org.viewclip.app"), &root.join("org.knivchit.app"), false, ok).unwrap();
        assert_eq!(out, MigrationOutcome::NothingToMigrate);
        assert!(!root.join("org.knivchit.app").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_overwrites_a_database_already_in_the_new_directory() {
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("viewclip.db"), b"vieja").unwrap();
        fs::write(new.join("knivchit.db"), b"nueva").unwrap();

        assert_eq!(migrate_data_dir(&old, &new, false, ok).unwrap(), MigrationOutcome::AlreadyInUse);
        assert_eq!(fs::read(new.join("knivchit.db")).unwrap(), b"nueva");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_empty_new_directory_is_filled_without_touching_existing_files() {
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("viewclip.db"), b"vieja").unwrap();
        fs::write(old.join("ajustes.json"), b"viejo").unwrap();
        fs::write(new.join("ajustes.json"), b"nuevo").unwrap();

        migrate_data_dir(&old, &new, false, ok).unwrap();
        assert_eq!(fs::read(new.join("knivchit.db")).unwrap(), b"vieja");
        assert_eq!(fs::read(new.join("ajustes.json")).unwrap(), b"nuevo");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn symlinks_are_not_followed() {
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(&old).unwrap();
        fs::write(root.join("secreto"), b"s").unwrap();
        std::os::unix::fs::symlink(root.join("secreto"), old.join("enlace")).unwrap();
        fs::write(old.join("viewclip.db"), b"b").unwrap();

        let out = migrate_data_dir(&old, &new, false, ok).unwrap();
        assert_eq!(out, MigrationOutcome::Migrated { files: 1 });
        assert!(!new.join("enlace").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_copy_is_private_whatever_the_original_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(old.join("sub")).unwrap();
        fs::write(old.join("viewclip.db"), b"b").unwrap();
        fs::write(old.join("sub/x"), b"x").unwrap();
        for f in [old.join("viewclip.db"), old.join("sub/x")] {
            fs::set_permissions(f, fs::Permissions::from_mode(0o644)).unwrap();
        }

        migrate_data_dir(&old, &new, false, ok).unwrap();
        assert_eq!(mode(&new), 0o700);
        assert_eq!(mode(&new.join("sub")), 0o700);
        assert_eq!(mode(&new.join("knivchit.db")), 0o600);
        assert_eq!(mode(&new.join("sub/x")), 0o600);
        assert!(fs::read_dir(&new).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".part")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_broken_symlink_in_the_new_dir_is_not_replaced_or_followed() {
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("viewclip.db"), b"b").unwrap();
        fs::write(old.join("ajustes.json"), b"viejo").unwrap();
        let fuera = root.join("fuera-no-existe");
        std::os::unix::fs::symlink(&fuera, new.join("ajustes.json")).unwrap();

        migrate_data_dir(&old, &new, false, ok).unwrap();
        assert!(!fuera.exists(), "no escribió a través del enlace");
        assert!(fs::symlink_metadata(new.join("ajustes.json")).unwrap().file_type().is_symlink());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_symlinked_old_directory_is_not_followed() {
        let root = scratch();
        let real = root.join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("viewclip.db"), b"b").unwrap();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        std::os::unix::fs::symlink(&real, &old).unwrap();

        assert_eq!(migrate_data_dir(&old, &new, false, ok).unwrap(), MigrationOutcome::NothingToMigrate);
        assert!(!new.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failure_midway_never_leaves_the_main_db_without_its_wal() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch();
        let (old, new) = (root.join("org.viewclip.app"), root.join("org.knivchit.app"));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("viewclip.db"), b"b").unwrap();
        fs::write(old.join("viewclip.db-wal"), b"w").unwrap();
        // el -wal no se puede leer: la copia falla antes de la base principal
        fs::set_permissions(old.join("viewclip.db-wal"), fs::Permissions::from_mode(0o000)).unwrap();
        if fs::File::open(old.join("viewclip.db-wal")).is_ok() {
            fs::remove_dir_all(root).unwrap();
            return; // ejecutando como root: no se puede simular el fallo
        }

        assert!(migrate_data_dir(&old, &new, false, ok).is_err());
        assert!(!new.join("knivchit.db").exists(), "la base no debe haberse colocado");
        assert!(!new.join(MIGRATED_MARKER).exists());
        fs::set_permissions(old.join("viewclip.db-wal"), fs::Permissions::from_mode(0o600)).unwrap();
        // y un reintento completa la migración
        assert_eq!(migrate_data_dir(&old, &new, false, ok).unwrap(), MigrationOutcome::Migrated { files: 2 });
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;

    fn scratch() -> PathBuf {
        let d = std::env::temp_dir().join(format!("knivchit-legacy-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn ok(_: &Path) -> Result<(), String> {
        Ok(())
    }

    fn dirs(root: &Path) -> (PathBuf, PathBuf) {
        (root.join("org.viewclip.app"), root.join("org.knivchit.app"))
    }

    fn leftovers(root: &Path) -> Vec<String> {
        fs::read_dir(root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("migrating"))
            .collect()
    }

    #[test]
    fn an_old_instance_still_running_blocks_the_migration_and_creates_nothing() {
        let root = scratch();
        let (old, new) = dirs(&root);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("viewclip.db"), b"b").unwrap();

        let err = migrate_data_dir(&old, &new, true, ok).unwrap_err();
        assert!(matches!(err, MigrationError::OldInstanceRunning));
        assert!(err.user_message().contains("Cierra ViewClip y reabre Knivchit"));
        assert!(!new.exists() && leftovers(&root).is_empty());
        // cerrada la vieja, el siguiente arranque migra
        assert!(matches!(migrate_data_dir(&old, &new, false, ok), Ok(MigrationOutcome::Migrated { .. })));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shm_is_not_copied_and_the_marker_is_written_last() {
        let root = scratch();
        let (old, new) = dirs(&root);
        fs::create_dir_all(&old).unwrap();
        for f in ["viewclip.db", "viewclip.db-wal", "viewclip.db-shm"] {
            fs::write(old.join(f), b"x").unwrap();
        }
        migrate_data_dir(&old, &new, false, ok).unwrap();
        assert!(new.join("knivchit.db").exists() && new.join("knivchit.db-wal").exists());
        assert!(!new.join("knivchit.db-shm").exists());
        assert!(new.join(MIGRATED_MARKER).exists());
        assert_eq!(migrate_data_dir(&old, &new, false, ok).unwrap(), MigrationOutcome::AlreadyInUse);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_database_that_fails_validation_is_not_migrated_and_leaves_no_trace() {
        let root = scratch();
        let (old, new) = dirs(&root);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("viewclip.db"), b"basura").unwrap();

        let r = migrate_data_dir(&old, &new, false, |_| Err("integridad".into()));
        assert!(matches!(r, Err(MigrationError::InvalidOldDatabase(_))));
        assert!(!new.exists(), "no se creó el directorio nuevo");
        assert!(leftovers(&root).is_empty(), "sin temporales");
        assert_eq!(fs::read(old.join("viewclip.db")).unwrap(), b"basura");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn two_simultaneous_starts_end_with_one_complete_migration_and_no_errors() {
        let root = scratch();
        let (old, new) = dirs(&root);
        fs::create_dir_all(old.join("sub")).unwrap();
        fs::write(old.join("viewclip.db"), vec![7u8; 200_000]).unwrap();
        fs::write(old.join("viewclip.db-wal"), vec![8u8; 100_000]).unwrap();
        fs::write(old.join("sub/a"), b"a").unwrap();

        for _ in 0..20 {
            let _ = fs::remove_dir_all(&new);
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    let (old, new) = (old.clone(), new.clone());
                    std::thread::spawn(move || migrate_data_dir(&old, &new, false, ok))
                })
                .collect();
            for h in handles {
                assert!(h.join().unwrap().is_ok());
            }
            assert_eq!(fs::read(new.join("knivchit.db")).unwrap(), vec![7u8; 200_000]);
            assert_eq!(fs::read(new.join("knivchit.db-wal")).unwrap(), vec![8u8; 100_000]);
            assert_eq!(fs::read(new.join("sub/a")).unwrap(), b"a");
            assert!(new.join(MIGRATED_MARKER).exists());
            assert!(leftovers(&root).is_empty());
        }
        fs::remove_dir_all(root).unwrap();
    }

    // Con una base SQLite REAL (WAL, filas sin checkpoint) y la validación real
    // de `db::check_database`.
    #[tokio::test]
    async fn a_real_wal_database_migrates_with_all_its_rows() {
        use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
        let root = scratch();
        let (old, new) = dirs(&root);
        fs::create_dir_all(&old).unwrap();
        let pool = sqlx::SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(old.join("viewclip.db"))
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal),
        )
        .await
        .unwrap();
        sqlx::raw_sql(crate::db::migrations::migrations()[0].sql).execute(&pool).await.unwrap();
        for i in 0..50 {
            crate::db::insert_clipboard_entry(&pool, "text", &format!("fila {i}"), None).await.unwrap();
        }
        assert!(old.join("viewclip.db-wal").exists(), "hay WAL sin checkpoint");

        let (o, n) = (old.clone(), new.clone());
        let handle = tokio::runtime::Handle::current();
        let outcome = tokio::task::spawn_blocking(move || {
            migrate_data_dir(&o, &n, false, |p| handle.block_on(crate::db::check_database(p)))
        })
        .await
        .unwrap()
        .unwrap();
        assert!(matches!(outcome, MigrationOutcome::Migrated { .. }));
        pool.close().await;

        let migrated = crate::db::open_pool(&format!("sqlite:{}", new.join("knivchit.db").display()))
            .await
            .unwrap();
        let rows = crate::db::get_clipboard_history(&migrated, 1000).await.unwrap();
        assert_eq!(rows.len(), 50);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn check_database_rejects_garbage_and_a_database_without_the_history_table() {
        let root = scratch();
        let garbage = root.join("a.db");
        fs::write(&garbage, b"esto no es sqlite, ni de lejos, ni con 100 bytes de relleno ........").unwrap();
        assert!(crate::db::check_database(&garbage).await.is_err());

        let empty = root.join("b.db");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}?mode=rwc", empty.display())).await.unwrap();
        sqlx::query("CREATE TABLE otra (x INTEGER)").execute(&pool).await.unwrap();
        pool.close().await;
        let err = crate::db::check_database(&empty).await.unwrap_err();
        assert!(err.contains("clipboard_history"), "{err}");
        fs::remove_dir_all(root).unwrap();
    }
}
