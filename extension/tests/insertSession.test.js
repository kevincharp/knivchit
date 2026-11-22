import { END_REASONS, InsertSession } from "../lib/insertSession.js";

// Corre con `gjs -m extension/tests/insertSession.test.js`. Reloj inyectado en ms.

const SECOND = 1000;
const IDLE = 120 * SECOND;
const CEILING = 900 * SECOND;

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

function make() {
  const state = { now: 1_000_000, ended: [] };
  const session = new InsertSession({
    clock: () => state.now,
    onEnd: (reason) => state.ended.push(reason),
  });
  return { state, session };
}

// Sin sesión abierta no se inserta.
{
  const { session } = make();
  check(session.isActive() === false, "sin open() no hay sesión activa");
  check(session.tryInsert(4).reason === "no_session", "sin sesión, tryInsert da no_session");
}

// Caduca a los 120 s sin actividad.
{
  const { state, session } = make();
  session.open();
  state.now += IDLE - 1;
  check(session.isActive() === true, "a 119,999 s de inactividad sigue activa");
  state.now += 1;
  check(session.isActive() === false, "a 120 s de inactividad caduca");
  check(state.ended.join() === "idle", `motivo de cierre idle, dio ${state.ended}`);
  check(session.tryInsert(4).reason === "no_session", "caducada, no se inserta");
}

// La actividad local renueva la inactividad, pero no pasa del techo de 900 s.
{
  const { state, session } = make();
  session.open();
  for (let t = 0; t < CEILING - 60 * SECOND; t += 60 * SECOND) {
    state.now += 60 * SECOND;
    check(session.touch() === true, "touch con sesión viva renueva");
  }
  check(session.isActive() === true, "con actividad continua sigue activa antes del techo");
  state.now += 60 * SECOND;
  session.touch();
  check(session.isActive() === false, "al llegar a 900 s caduca aunque haya actividad");
  check(state.ended.join() === "ceiling", `motivo de cierre ceiling, dio ${state.ended}`);
}

// Una suspensión (el reloj salta) vence la sesión en la siguiente consulta.
{
  const { state, session } = make();
  session.open();
  state.now += 20 * 60 * SECOND;
  check(session.isActive() === false, "tras un salto del reloj de 20 min la sesión está vencida");
  check(state.ended.join() === "ceiling", `un salto largo cuenta como techo, dio ${state.ended}`);
}

// touch sin sesión no hace nada.
{
  const { session } = make();
  check(session.touch() === false, "touch sin sesión devuelve false");
}

// Una inserción cuenta como actividad.
{
  const { state, session } = make();
  session.open();
  state.now += IDLE - SECOND;
  check(session.tryInsert(4).ok === true, "inserción dentro del tiempo");
  state.now += IDLE - SECOND;
  check(session.isActive() === true, "la inserción renovó la inactividad");
}

// end(motivo): idempotente, avisa una sola vez y bloquea inserciones, para cada motivo.
for (const reason of END_REASONS) {
  const { state, session } = make();
  session.open();
  session.end(reason);
  session.end("escape");
  check(state.ended.join() === reason, `end(${reason}) avisa una vez con su motivo, dio ${state.ended}`);
  check(session.isActive() === false, `tras end(${reason}) no hay sesión`);
  check(session.tryInsert(4).reason === "no_session", `tras end(${reason}) se rechaza insertar`);
}

// end sin sesión no avisa.
{
  const { state, session } = make();
  session.end("escape");
  check(state.ended.length === 0, "end sin sesión no llama a onEnd");
}

// Topes por minuto: 20 inserciones.
{
  const { state, session } = make();
  session.open();
  for (let i = 0; i < 20; i++) {
    check(session.tryInsert(4).ok === true, `inserción ${i + 1} dentro del tope`);
    state.now += SECOND;
  }
  const over = session.tryInsert(4);
  check(over.ok === false && over.reason === "rate_limit", "la inserción 21 del minuto se rechaza");
  state.now += 41 * SECOND;
  check(session.tryInsert(4).ok === true, "pasado el minuto vuelve a admitir");
}

