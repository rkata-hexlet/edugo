import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, overloaded, type SimEvent, type World } from "./sim";

// Озвучка эпизода словарём 05 (docs/reviews/05-sound-design.md): громкая беда (40001) — «бзз» на square, самый
// громкий звук; тихая беда (у курьера коробок больше, чем мест) — неверный аккорд, как «продано больше» в 05; отказы
// без беды («слот занят», 0 строк) — глухо и вежливо. Новое в 06: метка чтения SERIALIZABLE — тихий стеклянный
// «пинг» (никого не держит — без стука замка), чужая вставка под метку — тонкое «тинь» вверх.
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

type Recipe = (s: Sound, at: number, e: SimEvent, o: { replay: boolean; quietRed: boolean }) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp, k = 1) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09 * k, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08 * k, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08 * k, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.07, at: at + 0.15 });
    s.tone({ freq: 90, to: 50, dur: 0.08, gain: 0.07, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  // Подсчёт заказов — тот же мягкий щелчок, что чтение в 05; у B чуть выше.
  count: (s, at, e) => {
    const f = e.by === "B" ? 190 : 160;
    s.tone({ freq: f, to: f * 0.56, dur: 0.08, gain: 0.08, at });
    s.noise({ dur: 0.04, freq: 300, q: 1, gain: 0.05, at });
  },
  // Вставка своей строки — короткий треугольник, как запись в 05.
  insert: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  write: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  wait: (s, at) => {
    s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.03, at });
    s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.03, at: at + 0.1 });
  },
  mark: (s, at, e) => s.tone({ freq: e.by === "B" ? 1568 : 1319, dur: 0.12, wave: "sine", gain: 0.035, at }),
  dep: (s, at) => s.tone({ freq: 880, to: 1760, dur: 0.1, wave: "triangle", gain: 0.045, at }),
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.11, at });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.11, at });
  },
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.09, gain: 0.1, at }),
  busy: (s, at) => {
    s.tone({ freq: 523, dur: 0.09, gain: 0.06, at });
    s.tone({ freq: 392, dur: 0.11, gain: 0.055, at: at + 0.09 });
  },
  zero: (s, at) => {
    s.noise({ dur: 0.08, freq: 1200, q: 1, gain: 0.05, at });
    s.tone({ freq: 400, dur: 0.03, gain: 0.045, at: at + 0.1 });
  },
  overload: (s, at) => {
    s.tone({ freq: 233, dur: 0.22, gain: 0.05, at });
    s.tone({ freq: 247, dur: 0.22, gain: 0.05, at });
    s.tone({ freq: 117, dur: 0.22, gain: 0.04, at });
    s.tone({ freq: 466, dur: 0.22, wave: "triangle", gain: 0.02, at });
    s.tone({ freq: 494, dur: 0.22, wave: "triangle", gain: 0.02, at });
  },
  fail: (s, at, _e, o) => {
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.17, at: at + 0.12 });
    if (o.replay) return;
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.17, at: at + 0.25 });
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.11, at: at + 0.37 });
  },
  retry: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  verdict: (s, at, e, o) => e.lamps?.forEach((lamp, i) => {
    if (!lamp || (o.quietRed && lamp === "red")) return;
    lampTone(s, at + 0.08 * i, lamp, o.quietRed ? 0.6 : 1);
  }),
};

/** Смена сцены первой; перегруз — после «динь» подтверждений, табло — последним; остальное — в порядке событий. */
const RANK: Partial<Record<EventKind, number>> = { rewind: 0, page: 0, card: 0, overload: 2, verdict: 3 };

const SPAN: Partial<Record<EventKind, number>> = {
  rewind: 0.25, page: 0.1, card: 0.1, count: 0.1, insert: 0.1, write: 0.1, wait: 0.22, retry: 0.12, mark: 0.08, dep: 0.12,
  zero: 0.12, fail: 0.1, commit: 0.1, ok: 0.1, busy: 0.15, overload: 0.14, verdict: 0.1,
};

/** Два подсчёта, две вставки, два «динь», две метки и две зависимости — да; остальное — по разу. */
const REPEAT: Partial<Record<EventKind, number>> = { count: 2, insert: 2, ok: 2, mark: 2, dep: 2 };

const RECAP = new Set<EventKind>(["commit", "overload", "zero", "busy", "ok", "fail"]);

export function score(w: World, replay = false): SimEvent[] {
  const has = (k: EventKind) => w.events.some((e) => e.kind === k);
  const drop = new Set<EventKind>(["press", "doom"]);
  if (has("rewind")) for (const k of ["page", "count", "insert"] as const) drop.add(k);
  if (has("card")) drop.add("page");
  const n = new Map<EventKind, number>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || drop.has(e.kind) || (replay && !RECAP.has(e.kind))) return false;
    const c = (n.get(e.kind) ?? 0) + 1;
    n.set(e.kind, c);
    return c <= (replay ? 1 : (REPEAT[e.kind] ?? 1));
  });
  const ordered = picked.map((e, i) => ({ e, i })).sort((a, b) => ((RANK[a.e.kind] ?? 1) - (RANK[b.e.kind] ?? 1)) || a.i - b.i).map((x) => x.e);
  while (ordered.length > MAX_SOUNDS) {
    const i = ordered.findIndex((e) => ["count", "insert", "write", "wait", "commit"].includes(e.kind));
    ordered.splice(i >= 0 ? i : ordered.length - 1, 1);
  }
  return ordered;
}

function shaped(s: Sound, k: number): Sound {
  const at = (t?: number) => Math.min(t ?? 0, EVENT_WINDOW);
  return {
    tone: (o) => s.tone({ ...o, gain: (o.gain ?? 0.1) * k, at: at(o.at) }),
    noise: (o) => s.noise({ ...o, gain: (o.gain ?? 0.1) * k, at: at(o.at) }),
    babble: (v, t, a) => s.babble({ ...v, gain: v.gain * k }, t, a),
  };
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

export function sound(out: Sound, w: World, replay = false): void {
  const s = shaped(out, replay ? 0.7 : 1);
  const events = score(w, replay);
  const starts: number[] = [];
  let t = 0;
  for (const e of events) {
    starts.push(t);
    t += SPAN[e.kind] ?? 0.1;
  }
  const last = starts.at(-1) ?? 0;
  const k = last > EVENT_WINDOW - 0.05 ? (EVENT_WINDOW - 0.05) / last : 1;
  const opts = { replay, quietRed: overloaded(w) };
  events.forEach((e, i) => RECIPES[e.kind]!(s, starts[i] * k, e, opts));
  if (speakable(w.db)) s.babble({ ...DB_VOICE, gain: w.events.some((e) => e.kind === "fail") ? 0.07 : DB_VOICE.gain }, w.db, BABBLE_AT);
}
