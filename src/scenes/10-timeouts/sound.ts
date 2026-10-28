import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Звук-черновик MVP (до карты sound-designer): только из событий модели. Звуки событий — в окне 0–0.45 с,
// с 0.5 с говорит диктор; дальше только бормотание Postgres, тихо.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинает бормотать Postgres — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

type Recipe = (s: Sound, at: number, e: SimEvent) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.tone({ freq: 110, to: 60, dur: 0.1, gain: 0.12, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  search: (s, at) => s.tone({ freq: 900, to: 1200, dur: 0.04, wave: "square", gain: 0.05, at }),
  slot: (s, at) => s.tone({ freq: 300, dur: 0.05, wave: "triangle", gain: 0.06, at }),
  release: (s, at) => s.tone({ freq: 500, to: 800, dur: 0.06, wave: "triangle", gain: 0.05, at }),
  call: (s, at) => s.tone({ freq: 440, to: 520, dur: 0.08, gain: 0.06, at }),
  retry: (s, at) => s.tone({ freq: 520, to: 440, dur: 0.08, wave: "triangle", gain: 0.06, at }),
  timeout: (s, at) => {
    s.noise({ dur: 0.04, freq: 1500, q: 1, gain: 0.06, at });
    s.tone({ freq: 600, to: 300, dur: 0.1, wave: "triangle", gain: 0.07, at });
  },
  confirm: (s, at) => s.tone({ freq: 784, dur: 0.06, gain: 0.06, at }),
  dup: (s, at) => {
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.1, at });
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.1, at: at + 0.13 });
  },
  found: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.07, at }),
  jam: (s, at) => {
    s.tone({ freq: 90, to: 130, dur: 0.35, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.35, freq: 200, q: 1.5, gain: 0.05, at });
  },
  wave: (s, at) => s.noise({ dur: 0.4, freq: 2500, q: 0.5, gain: 0.04, at }),
  spread: (s, at) => [0, 0.12, 0.27].forEach((dt) => s.tone({ freq: 1400, dur: 0.02, wave: "square", gain: 0.04, at: at + dt })),
  trip: (s, at) => s.noise({ dur: 0.05, freq: 300, q: 1, gain: 0.12, at }),
  probe: (s, at) => s.tone({ freq: 660, dur: 0.05, wave: "triangle", gain: 0.05, at }),
  close: (s, at) => s.tone({ freq: 880, to: 1100, dur: 0.06, gain: 0.06, at }),
  fast: (s, at) => s.tone({ freq: 700, dur: 0.03, wave: "triangle", gain: 0.04, at }),
  down: (s, at) => s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.08, at }),
  up: (s, at) => s.tone({ freq: 400, to: 900, dur: 0.2, wave: "triangle", gain: 0.07, at }),
  booked: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.07, at }),
  unknown: (s, at) => s.tone({ freq: 600, to: 700, dur: 0.12, wave: "triangle", gain: 0.06, at }),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lamp && lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

/** Лесенка: часы и вызов — раньше ответа, табло — последним. */
const SLOT_AT: Partial<Record<EventKind, number>> = {
  timeout: 0.1, release: 0.15, confirm: 0.15, found: 0.2, dup: 0.2, booked: 0.2, unknown: 0.2, trip: 0.15, verdict: 0.3,
};

function clockTicks(s: Sound, ms: number): void {
  const n = ms >= 60_000 ? 8 : 2;
  for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.035, at: 0.04 * i });
}

/** Тот же звук, громкость × k: повтор в итоге — «воспоминание», тише исходного. */
function scaled(s: Sound, k: number): Sound {
  if (k === 1) return s;
  return {
    tone: (o) => s.tone({ ...o, gain: (o.gain ?? 0.1) * k }),
    noise: (o) => s.noise({ ...o, gain: (o.gain ?? 0.1) * k }),
    babble: (v, t, at) => s.babble({ ...v, gain: v.gain * k }, t, at),
  };
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

/** Озвучить кадр; replay — повтор в итоге: тише, без часов, по одному звуку на событие. */
export function sound(out: Sound, w: World, replay = false): void {
  const s = scaled(out, replay ? 0.7 : 1);
  const byKind = new Map<EventKind, SimEvent[]>();
  for (const e of w.events) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  if (byKind.has("rewind")) byKind.delete("page");
  if (replay) byKind.delete("clock");
  for (const [kind, events] of byKind) {
    if (kind === "clock") {
      clockTicks(s, events.reduce((sum, e) => sum + (e.n ?? 0), 0));
      continue;
    }
    const recipe = RECIPES[kind];
    if (!recipe) continue;
    const max = replay ? 1 : 2;
    events.slice(0, max).forEach((e, i) => recipe(s, Math.min((SLOT_AT[kind] ?? 0) + i * 0.1, EVENT_WINDOW), e));
  }
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
