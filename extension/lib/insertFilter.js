// Filtro del texto que la extensión acepta insertar en la primera entrega: una sola
// secuencia de emoji. Lo demás se rechaza aunque venga del canal autenticado.
// Función pura (sin gi://Shell ni gi://Meta).
const MAX_BYTES = 32;

// Un emoji es de presentación gráfica por defecto, o un símbolo de texto con selector de
// variación (FE0F); un símbolo de texto suelto (©, ™, ↔) no lo es. Los dígitos, # y *
// solo valen dentro de un keycap, y los tonos de piel y los indicadores regionales
// no son emoji por sí solos.
const EMOJI_ELEMENT =
  "(?:\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}" +
  "|(?![#*0-9\\p{Emoji_Modifier}\\p{Regional_Indicator}])(?:\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F))";
const EMOJI_SEQUENCE = `${EMOJI_ELEMENT}(?:\\u200D${EMOJI_ELEMENT})*`;
const FLAG = "\\p{Regional_Indicator}{2}";
// Las tres banderas de subdivisión RGI: Inglaterra, Escocia y Gales.
const SUBDIVISION_FLAG =
  "\\u{1F3F4}\\u{E0067}\\u{E0062}(?:\\u{E0065}\\u{E006E}\\u{E0067}|\\u{E0073}\\u{E0063}\\u{E0074}|\\u{E0077}\\u{E006C}\\u{E0073})\\u{E007F}";
const KEYCAP = "[#*0-9]\\uFE0F?\\u20E3";

const EMOJI = new RegExp(`^(?:${KEYCAP}|${FLAG}|${SUBDIVISION_FLAG}|${EMOJI_SEQUENCE})$`, "u");

const encoder = new TextEncoder();

export function checkInsertable(text) {
  const ok =
    typeof text === "string" && encoder.encode(text).length <= MAX_BYTES && EMOJI.test(text);
  return ok ? { ok: true } : { ok: false, reason: "not_emoji" };
}
