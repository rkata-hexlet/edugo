import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import type { EventKind, SimEvent, World } from "./sim";

// Звук-черновик MVP словарём 05–07 (карту эпизода сделает sound-designer после утверждения сюжета): запрос — короткий
// треугольник, ответ — «динь», потерянный ответ — шорох обрыва, списание — «касса», второе списание — громкий «бзз»,
// отказ вставки — глухой стук, 409 — жёлтый тон, падение пода — удар вниз, банк по ключу — два пинга вверх.
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.07 };
const BANK_VOICE: Voice = { wave: "triangle", pitch: 180, rate: 7, spread: 1.2, gain: 0.06 };

type Recipe = (s: Sound, at: number, e: SimEvent) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else {
    s.tone({ freq: 233, dur: 0.2, gain: 0.04, at });
    s.tone({ freq: 247, dur: 0.2, gain: 0.04, at });
  }
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  rewind: (s, at) => s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at }),
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  req: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  reply: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.09, gain: 0.09, at }),
  lost: (s, at) => s.noise({ dur: 0.18, freq: 3000, q: 0.5, gain: 0.05, at }),
  charge: (s, at) => [0, 0.05].forEach((d, i) => s.tone({ freq: 880 + 220 * i, dur: 0.05, wave: "triangle", gain: 0.07, at: at + d })),
  double: (s, at) => [0, 0.08].forEach((d) => s.tone({ freq: 200, dur: 0.07, wave: "square", gain: 0.16, at: at + d })),
  replayed: (s, at) => [660, 880].forEach((freq, i) => s.tone({ freq, dur: 0.04, wave: "triangle", gain: 0.06, at: at + 0.05 * i })),
  insert: (s, at) => s.noise({ dur: 0.05, freq: 300, q: 1, gain: 0.07, at }),
  conflict: (s, at) => s.tone({ freq: 120, to: 70, dur: 0.1, gain: 0.09, at }),
  done: (s, at) => s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.1, at }),
  busy: (s, at) => s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.07, at }),
  crash: (s, at) => s.tone({ freq: 300, to: 60, dur: 0.25, wave: "sawtooth", gain: 0.1, at }),
  takeover: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  tick: (s, at) => [800, 600].forEach((freq, i) => s.tone({ freq, dur: 0.025, wave: "triangle", gain: 0.06, at: at + 0.12 * i })),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => {
    if (lamp) lampTone(s, at + 0.08 * i, lamp);
  }),
};

/** Смена сцены первой, табло — последним; остальное — в порядке событий. */
const RANK: Partial<Record<EventKind, number>> = { rewind: 0, page: 0, card: 0, verdict: 3 };
const RECAP = new Set<EventKind>(["lost", "charge", "double", "replayed", "conflict", "crash", "takeover", "reply"]);

/** События кадра, которые звучат: по одному каждого вида, не больше MAX_SOUNDS; в итоге — только образы. */
export function score(w: World, replay = false): SimEvent[] {
  const seen = new Set<EventKind>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || seen.has(e.kind) || (replay && !RECAP.has(e.kind))) return false;
    seen.add(e.kind);
    return true;
  });
  return picked.map((e, i) => ({ e, i }))
    .sort((a, b) => ((RANK[a.e.kind] ?? 1) - (RANK[b.e.kind] ?? 1)) || a.i - b.i)
    .map((x) => x.e)
    .slice(0, MAX_SOUNDS);
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

export function sound(out: Sound, w: World, replay = false): void {
  const k = replay ? 0.7 : 1;
  const s: Sound = {
    tone: (o) => out.tone({ ...o, gain: (o.gain ?? 0.1) * k }),
    noise: (o) => out.noise({ ...o, gain: (o.gain ?? 0.1) * k }),
    babble: (v, t, a) => out.babble({ ...v, gain: v.gain * k }, t, a),
  };
  const events = score(w, replay);
  const step = events.length > 1 ? (EVENT_WINDOW - 0.2) / (events.length - 1) : 0;
  events.forEach((e, i) => RECIPES[e.kind]!(s, i * step, e));
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
  else if (speakable(w.bank)) s.babble(BANK_VOICE, w.bank, BABBLE_AT);
}
