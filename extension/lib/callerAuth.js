// ¿Quién llama a la extensión por D-Bus? Función pura: lo que depende del bus
// (quién es el dueño de un nombre, credenciales de una conexión) se inyecta,
// así se prueba con gjs a secas. El contrato D-Bus completo está resumido en extension/README.md.
//
// Regla: solo la aplicación Knivchit puede usar los métodos de atajos. «La
// aplicación» es el dueño actual de org.knivchit.App; la app llama a la
// extensión desde OTRA conexión suya (no la que posee el nombre), así que no
// basta comparar nombres únicos: se compara el proceso (PID) y el usuario (UID)
// de las dos conexiones, que el bus da en GetConnectionCredentials. Un proceso
// ajeno del mismo usuario no puede hacerse pasar por la app salvo que ya
// controle esa cadena de confianza (ver el aviso de EXT-05 sobre RequestName).

export const APP_BUS_NAME = "org.knivchit.App";

/**
 * @param {string|null} sender nombre único de quien llama (invocation.get_sender())
 * @param {object} deps
 *   ownerOf(name) -> Promise<string|null>   dueño actual del nombre (GetNameOwner)
 *   credentialsOf(unique) -> Promise<{pid:number|null, uid:number|null}|null>
 *   ownUid() -> Promise<number>             uid del proceso del Shell
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function authorizeCaller(sender, { ownerOf, credentialsOf, ownUid }) {
  if (!sender) return { ok: false, reason: "llamada sin remitente" };
  const owner = await ownerOf(APP_BUS_NAME);
  if (!owner) return { ok: false, reason: "Knivchit no está en marcha" };

  const mine = await credentialsOf(sender);
  if (!mine || mine.uid === null || mine.uid !== (await ownUid())) return { ok: false, reason: "usuario distinto" };
  if (sender === owner) return { ok: true, reason: "" };

  const theirs = await credentialsOf(owner);
  if (!theirs || mine.pid === null || theirs.pid === null || mine.pid !== theirs.pid)
    return { ok: false, reason: "no es el proceso de Knivchit" };
  return { ok: true, reason: "" };
}