// Topes por minuto: 16 KiB.
{
  const { session } = make();
  session.open();
  check(session.tryInsert(16 * 1024).ok === true, "16 KiB exactos caben");
  const over = session.tryInsert(1);
  check(over.ok === false && over.reason === "byte_limit", "1 B más sobre 16 KiB en el minuto se rechaza");
}

// Una inserción rechazada no consume cupo.
{
  const { session } = make();
  session.open();
  session.tryInsert(16 * 1024);
  session.tryInsert(1);
  check(session.tryInsert(1).reason === "byte_limit", "los rechazos no suman bytes");
}

// Los topes se reinician al abrir otra sesión; abrir sobre una activa cierra la anterior.
{
  const { state, session } = make();
  session.open();
  for (let i = 0; i < 20; i++) session.tryInsert(4);
  check(session.tryInsert(4).reason === "rate_limit", "tope alcanzado");
  session.open();
  check(state.ended.join() === "reopened", `reabrir cierra la anterior con reopened, dio ${state.ended}`);
  check(session.tryInsert(4).ok === true, "la sesión nueva parte con los topes a cero");
}

// Un tamaño que no es un entero no negativo se rechaza y no altera los topes.
for (const bad of [Number.NaN, -1, -1e9, 1.5, Number.POSITIVE_INFINITY, undefined, null, "4"]) {
  const { session } = make();
  session.open();
  const got = session.tryInsert(bad);
  check(got.ok === false && got.reason === "invalid_bytes", `tryInsert(${String(bad)}) da invalid_bytes, dio ${JSON.stringify(got)}`);
  check(session.tryInsert(16 * 1024).ok === true, `tras tryInsert(${String(bad)}) el tope de 16 KiB sigue entero`);
  check(session.tryInsert(1).reason === "byte_limit", `tras tryInsert(${String(bad)}) el tope sigue aplicando`);
}

// Los topes miran los últimos 60 s: una entrada de exactamente 60 s ya no cuenta.
{
  const { state, session } = make();
  session.open();
  for (let i = 0; i < 20; i++) session.tryInsert(4);
  state.now += 60 * SECOND - 1;
  session.touch();
  check(session.tryInsert(4).reason === "rate_limit", "a 59,999 s siguen contando las 20 inserciones");
  state.now += 1;
  session.touch();
  check(session.tryInsert(4).ok === true, "a 60 s exactos las inserciones viejas salen de la ventana");
}

// Los bytes también salen de la ventana con el tiempo.
{
  const { state, session } = make();
  session.open();
  session.tryInsert(16 * 1024);
  state.now += 60 * SECOND;
  session.touch();
  check(session.tryInsert(16 * 1024).ok === true, "pasado el minuto vuelven a caber 16 KiB");
}

// Un reloj que retrocede no alarga la sesión: se cierra.
{
  const { state, session } = make();
  session.open();
  state.now -= 10 * SECOND;
  check(session.isActive() === false, "con el reloj hacia atrás la sesión se cierra");
  check(state.ended.join() === "clock_back", `motivo clock_back, dio ${state.ended}`);
}

// Abrir sobre una sesión ya vencida la cierra por su plazo, no por reopened.
{
  const { state, session } = make();
  session.open();
  state.now += IDLE;
  session.open();
  check(state.ended.join() === "idle", `la vencida cierra por idle, dio ${state.ended}`);
  check(session.isActive() === true, "y la sesión nueva queda abierta");
}

// Un onEnd que reabre la sesión deja una sesión nueva válida, sin doble cierre.
{
  const state = { now: 1_000_000, ended: [] };
  const session = new InsertSession({
    clock: () => state.now,
    onEnd: (reason) => {
      state.ended.push(reason);
      if (reason === "escape") session.open();
    },
  });
  session.open();
  session.end("escape");
  check(state.ended.join() === "escape", `un solo cierre, dio ${state.ended}`);
  check(session.isActive() === true, "la sesión reabierta desde onEnd está activa");
}

if (failures.length > 0) {
  for (const f of failures) printerr(`FAIL: ${f}`);
  imports.system.exit(1);
}

print("PASS: sesión de inserción (inactividad, techo, suspensión, cierre por motivo y topes)");
