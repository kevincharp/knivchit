import { PANEL_ICON_KEY, PanelIconController } from "../lib/panelIcon.js";

// Corre con `gjs -m extension/tests/panelIcon.test.js` (lógica pura, sin Shell).

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);
};

// Doble de GSettings: valor, señales `changed::clave` y contadores.
const makeSettings = (initial = true) => {
  let value = initial;
  const handlers = new Map();
  let nextId = 1;
  return {
    get_boolean: (key) => {
      if (key !== PANEL_ICON_KEY) fail(`clave inesperada ${key}`);
      return value;
    },
    set_boolean(key, v) {
      if (key !== PANEL_ICON_KEY) fail(`clave inesperada ${key}`);
      const changed = v !== value;
      value = v;
      if (changed) for (const cb of [...handlers.values()]) cb();
      return true;
    },
    connect(signal, cb) {
      if (signal !== `changed::${PANEL_ICON_KEY}`) fail(`señal inesperada ${signal}`);
      handlers.set(nextId, cb);
      return nextId++;
    },
    disconnect: (id) => handlers.delete(id),
    handlerCount: () => handlers.size,
  };
};
const make = (initial, appRunning = true) => {
  const settings = makeSettings(initial);
  const log = { created: 0, destroyed: [] };
  let live = 0;
  const controller = new PanelIconController({
    settings,
    createIcon: () => {
      log.created++;
      live++;
      return { id: log.created };
    },
    destroyIcon: (icon) => {
      if (icon) log.destroyed.push(icon.id);
      live--;
    },
    appRunning,
  });
  return { settings, controller, log, live: () => live };
};

// 1. Por defecto activado: start() crea UN icono y vigila el ajuste.
{
  const { controller, log, settings } = make(true);
  eq(controller.visible, false, "antes de start no hay icono");
  controller.start();
  eq([controller.visible, log.created, settings.handlerCount()], [true, 1, 1], "start crea un icono y se suscribe");
  controller.start(); // idempotente: ni segundo icono ni segunda suscripción
  eq([log.created, settings.handlerCount()], [1, 1], "start repetido no duplica");
}
// 2. Con el ajuste desactivado no aparece ningún icono.
{
  const { controller, log } = make(false);
  controller.start();
  eq([controller.visible, log.created], [false, 0], "desactivado: sin icono");
}
// 3. Alternar en vivo (por D-Bus o por dconf) añade y quita el icono.
{
  const { controller, log, settings, live } = make(true);
  controller.start();
  eq(controller.setEnabled(false), [true, ""], "SetPanelIcon(false)");
  eq([controller.visible, log.destroyed, live()], [false, [1], 0], "se quita el icono");
  settings.set_boolean(PANEL_ICON_KEY, true); // alguien lo cambia por fuera
  eq([controller.visible, log.created, live()], [true, 2, 1], "el cambio externo vuelve a crearlo, una vez");
  eq(controller.setEnabled(true), [true, ""], "activar estando activado no duplica");
  eq([log.created, live()], [2, 1], "sigue habiendo un solo icono");
}
// 4. Valor inválido: error de validación, nada cambia.
{
  const { controller, settings } = make(true);
  controller.start();
  for (const bad of ["true", 1, null, undefined, {}]) eq(controller.setEnabled(bad)[0], false, `rechaza ${JSON.stringify(bad)}`);
  eq(settings.get_boolean(PANEL_ICON_KEY), true, "el ajuste no cambió");
  eq(controller.visible, true, "el icono sigue");
}
// 5. stop(): quita el icono y la suscripción; start() posterior (reactivar la extensión) no duplica.
{
  const { controller, log, settings, live } = make(true);
  controller.start();
  controller.stop();
  eq([controller.visible, settings.handlerCount(), live()], [false, 0, 0], "stop limpia todo");
  settings.set_boolean(PANEL_ICON_KEY, false);
  settings.set_boolean(PANEL_ICON_KEY, true);
  eq(log.created, 1, "parado no reacciona a cambios");
  controller.stop(); // doble stop sin romper
  const again = new PanelIconController({ settings, createIcon: () => { log.created++; return { id: log.created }; }, destroyIcon: () => {}, appRunning: true });
  again.start();
  eq(log.created, 2, "una instancia nueva (reactivación) crea exactamente un icono");
}

// 6. Ajuste × app en marcha: el icono existe SOLO si ambos son verdaderos.
{
  for (const [setting, app, visible] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]]) {
    const { controller, log } = make(setting, app);
    controller.start();
    eq([setting, app, controller.visible], [setting, app, visible], `ajuste ${setting} × app ${app}`);
    eq(log.created, visible ? 1 : 0, `iconos creados con ajuste ${setting} × app ${app}`);
  }
}
// 7. La app sale y vuelve (Salir, cierre del proceso o caída; reapertura desde el lanzador).
{
  const { controller, log, live } = make(true, false);
  controller.start();
  eq(controller.visible, false, "arranque con la app parada: sin icono");
  controller.setAppRunning(true);
  eq([controller.visible, log.created, live()], [true, 1, 1], "al arrancar la app aparece el icono");
  controller.setAppRunning(true); // un aviso repetido no duplica
  eq([log.created, live()], [1, 1], "aviso repetido sin duplicar");
  controller.setAppRunning(false);
  eq([controller.visible, log.destroyed, live()], [false, [1], 0], "al salir la app se destruye el icono");
  controller.setAppRunning(false);
  eq(log.destroyed, [1], "salir dos veces no destruye dos veces");
  controller.setAppRunning(true);
  eq([controller.visible, log.created, live()], [true, 2, 1], "al reabrir la app vuelve, uno solo");
  // reentradas rápidas: salir/entrar muchas veces seguidas deja exactamente el estado final
  for (let i = 0; i < 5; i++) {
    controller.setAppRunning(false);
    controller.setAppRunning(true);
  }
  eq([controller.visible, live()], [true, 1], "reentradas rápidas: un solo icono");
}
// 8. Ajuste y app se combinan en vivo: apagar el ajuste con la app en marcha quita el icono; encenderlo lo devuelve.
{
  const { controller, settings, live } = make(true, true);
  controller.start();
  controller.setEnabled(false);
  eq([controller.visible, live(), controller.isEnabled()], [false, 0, false], "ajuste apagado con la app en marcha: sin icono");
  controller.setAppRunning(false);
  controller.setAppRunning(true);
  eq(controller.visible, false, "la app reaparece pero el ajuste sigue apagado: sin icono");
  controller.setEnabled(true);
  eq([controller.visible, live()], [true, 1], "ajuste encendido con la app en marcha: icono");
  controller.setAppRunning(false);
  settings.set_boolean(PANEL_ICON_KEY, false);
  settings.set_boolean(PANEL_ICON_KEY, true);
  eq([controller.visible, controller.isEnabled()], [false, true], "con la app parada el ajuste sigue encendido (lo que ve el hub) y no hay icono");
  controller.setAppRunning("true"); // solo un booleano de verdad cuenta
  eq(controller.visible, false, "un valor que no es booleano no cuenta como app en marcha");
}

print("PASS: PanelIconController crea un solo icono, alterna en vivo, valida el valor y no deja iconos ni suscripciones al parar");
