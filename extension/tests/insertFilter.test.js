import { checkInsertable } from "../lib/insertFilter.js";

// Corre con `gjs -m extension/tests/insertFilter.test.js`.

const accepted = [
  ["emoji simple", "😀"],
  ["con selector de variación", "❤️"],
  ["con tono de piel", "👍🏽"],
  ["unión ZWJ (familia)", "👨‍👩‍👧‍👦"],
  ["ZWJ con tono y variación", "🧑🏽‍🚀"],
  ["bandera por indicadores regionales", "🇨🇱"],
  ["bandera de subdivisión", "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"],
  ["keycap con dígito", "1️⃣"],
  ["keycap con #", "#️⃣"],
  ["keycap con *", "*️⃣"],
  ["keycap sin selector de variación", "5⃣"],
  ["emoji de texto con selector de variación", "©️"],
  ["emoji de texto con tono (mano)", "☝🏽"],
  ["bandera de Inglaterra", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"],
  ["bandera de Gales", "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}"],
];

const rejected = [
  ["cadena vacía", ""],
  ["letra ASCII", "a"],
  ["dígito suelto", "1"],
  ["# suelto", "#"],
  ["* suelto", "*"],
  ["texto libre", "hola"],
  ["emoji más texto", "😀a"],
  ["salto de línea", "😀\n"],
  ["retorno de carro", "😀\r"],
  ["tabulador", "\t"],
  ["espacio", " "],
  ["espacio tras emoji", "😀 "],
  ["ESC", "\u001b"],
  ["control en medio", "😀\u0007😀"],
  ["dos emoji seguidos", "😀😀"],
  ["ZWJ colgante", "👨‍"],
  ["solo un selector de variación", "️"],
  ["solo un tono de piel", "🏽"],
  ["un solo indicador regional", "🇨"],
  ["tres indicadores regionales", "🇨🇱🇨"],
  ["keycap con letra", "a⃣"],
  ["no es cadena: número", 42],
  ["no es cadena: null", null],
  ["no es cadena: undefined", undefined],
  ["5000 bytes", "😀".repeat(1250)],
  ["ZWJ hacia un tono de piel", "😀\u200D🏽"],
  ["ZWJ hacia un keycap", "😀\u200D1\uFE0F\u20E3"],
  ["carácter nulo con selector de variación", "\u0000\uFE0F"],
  ["símbolo de texto ©", "©"],
  ["símbolo de texto ™", "™"],
  ["símbolo de texto ‼", "‼"],
  ["símbolo de texto ↔", "↔"],
  ["símbolo de texto ▪", "▪"],
  ["emoji unido a un símbolo de texto", "😀\u200D©"],
  ["tono de piel sobre un símbolo de texto", "©🏽"],
  ["punto de código reservado", "\u{1FFFD}"],
  ["# con selector pero sin keycap", "#\uFE0F"],
  ["dígito con selector pero sin keycap", "1\uFE0F"],
  ["tags con espacio tras la bandera negra", "🏴\u{E0020}\u{E0020}\u{E0020}\u{E007F}"],
  ["tags arbitrarios tras la bandera negra", "🏴\u{E0061}\u{E0062}\u{E0063}\u{E007F}"],
  ["bandera de subdivisión inexistente", "🏴\u{E0067}\u{E0062}\u{E0078}\u{E0078}\u{E0078}\u{E007F}"],
];

const failures = [];

for (const [name, text] of accepted) {
  const got = checkInsertable(text);
  if (got.ok !== true) failures.push(`debería aceptar «${name}» y dio ${JSON.stringify(got)}`);
}

for (const [name, text] of rejected) {
  const got = checkInsertable(text);
  if (got.ok !== false || got.reason !== "not_emoji") {
    failures.push(`debería rechazar «${name}» con not_emoji y dio ${JSON.stringify(got)}`);
  }
}

// Tope de 32 bytes: 5 emoji de 4 B unidos por 4 ZWJ de 3 B son exactamente 32 B y pasan;
// con un selector de variación más (35 B) se rechazan.
const joined = Array(5).fill("👨").join("\u200D");
const bytes = (text) => new TextEncoder().encode(text).length;
if (bytes(joined) !== 32 || checkInsertable(joined).ok !== true) failures.push("32 B exactos deberían pasar");
const over = `${joined}\uFE0F`;
if (bytes(over) !== 35 || checkInsertable(over).ok !== false) failures.push("35 B deberían rechazarse");

if (failures.length > 0) {
  for (const f of failures) printerr(`FAIL: ${f}`);
  imports.system.exit(1);
}

print(`PASS: filtro de emoji (${accepted.length} aceptados, ${rejected.length} rechazados)`);
