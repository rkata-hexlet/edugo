import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import type { EventKind, SimEvent, World } from "./sim";

// Карта звука — docs/reviews/08-sound-design.md. Касса — списание; та же касса со сломанной нотой и «бзз» — второе
// списание (рифма хука); «динь» — ответ, обрыв помех — потерянный ответ; ровный тон — 409, не отказ; штамп со звонком —
// банк узнал ключ; «тук» с тёплым тоном — база отбила дубль, «пум» — ключ закрыт. Звуки событий — в окне 0–0.45 с,
// с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.07 };
const BANK_VOICE: Voice = { wave: "triangle", pitch: 180, rate: 7, spread: 0.6, gain: 0.05 };

/** quiet — ответ в кадре второго списания: «динь» тише и позже, провал не заглушает. */
type Recipe = (s: Sound, at: number, e: SimEvent, quiet: boolean) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  rewind: (s, at) => s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at }),
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  press: (s, at) => s.tone({ freq: 600, dur: 0.04, wave: "triangle", gain: 0.06, at }),
  req: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.05, at }),
  reply: (s, at, _e, quiet) => s.tone({ freq: 1047, to: 1319, dur: 0.09, gain: quiet ? 0.054 : 0.09, at: quiet ? Math.max(at, 0.35) : at }),
  lost: (s, at) => {
    s.noise({ dur: 0.12, freq: 3000, q: 0.5, gain: 0.05, at: at + 0.05 });
    s.tone({ freq: 700, to: 180, dur: 0.2, wave: "triangle", gain: 0.06, at: at + 0.12 });
  },
  charge: (s, at) => {
    s.tone({ freq: 880, dur: 0.05, wave: "triangle", gain: 0.07, at });
    s.tone({ freq: 1320, dur: 0.07, wave: "triangle", gain: 0.07, at: at + 0.05 });
    s.noise({ dur: 0.03, freq: 2500, q: 1, gain: 0.04, at: at + 0.1 });
  },
  double: (s, at) => {
    s.tone({ freq: 880, dur: 0.05, wave: "triangle", gain: 0.07, at });
    s.tone({ freq: 1320, to: 700, dur: 0.07, wave: "triangle", gain: 0.07, at: at + 0.05 });
    [0.15, 0.28].forEach((d) => s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.14, at: at + d }));
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.09, at: at + 0.4 });
  },
  replayed: (s, at) => {
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.12, at: at + 0.02 });
    s.tone({ freq: 150, to: 90, dur: 0.08, gain: 0.12, at: at + 0.02 });
    s.tone({ freq: 1568, dur: 0.14, gain: 0.06, at: at + 0.12 });
    s.tone({ freq: 2093, dur: 0.14, gain: 0.04, at: at + 0.2 });
  },
  insert: (s, at) => s.noise({ dur: 0.05, freq: 300, q: 1, gain: 0.07, at }),
  conflict: (s, at) => {
    s.noise({ dur: 0.03, freq: 500, q: 1, gain: 0.05, at });
    s.tone({ freq: 330, to: 200, dur: 0.07, wave: "triangle", gain: 0.08, at });
    s.tone({ freq: 523, dur: 0.08, gain: 0.05, at: at + 0.12 });
  },
  done: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.14, at: at + 0.1 });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.14, at: at + 0.1 });
  },
  busy: (s, at) => s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.06, at }),
  crash: (s, at) => {
    s.noise({ dur: 0.2, freq: 150, q: 0.7, gain: 0.2, at: at + 0.02 });
    s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.08, at: at + 0.05 });
  },
  takeover: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  // Часы БД, как в серии: секунды — тик-тик, полминуты — трель.
  tick: (s, at, e) => {
    const long = (e.n ?? 0) >= 20;
    const n = long ? 6 : 2;
    for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: long ? 0.015 : 0.02, wave: "square", gain: long ? 0.035 : 0.04, at: at + 0.04 + (long ? 0.04 : 0.1) * i });
  },
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
  // Хвосты рецептов не выходят из окна событий: голос диктора — с 0.5 с.
  const t: Sound = {
    ...s,
    tone: (o) => s.tone({ ...o, at: Math.min(o.at ?? 0, EVENT_WINDOW) }),
    noise: (o) => s.noise({ ...o, at: Math.min(o.at ?? 0, EVENT_WINDOW) }),
  };
  const events = score(w, replay);
  const quiet = events.some((e) => e.kind === "double");
  const step = events.length > 1 ? (EVENT_WINDOW - 0.2) / (events.length - 1) : 0;
  events.forEach((e, i) => RECIPES[e.kind]!(t, i * step, e, quiet));
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
  else if (speakable(w.bank)) s.babble(BANK_VOICE, w.bank, BABBLE_AT);
}
