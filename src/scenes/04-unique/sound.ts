import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Озвучка эпизода (MVP, по словарю эпизодов 01–03; карту sound-designer — после утверждения сюжета): клик — тихий
// «тик», «Новая!» — звонкий «динь», повтор — глухой «тук», сброс — «бум», ящик вырос — восходящий тон, не вырос —
// ровный, слияние — аккорд, толпа — шорох. Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинает бормотать Postgres — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

type Recipe = (s: Sound, at: number, e: SimEvent, i: number) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.14, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  click: (s, at) => s.tone({ freq: 1500, dur: 0.015, wave: "square", gain: 0.04, at }),
  cookie: (s, at) => s.tone({ freq: 900, to: 1200, dur: 0.08, wave: "triangle", gain: 0.07, at: at + 0.1 }),
  new: (s, at) => s.tone({ freq: 1319, to: 1568, dur: 0.08, gain: 0.07, at: at + 0.12 }),
  known: (s, at) => s.tone({ freq: 330, dur: 0.06, wave: "triangle", gain: 0.07, at: at + 0.12 }),
  flush: (s, at) => {
    s.noise({ dur: 0.1, freq: 180, q: 1, gain: 0.14, at: at + 0.2 });
    s.tone({ freq: 100, to: 50, dur: 0.15, gain: 0.14, at: at + 0.2 });
  },
  insert: (s, at) => s.tone({ freq: 660, dur: 0.05, gain: 0.07, at: at + 0.25 }),
  skip: (s, at) => s.tone({ freq: 880, to: 1175, dur: 0.08, gain: 0.07, at: at + 0.3 }),
  reg: (s, at) => s.tone({ freq: 523, to: 1047, dur: 0.15, wave: "triangle", gain: 0.08, at: at + 0.1 }),
  flat: (s, at) => s.tone({ freq: 440, dur: 0.12, wave: "triangle", gain: 0.06, at: at + 0.1 }),
  merge: (s, at) => [523, 659, 784].forEach((f, i) => s.tone({ freq: f, dur: 0.18, gain: 0.05, at: at + 0.15 + 0.04 * i })),
  flood: (s, at) => {
    s.noise({ dur: 0.4, freq: 2500, q: 0.5, gain: 0.04, at: at + 0.02 });
    for (let i = 0; i < 5; i++) s.tone({ freq: 500 + 120 * i, dur: 0.05, wave: "triangle", gain: 0.04, at: at + 0.05 + 0.07 * i });
  },
  grow: (s, at) => s.noise({ dur: 0.4, freq: 900, q: 0.7, gain: 0.06, at: at + 0.02 }),
  sum: (s, at) => {
    s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at: at + 0.1 });
    s.tone({ freq: 196, dur: 0.15, wave: "square", gain: 0.08, at: at + 0.25 });
  },
  no: (s, at) => s.tone({ freq: 300, to: 150, dur: 0.2, wave: "sawtooth", gain: 0.07, at: at + 0.1 }),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lamp && lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

const REPEAT: Partial<Record<EventKind, { max: number; step: number }>> = {
  click: { max: 3, step: 0.06 }, new: { max: 3, step: 0.08 }, flush: { max: 2, step: 0.1 }, insert: { max: 2, step: 0.08 },
  reg: { max: 2, step: 0.15 }, flat: { max: 2, step: 0.15 },
};

const SLOT: Partial<Record<EventKind, number>> = { verdict: 0.25 };

function clockTicks(s: Sound, dt: number): void {
  const n = Math.min(Math.max(dt, 1), 3);
  for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: 0.02, wave: "square", gain: 0.04, at: 0.05 + i * 0.1 });
}

function scaled(s: Sound, k: number): Sound {
  if (k === 1) return s;
  return {
    tone: (o) => s.tone({ ...o, gain: (o.gain ?? 0.1) * k }),
    noise: (o) => s.noise({ ...o, gain: (o.gain ?? 0.1) * k }),
    babble: (v, t, at) => s.babble({ ...v, gain: v.gain * k }, t, at),
  };
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

/** Озвучить кадр; replay — повтор в итоге: тише, без часов и провалов, по одному звуку на событие. */
export function sound(out: Sound, w: World, replay = false): void {
  if (w.flashback) return; // кадр эпизода 03 — тишина под голос
  const s = scaled(out, replay ? 0.7 : 1);
  const byKind = new Map<EventKind, SimEvent[]>();
  for (const e of w.events) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  if (replay) for (const k of ["clock", "flood", "grow", "sum", "no", "page"] as const) byKind.delete(k);

  for (const [kind, events] of byKind) {
    if (kind === "clock") {
      clockTicks(s, events.reduce((sum, e) => sum + (e.n ?? 0), 0));
      continue;
    }
    const recipe = RECIPES[kind];
    if (!recipe) continue;
    const rep = replay ? { max: 1, step: 0 } : (REPEAT[kind] ?? { max: 1, step: 0 });
    const base = SLOT[kind] ?? 0;
    events.slice(0, rep.max).forEach((e, i) => recipe(s, Math.min(base + i * rep.step, EVENT_WINDOW - 0.3), e, i));
  }

  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
