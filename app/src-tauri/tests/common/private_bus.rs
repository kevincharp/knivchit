//! Bus de sesión D-Bus privado para los tests que ejercen el contrato
//! `org.knivchit.App` / `org.knivchit.ClipboardService`: esos tests nunca deben conectar contra el bus
//! de sesión real de la máquina que corre `cargo test`. Si la extensión
//! real ya está activa ahí, ya es dueña de `org.knivchit.ClipboardService`
//! y cualquier test que intente la misma `RequestName` falla con
//! `NameTaken` — además de arriesgar interferir con la sesión de verdad
//! del usuario.
//!
//! Antes, estos tests confiaban en que `cargo test` corriera envuelto en
//! `dbus-run-session` (que exporta su propio `DBUS_SESSION_BUS_ADDRESS` y
//! `Connection::session()` lo sigue). Corridos sueltos, con la extensión
//! real cargada, caían contra el bus real. Este helper lanza su propio
//! `dbus-daemon --session` por test y conecta explícitamente contra esa
//! dirección — nunca lee ni escribe `DBUS_SESSION_BUS_ADDRESS`.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

/// Un `dbus-daemon --session` propio del test, vivo mientras exista este
/// valor. Se mata (y se espera) al soltarlo.
pub struct PrivateBus {
    address: String,
    daemon: Child,
}

impl PrivateBus {
    /// Lanza un bus de sesión privado nuevo y devuelve un handle a él.
    ///
    /// Si `dbus-daemon` no está instalado, o falla de cualquier otra forma
    /// antes de entregar una dirección, el test **debe fallar con un
    /// mensaje claro** — nunca pasar en silencio ni caer al bus real.
    pub fn spawn() -> Self {
        let mut daemon = Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect(
                "dbus-daemon no está disponible: estos tests necesitan su propio bus de \
                 sesión privado y no pueden caer al bus de \
                 sesión real de esta máquina — instalá el paquete `dbus` (o equivalente) \
                 para poder correrlos",
            );

        let stdout = daemon
            .stdout
            .take()
            .expect("dbus-daemon no entregó su stdout (¿se pidió --print-address?)");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .expect("no se pudo leer la dirección que imprime dbus-daemon");
        let address = line.trim().to_string();
        assert!(
            !address.is_empty(),
            "dbus-daemon no imprimió ninguna dirección de bus (salida vacía)"
        );

        // Guardia: la dirección de un bus recién lanzado (socket temporal +
        // guid nuevo) no puede coincidir con la del bus de sesión real del
        // entorno. Si coincidiera, algo está mal en el entorno de test —
        // abortar en vez de arriesgar ejercer el contrato contra la sesión
        // de verdad del usuario.
        if let Ok(real) = std::env::var("DBUS_SESSION_BUS_ADDRESS") {
            assert_ne!(
                address, real,
                "el bus privado recién lanzado resultó con la misma dirección que el bus \
                 de sesión real del entorno; abortando en vez de arriesgar contaminarlo"
            );
        }

        Self { address, daemon }
    }

    /// Abre una conexión nueva contra este bus privado. Nunca toca
    /// `DBUS_SESSION_BUS_ADDRESS`: la dirección se pasa explícita.
    pub async fn connect(&self) -> zbus::Connection {
        zbus::connection::Builder::address(self.address.as_str())
            .expect("dirección de bus privada inválida")
            .build()
            .await
            .expect("no se pudo conectar al bus de sesión privado recién lanzado")
    }
}

impl Drop for PrivateBus {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
    }
}
