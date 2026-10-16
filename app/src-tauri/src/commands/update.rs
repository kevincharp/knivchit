use std::time::Duration;

use serde::{Deserialize, Serialize};

const DEFAULT_API_BASE: &str = "https://api.github.com/repos/kevincharp/knivchit";

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
}

/// Campos de `GET /releases` que se usan; el resto se ignora.
#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    published_at: Option<String>,
    created_at: Option<String>,
}

impl GithubRelease {
    /// Marca de tiempo ISO 8601 UTC (ordena como texto); `published_at` y, si
    /// falta, `created_at`.
    fn stamp(&self) -> &str {
        self.published_at.as_deref().or(self.created_at.as_deref()).unwrap_or("")
    }

    fn has_sane_tag(&self) -> bool {
        !self.tag_name.is_empty() && self.tag_name.len() <= MAX_TAG_LEN
    }
}

/// La release publicada más reciente: sin borradores, pre-releases incluidas
/// (`/releases/latest` las excluye y hoy solo existen pre-releases). Mismo
/// criterio que `install.sh`: por `published_at`.
fn pick_latest(releases: &[GithubRelease]) -> Option<&GithubRelease> {
    releases
        .iter()
        .filter(|r| !r.draft && r.has_sane_tag())
        .max_by(|a, b| a.stamp().cmp(b.stamp()))
}

/// Un identificador de pre-release: numérico o alfanumérico (SemVer 2.0 §9).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Ident {
    Numeric(u64),
    Alpha(String),
}

impl Ord for Ident {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering::*;
        match (self, other) {
            (Ident::Numeric(a), Ident::Numeric(b)) => a.cmp(b),
            // los numéricos son MENORES que los alfanuméricos
            (Ident::Numeric(_), Ident::Alpha(_)) => Less,
            (Ident::Alpha(_), Ident::Numeric(_)) => Greater,
            // alfanuméricos: orden ASCII (alpha < beta < rc)
            (Ident::Alpha(a), Ident::Alpha(b)) => a.as_bytes().cmp(b.as_bytes()),
        }
    }
}

impl PartialOrd for Ident {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Versión SemVer 2.0 (sin la parte `+build`, que no cuenta para la precedencia).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Version {
    core: (u64, u64, u64),
    pre: Vec<Ident>,
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering::*;
        self.core.cmp(&other.core).then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
            (true, true) => Equal,
            // una pre-release es MENOR que la versión sin sufijo
            (false, true) => Less,
            (true, false) => Greater,
            // campo a campo; si todos los comunes son iguales, gana el de más campos
            (false, false) => self.pre.cmp(&other.pre),
        })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

fn parse_number(part: &str) -> Option<u64> {
    if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    part.parse().ok()
}

fn parse_ident(part: &str) -> Option<Ident> {
    if part.is_empty() || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return None;
    }
    Some(match parse_number(part) {
        Some(n) => Ident::Numeric(n),
        None => Ident::Alpha(part.to_string()),
    })
}

/// Acepta un prefijo `v` y descarta `+build`. `None` si no es SemVer válido.
fn parse_version(raw: &str) -> Option<Version> {
    let raw = raw.strip_prefix('v').unwrap_or(raw);
    let raw = raw.split('+').next()?;
    let (core, pre) = match raw.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (raw, None),
    };
    let mut nums = core.split('.');
    let core = (
        parse_number(nums.next()?)?,
        parse_number(nums.next()?)?,
        parse_number(nums.next()?)?,
    );
    if nums.next().is_some() {
        return None;
    }
    let pre = match pre {
        Some(pre) => pre.split('.').map(parse_ident).collect::<Option<Vec<_>>>()?,
        None => Vec::new(),
    };
    Some(Version { core, pre })
}

/// `true` solo si ambas versiones son SemVer válidas y `remote` tiene mayor
/// precedencia. Una etiqueta que no se entiende nunca cuenta como «más nueva».
fn is_newer(remote: &str, local: &str) -> bool {
    match (parse_version(remote), parse_version(local)) {
        (Some(remote), Some(local)) => remote > local,
        _ => false,
    }
}

/// Espera máxima de toda la petición (conexión + respuesta).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// La respuesta de GitHub es pequeña; más que esto no es una release.
const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_TAG_LEN: usize = 64;

/// `KNIVCHIT_API_BASE` solo se respeta en compilaciones de depuración (y
/// tests): en release permitiría redirigir la comprobación a un servidor
/// cualquiera. En release es siempre la API de GitHub, por https.
fn resolve_api_base(env_override: Option<String>, debug: bool) -> String {
    match env_override.filter(|v| debug && !v.is_empty()) {
        Some(base) => base,
        None => DEFAULT_API_BASE.to_string(),
    }
}

/// Página de releases consultada: basta con las más recientes.
const RELEASES_PER_PAGE: u32 = 10;

