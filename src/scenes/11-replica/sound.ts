import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Звук-черновик MVP эпизода 11 (до карты sound-designer): только из событий модели. Звуки событий — в окне 0–0.45 с,
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
  press: (s, at) => s.tone({ freq: 900, to: 1200, dur: 0.04, wave: "square", gain: 0.05, at }),
  commit: (s, at) => s.tone({ freq: 784, dur: 0.06, gain: 0.06, at }),
  dup: (s, at) => {
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.1, at });
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.1, at: at + 0.13 });
  },
  hang: (s, at) => s.tone({ freq: 300, to: 280, dur: 0.3, wave: "triangle", gain: 0.06, at }),
  flood: (s, at) => [0, 0.06, 0.12, 0.18, 0.24].forEach((dt) => s.tone({ freq: 1400, dur: 0.02, wave: "square", gain: 0.03, at: at + dt })),
  read: (s, at) => s.tone({ freq: 440, to: 520, dur: 0.06, gain: 0.05, at }),
  seen: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.07, at }),
  empty: (s, at) => s.tone({ freq: 400, to: 250, dur: 0.15, wave: "triangle", gain: 0.07, at }),
  seal: (s, at) => s.tone({ freq: 600, to: 900, dur: 0.08, wave: "triangle", gain: 0.06, at }),
  unseal: (s, at) => s.tone({ freq: 900, to: 500, dur: 0.1, wave: "triangle", gain: 0.06, at }),
  ticket: (s, at) => s.noise({ dur: 0.06, freq: 2500, q: 1, gain: 0.05, at }),
  check: (s, at) => s.tone({ freq: 880, to: 1100, dur: 0.05, gain: 0.05, at }),
  skip: (s, at) => s.tone({ freq: 300, dur: 0.05, wave: "square", gain: 0.05, at }),
  free: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.06, at }),
  down: (s, at) => s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.08, at }),
  crowd: (s, at) => s.noise({ dur: 0.3, freq: 900, q: 0.5, gain: 0.03, at }),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lamp && lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

/** Лесенка: нажатие и запись — раньше чтения, табло — последним. */
const SLOT_AT: Partial<Record<EventKind, number>> = {
  commit: 0.05, dup: 0.05, ticket: 0.1, seal: 0.1, read: 0.15, check: 0.15, skip: 0.15, seen: 0.2, empty: 0.2, unseal: 0.1, verdict: 0.3,
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
