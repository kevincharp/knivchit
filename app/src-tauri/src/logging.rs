use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_MAX_LOG_BYTES: u64 = 1024 * 1024;

/// Ruta por default del log, bajo el mismo directorio de datos que usará
/// `install.sh` (`KNIVCHIT_DATA_DIR`, default `~/.local/share/knivchit`).
pub fn default_log_path() -> PathBuf {
    let data_dir = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home).join(".local/share")
        });
    data_dir.join("knivchit").join("knivchit.log")
}

/// Instala el panic hook global: escribe una línea de metadata (nunca contenido
/// de `clipboard_history`, ni el mensaje del pánico) al archivo de log rotativo antes de que el proceso termine.
pub fn install_panic_hook(log_path: PathBuf, max_bytes: u64) {
    std::panic::set_hook(Box::new(move |info| {
        let line = format_panic_line(info);
        if let Err(e) = write_log_line(&log_path, max_bytes, &line) {
            eprintln!("knivchit: no se pudo escribir el log de panic: {e}");
        }
    }));
}

fn format_panic_line(info: &std::panic::PanicHookInfo) -> String {
    let location = info
        .location()
        .map(|l| format!("{}:{}", l.file(), l.line()))
        .unwrap_or_else(|| "ubicación desconocida".to_string());
    // Solo el TIPO del payload, nunca su texto: un `unwrap()` sobre un `Err`
    // con datos incluye esos datos en el mensaje, y podrían ser contenido del
    // portapapeles: el log nunca lleva contenido del historial.
    let payload_kind = if info.payload().is::<&str>() {
        "&str"
    } else if info.payload().is::<String>() {
        "String"
    } else {
        "otro"
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!(
        "[{timestamp}] knivchit {} panic en {location} (payload: {payload_kind})\n",
        env!("CARGO_PKG_VERSION")
    )
}

/// Escribe `line` al final del log, rotando primero si el archivo ya supera `max_bytes`.
fn write_log_line(log_path: &Path, max_bytes: u64, line: &str) -> std::io::Result<()> {
    if let Some(parent) = log_path.parent() {
        // Los directorios que cree el log nacen 0700; uno que ya exista no se toca.
        fs::DirBuilder::new().recursive(true).mode(0o700).create(parent)?;
    }
    rotate_if_needed(log_path, max_bytes)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(log_path)?;
    file.write_all(line.as_bytes())?;
    file.flush()
}

fn rotate_if_needed(log_path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let size = fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
    if size >= max_bytes {
        let rotated = PathBuf::from(format!("{}.1", log_path.display()));
        fs::rename(log_path, rotated)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::MetadataExt;

    fn temp_log_dir() -> PathBuf {
        std::env::temp_dir().join(format!("knivchit-logtest-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn panic_writes_nonempty_line_to_log_file() {
        let dir = temp_log_dir();
        let log_path = dir.join("knivchit.log");
        let previous_hook = std::panic::take_hook();
        install_panic_hook(log_path.clone(), DEFAULT_MAX_LOG_BYTES);

        let result = std::panic::catch_unwind(|| {
            panic!("panic de prueba");
        });
        // Regla 5: el mensaje (un `unwrap()` sobre un `Err` con contenido) no
        // debe llegar al log, ni como &str ni como String. Mismo test porque
        // el panic hook es global y los tests corren en paralelo.
        let secreto = "CONTENIDO-SECRETO-DEL-PORTAPAPELES";
        let r1 = std::panic::catch_unwind(|| panic!("{}", secreto));
        let r2 = std::panic::catch_unwind(|| {
            let r: Result<(), String> = Err(secreto.to_string());
            r.unwrap();
        });

        std::panic::set_hook(previous_hook);
        assert!(result.is_err() && r1.is_err() && r2.is_err());

        let contents =
            fs::read_to_string(&log_path).expect("el hook debia crear el archivo de log");
        assert!(!contents.trim().is_empty());
        assert!(!contents.contains(secreto), "el log filtró el mensaje: {contents}");
        assert!(!contents.contains("panic de prueba"));
        assert!(contents.contains("payload: &str") && contents.contains("payload: String"));
        assert!(contents.contains("logging.rs"), "lleva la ubicación");
        assert!(contents.contains(env!("CARGO_PKG_VERSION")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_file_is_private_and_its_knivchit_dir_too() {
        let dir = temp_log_dir().join("knivchit");
        let log_path = dir.join("knivchit.log");
        write_log_line(&log_path, DEFAULT_MAX_LOG_BYTES, "x\n").unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().mode() & 0o777;
        assert_eq!(mode(&log_path), 0o600);
        assert_eq!(mode(&dir), 0o700);
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn log_rotates_when_exceeding_max_size() {
        let dir = temp_log_dir();
        fs::create_dir_all(&dir).unwrap();
        let log_path = dir.join("knivchit.log");
        let max_bytes = 10;

        write_log_line(
            &log_path,
            max_bytes,
            "primera linea que supera el limite de tamano\n",
        )
        .unwrap();
        write_log_line(&log_path, max_bytes, "segunda linea\n").unwrap();

        let rotated_path = dir.join("knivchit.log.1");
        assert!(rotated_path.exists());
        let rotated_contents = fs::read_to_string(&rotated_path).unwrap();
        assert!(rotated_contents.contains("primera linea"));

        let current_contents = fs::read_to_string(&log_path).unwrap();
        assert!(current_contents.contains("segunda linea"));
        assert!(!current_contents.contains("primera linea"));

        let _ = fs::remove_dir_all(&dir);
    }
}