/// Pide las últimas releases y devuelve la más reciente publicada (`None` si
/// no hay ninguna publicada).
fn fetch_latest_release(api_base: &str) -> Result<Option<GithubRelease>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .build()
        .into();
    let releases: Vec<GithubRelease> = agent
        .get(&format!("{api_base}/releases?per_page={RELEASES_PER_PAGE}"))
        .call()
        .map_err(|e| e.to_string())?
        .body_mut()
        .with_config()
        .limit(MAX_RESPONSE_BYTES)
        .read_json()
        .map_err(|_| "la respuesta de la API no es una lista de releases válida".to_string())?;
    Ok(pick_latest(&releases).cloned())
}

/// Sin ninguna release publicada no hay nada nuevo: se informa la versión actual.
/// La interfaz solo INFORMA («hay una versión nueva: …»); nunca descarga ni instala.
fn update_info(latest: Option<GithubRelease>, local: &str) -> UpdateInfo {
    match latest {
        Some(release) => UpdateInfo {
            has_update: is_newer(&release.tag_name, local),
            latest_version: release.tag_name,
        },
        None => UpdateInfo { has_update: false, latest_version: local.to_string() },
    }
}

/// Async y con la petición bloqueante en un hilo aparte: un comando síncrono
/// correría en el hilo principal y congelaría la UI sin red.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let api_base = resolve_api_base(
        std::env::var("KNIVCHIT_API_BASE").ok(),
        cfg!(debug_assertions),
    );
    let release = tauri::async_runtime::spawn_blocking(move || fetch_latest_release(&api_base))
        .await
        .map_err(|e| e.to_string())??;
    Ok(update_info(release, env!("CARGO_PKG_VERSION")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_for_update_detects_newer_remote_version() {
        assert!(is_newer("v9.9.9", "0.1.0"));
    }

    #[test]
    fn check_for_update_rejects_equal_or_older_remote_version() {
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.1", "0.1.0"));
    }

    #[test]
    fn precedence_follows_semver_2_0_in_the_documented_order() {
        let ascending = [
            "0.1.0-alpha.1",
            "0.1.0-alpha.2",
            "0.1.0-alpha.10",
            "0.1.0-beta.1",
            "0.1.0-rc.1",
            "0.1.0",
            "0.1.1",
            "0.2.0-alpha.1",
            "0.2.0",
            "1.0.0",
        ];
        for (i, lower) in ascending.iter().enumerate() {
            for higher in &ascending[i + 1..] {
                assert!(is_newer(higher, lower), "{higher} debería ser más nueva que {lower}");
                assert!(!is_newer(lower, higher), "{lower} no es más nueva que {higher}");
            }
            assert!(!is_newer(lower, lower), "{lower} no es más nueva que sí misma");
        }
    }

    #[test]
    fn numeric_identifiers_compare_as_numbers_and_are_lower_than_alphanumeric_ones() {
        assert!(is_newer("1.0.0-alpha.10", "1.0.0-alpha.9"));
        assert!(is_newer("1.0.0-alpha.1", "1.0.0-1"));
        assert!(is_newer("1.0.0-alpha.beta", "1.0.0-alpha.1"));
        assert!(is_newer("1.0.0-alpha.1", "1.0.0-alpha"), "más campos gana");
    }

    #[test]
    fn a_v_prefix_is_accepted_and_build_metadata_is_ignored() {
        assert!(is_newer("v0.1.0-alpha.2", "0.1.0-alpha.1"));
        assert!(!is_newer("0.1.0-alpha.1+build.5", "0.1.0-alpha.1+build.9"));
        assert!(!is_newer("0.1.0+x", "0.1.0"));
        assert!(is_newer("0.1.1+x", "0.1.0+y"));
    }

    #[test]
    fn garbage_is_never_newer() {
        for bad in ["", "v", "latest", "1", "1.2", "1.2.3.4", "a.b.c", "1.2.x", "1.2.3-", "1.2.3-a..b", "-1.0.0", "9.9.9 ", "９.0.0", "1.2.3-é"] {
            assert!(!is_newer(bad, "0.1.0-alpha.1"), "{bad:?}");
        }
        assert!(!is_newer("9.9.9", "no-es-version"), "tampoco si la local no se entiende");
    }

    #[test]
    fn api_base_override_only_applies_in_debug_builds() {
        let custom = Some("http://127.0.0.1:9999".to_string());
        assert_eq!(resolve_api_base(custom.clone(), true), "http://127.0.0.1:9999");
        assert_eq!(resolve_api_base(custom, false), DEFAULT_API_BASE);
        assert_eq!(resolve_api_base(Some(String::new()), true), DEFAULT_API_BASE);
        assert_eq!(resolve_api_base(None, true), DEFAULT_API_BASE);
    }

    #[test]
    fn a_silent_server_hits_the_timeout_instead_of_hanging() {
        // Acepta la conexión y no contesta nunca: sin timeout colgaría la prueba.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let _hold = std::thread::spawn(move || {
            let _conn = listener.accept();
            std::thread::sleep(Duration::from_secs(REQUEST_TIMEOUT.as_secs() + 5));
        });
        let started = std::time::Instant::now();
        assert!(fetch_latest_release(&base).is_err());
        assert!(started.elapsed() < REQUEST_TIMEOUT + Duration::from_secs(3));
    }

    /// Sirve `body` como respuesta única a `GET /releases?per_page=10` y
    /// devuelve la base de la API simulada y la petición recibida.
    fn serve_once(body: String) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = conn.read(&mut buf).unwrap_or(0);
            let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
            let _ = write!(
                conn,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        });
        (base, rx)
    }

    fn latest_tag(body: &str) -> Result<Option<String>, String> {
        let (base, _) = serve_once(body.to_string());
        fetch_latest_release(&base).map(|r| r.map(|r| r.tag_name))
    }

    #[test]
    fn asks_for_the_release_list_not_for_releases_latest() {
        let (base, request) = serve_once("[]".to_string());
        fetch_latest_release(&base).unwrap();
        let first_line = request.recv().unwrap().lines().next().unwrap().to_string();
        assert_eq!(first_line, "GET /releases?per_page=10 HTTP/1.1");
    }

    #[test]
    fn with_only_a_prerelease_that_prerelease_is_the_latest() {
        let body = r#"[{"tag_name":"v0.1.0-alpha.2","draft":false,"prerelease":true,"published_at":"2026-10-16T10:00:00Z"}]"#;
        assert_eq!(latest_tag(body), Ok(Some("v0.1.0-alpha.2".into())));
    }

    #[test]
    fn the_most_recent_by_published_at_wins_prereleases_included() {
        let body = r#"[
            {"tag_name":"v0.0.9","published_at":"2026-09-01T00:00:00Z","prerelease":false},
            {"tag_name":"v0.1.0-alpha.2","published_at":"2026-10-16T10:00:00Z","prerelease":true},
            {"tag_name":"v0.1.0-alpha.1","published_at":"2026-10-15T10:00:00Z","prerelease":true}
        ]"#;
        assert_eq!(latest_tag(body), Ok(Some("v0.1.0-alpha.2".into())));
    }

    #[test]
    fn drafts_are_ignored_even_if_they_look_newer() {
        let body = r#"[
            {"tag_name":"v9.9.9","draft":true,"published_at":null,"created_at":"2027-01-01T00:00:00Z"},
            {"tag_name":"v0.1.0-alpha.1","draft":false,"published_at":"2026-10-15T10:00:00Z"}
        ]"#;
        assert_eq!(latest_tag(body), Ok(Some("v0.1.0-alpha.1".into())));
    }

    #[test]
    fn a_missing_published_at_falls_back_to_created_at() {
        let body = r#"[
            {"tag_name":"v0.1.0-alpha.1","created_at":"2026-10-15T10:00:00Z"},
            {"tag_name":"v0.1.0-alpha.2","created_at":"2026-10-16T10:00:00Z"}
        ]"#;
        assert_eq!(latest_tag(body), Ok(Some("v0.1.0-alpha.2".into())));
    }

    #[test]
    fn an_empty_list_or_only_drafts_means_nothing_published() {
        assert_eq!(latest_tag("[]"), Ok(None));
        assert_eq!(latest_tag(r#"[{"tag_name":"v1.0.0","draft":true}]"#), Ok(None));
        let info = update_info(None, "0.1.0-alpha.1");
        assert_eq!((info.has_update, info.latest_version.as_str()), (false, "0.1.0-alpha.1"));
    }

    #[test]
    fn broken_json_or_the_wrong_shape_is_an_error_not_a_panic() {
        assert!(latest_tag("{ no es json").is_err());
        assert!(latest_tag(r#"{"tag_name":"v1.0.0"}"#).is_err(), "un objeto, no una lista");
        assert!(latest_tag(r#"[{"sin_tag":1}]"#).is_err());
    }

    #[test]
    fn an_oversized_or_empty_tag_name_is_skipped() {
        let long = "v".repeat(MAX_TAG_LEN + 1);
        let body = format!(
            r#"[{{"tag_name":"{long}","published_at":"2027-01-01T00:00:00Z"}},{{"tag_name":"","published_at":"2027-01-02T00:00:00Z"}}]"#
        );
        assert_eq!(latest_tag(&body), Ok(None));
    }

    #[test]
    fn update_info_compares_the_latest_tag_with_the_running_version() {
        let release = |tag: &str| GithubRelease {
            tag_name: tag.into(),
            draft: false,
            published_at: None,
            created_at: None,
        };
        let newer = update_info(Some(release("v0.1.0-alpha.2")), "0.1.0-alpha.1");
        assert!(newer.has_update && newer.latest_version == "v0.1.0-alpha.2");
        assert!(update_info(Some(release("v0.1.0")), "0.1.0-alpha.1").has_update);
        assert!(!update_info(Some(release("v0.1.0-alpha.1")), "0.1.0-alpha.1").has_update);
        assert!(!update_info(Some(release("v0.1.0-alpha.1")), "0.1.0").has_update);
        assert!(!update_info(Some(release("nightly")), "0.1.0").has_update);
    }
}
