// Sesión de inserción de texto: la lleva la extensión, nunca la app (un webview
// comprometido o una app colgada no pueden mantenerla viva). Función pura: el reloj
// se inyecta, debe contar también el tiempo de suspensión y no retroceder; si
// retrocede, la sesión se cierra en vez de alargarse.
const IDLE_MS = 120_000;
const CEILING_MS = 900_000;
const RATE_WINDOW_MS = 60_000;
const MAX_INSERTS_PER_WINDOW = 20;
const MAX_BYTES_PER_WINDOW = 16 * 1024;

export const END_REASONS = [
  "escape",
  "shortcut",
  "locked",
  "suspend",
  "logout",
  "channel_closed",
  "owner_changed",
  "idle",
  "ceiling",
  "reopened",
  "clock_back",
];

export class InsertSession {
  #clock;
  #onEnd;
  #active = false;
  #openedAt = 0;
  #lastActivity = 0;
  #recent = [];

  constructor({ clock, onEnd }) {
    this.#clock = clock;
    this.#onEnd = onEnd;
  }

  open() {
    if (this.isActive()) this.end("reopened");
    this.#active = true;
    this.#openedAt = this.#lastActivity = this.#clock();
    this.#recent = [];
  }

  // Comprueba los dos plazos y cierra la sesión vencida; el techo gana a la inactividad.
  isActive() {
    if (!this.#active) return false;
    const now = this.#clock();
    if (now < this.#lastActivity) this.end("clock_back");
    else if (now - this.#openedAt >= CEILING_MS) this.end("ceiling");
    else if (now - this.#lastActivity >= IDLE_MS) this.end("idle");
    return this.#active;
  }

  touch() {
    if (!this.isActive()) return false;
    this.#lastActivity = this.#clock();
    return true;
  }

  tryInsert(bytes) {
    if (!this.isActive()) return { ok: false, reason: "no_session" };
    if (!Number.isInteger(bytes) || bytes < 0) return { ok: false, reason: "invalid_bytes" };
    const now = this.#clock();
    this.#recent = this.#recent.filter((entry) => now - entry.at < RATE_WINDOW_MS);
    if (this.#recent.length >= MAX_INSERTS_PER_WINDOW) return { ok: false, reason: "rate_limit" };
    const used = this.#recent.reduce((sum, entry) => sum + entry.bytes, 0);
    if (used + bytes > MAX_BYTES_PER_WINDOW) return { ok: false, reason: "byte_limit" };
    this.#recent.push({ at: now, bytes });
    this.#lastActivity = now;
    return { ok: true };
  }

  end(reason) {
    if (!this.#active) return;
    this.#active = false;
    this.#recent = [];
    this.#onEnd(reason);
  }
}
