# Política de seguridad

[English](SECURITY.md) | **Español**

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de GitHub (*Private vulnerability reporting*): en `https://github.com/kevincharp/knivchit`, pestaña **Security** → **Report a vulnerability**. Solo lo ven los mantenedores. No hay correo para esto a propósito.

Incluye, si puedes: versión, GNOME Shell, pasos para reproducirlo, qué consigue un atacante y una prueba mínima. **No pegues contenido de tu portapapeles ni capturas con datos personales.**

## Qué puedes esperar

| Plazo | Qué |
|---|---|
| 3 días hábiles | acuse de recibo |
| 10 días hábiles | primera valoración: si es válido, gravedad y plan |
| 90 días como máximo | corrección publicada, o acordamos contigo una fecha |

Es un proyecto de mantenedores voluntarios: son plazos de buena fe, no un contrato. Con tu permiso te citamos en la nota de la corrección. Te pedimos no divulgarlo hasta que haya arreglo o pasen los 90 días.

## Versiones con soporte

Solo la **última versión publicada**, hoy una vista previa temprana (alpha). Es software no estable: puede haber fallos y cambios incompatibles entre versiones.

## Alcance y modelo de confianza

Lo que el proyecto promete:

- Todo es **local**: sin cuentas, sin servidor, sin telemetría. La única conexión de la app es «Buscar actualizaciones», solo cuando el usuario la pulsa (consulta los releases del repositorio); la extensión no usa la red. El instalador también consulta los releases.
- El instalador **verifica el SHA-256** de lo que descarga (`SHA256SUMS`) antes de instalar nada.
- La interfaz no carga contenido remoto mientras haya comandos de Tauri expuestos.
- El contenido del portapapeles nunca se escribe en ningún log.
- La extensión captura el teclado **solo mientras grabas un atajo**, y de ello usa únicamente la combinación final.

Lo que **no** protege (límites conocidos, no son vulnerabilidades):

- **Quien pueda ejecutar código con tu usuario puede leer tus datos locales.** El modelo de confianza del proyecto asume que tu cuenta de usuario no está comprometida.
- **El bus de sesión D-Bus no es confidencial frente a otros procesos de tu propio usuario.** Cualquier programa que corra como tú puede llamar a los métodos de la app y de la extensión (p. ej. lanzar una captura) o leer las señales. El proyecto no intenta defenderse de código ya ejecutándose con tu usuario. Por eso el contenido sensible (como el del portapapeles, cuando exista el historial) irá por un canal privado y no por el bus.
- Un atacante con acceso a tu cuenta o a tu disco puede leer las capturas guardadas y la base de datos local.
- Una extensión de GNOME Shell corre dentro del Shell con sus privilegios: es inherente a la plataforma.

Sí están en alcance, por ejemplo: ejecución de código o lectura de ficheros desde contenido no confiable, escape del modelo de comandos de Tauri, saltarse la verificación de sumas del instalador, escritura fuera de la carpeta de capturas, fugas de contenido del portapapeles a logs o red, y elevación de privilegios por la extensión.

Fuera de alcance: vulnerabilidades de GNOME, Tauri, WebKitGTK o dependencias (repórtalas a su proyecto; avísanos si nos afectan de forma especial), ingeniería social y ataques que requieran ya control del usuario.

## Mejoras futuras

- **Verificar la autenticidad de los releases.** Hoy el instalador comprueba el SHA-256 contra `SHA256SUMS`, lo que detecta una descarga corrupta pero no un release manipulado (las sumas viajan junto al archivo). Está previsto añadir **atestaciones de GitHub** (*artifact attestations*) al empaquetado y que el instalador, o el usuario, las verifique con `gh attestation verify`. Se prefieren a gestionar claves propias de firma. Aún no está hecho: hasta entonces, la integridad descansa en la cuenta del repositorio y en HTTPS.
