import type { Sound, Voice } from "../../engine/contract";
import type { EventKind, SimEvent, World } from "./sim";

// Звук эпизода 14 — черновик MVP: только из событий модели. Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор;
// дальше только бормотание Postgres, тихо. Карту звуков доводит sound-designer в фазе 2.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинает бормотать Postgres — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

type Recipe = (s: Sound, at: number, e: SimEvent) => void;

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.tone({ freq: 110, to: 60, dur: 0.1, gain: 0.12, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  // Пульт: щелчок тумблера; ползунок — шорох.
  toggle: (s, at) => {
    s.tone({ freq: 1200, dur: 0.03, wave: "square", gain: 0.06, at });
    s.tone({ freq: 600, dur: 0.04, wave: "square", gain: 0.05, at: at + 0.04 });
  },
  slide: (s, at) => s.noise({ dur: 0.2, freq: 2400, q: 1.2, gain: 0.03, at }),
  coin: (s, at) => s.tone({ freq: 2093, to: 2637, dur: 0.06, wave: "triangle", gain: 0.05, at }),
  ask: (s, at) => s.tone({ freq: 660, to: 880, dur: 0.08, gain: 0.05, at }),
  hang: (s, at) => s.tone({ freq: 300, dur: 0.18, wave: "triangle", gain: 0.05, at }),
  down: (s, at) => s.tone({ freq: 440, to: 110, dur: 0.25, wave: "sawtooth", gain: 0.07, at }),
  copy: (s, at) => s.noise({ dur: 0.08, freq: 3000, q: 1, gain: 0.03, at }),
  refresh: (s, at) => s.tone({ freq: 988, dur: 0.05, gain: 0.04, at }),
  fail: (s, at) => s.tone({ freq: 250, dur: 0.08, wave: "square", gain: 0.05, at }),
  cold: (s, at) => s.tone({ freq: 392, to: 330, dur: 0.12, wave: "triangle", gain: 0.06, at }),
  crash: (s, at) => {
    s.noise({ dur: 0.15, freq: 300, q: 0.6, gain: 0.08, at });
    s.tone({ freq: 160, to: 80, dur: 0.15, wave: "square", gain: 0.07, at: at + 0.05 });
  },
  write: (s, at) => s.tone({ freq: 784, to: 988, dur: 0.12, gain: 0.07, at }),
  cancel: (s, at) => {
    s.noise({ dur: 0.22, freq: 2500, q: 1, gain: 0.04, at });
    s.tone({ freq: 330, to: 220, dur: 0.1, wave: "triangle", gain: 0.06, at: at + 0.2 });
  },
  keep: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.06, at }),
  expand: (s, at) => {
    s.tone({ freq: 523, dur: 0.08, gain: 0.05, at });
    s.tone({ freq: 784, dur: 0.1, gain: 0.05, at: at + 0.08 });
  },
  contract: (s, at) => s.noise({ dur: 0.3, freq: 400, q: 0.6, gain: 0.06, at }),
};

/** Лесенка по ходу кадра: пульт → сервис → под → данные. */
const SLOT_AT: Partial<Record<EventKind, number>> = {
  toggle: 0.05, slide: 0.05, down: 0.05, crash: 0.05, coin: 0.1, ask: 0.1, copy: 0.1, refresh: 0.1, cold: 0.1, expand: 0.1,
  hang: 0.2, fail: 0.2, write: 0.2, contract: 0.2, cancel: 0.15, keep: 0.25,
};

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

/** Озвучить кадр; replay — повтор в итоге: тише, по одному звуку на событие. */
export function sound(out: Sound, w: World, replay = false): void {
  const s = scaled(out, replay ? 0.7 : 1);
  const byKind = new Map<EventKind, SimEvent[]>();
  for (const e of w.events) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  if (byKind.has("rewind")) byKind.delete("page");
  for (const [kind, events] of byKind) {
    const recipe = RECIPES[kind];
    if (!recipe) continue;
    const max = replay ? 1 : 2;
    events.slice(0, max).forEach((e, i) => recipe(s, Math.min((SLOT_AT[kind] ?? 0) + i * 0.1, EVENT_WINDOW), e));
  }
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
