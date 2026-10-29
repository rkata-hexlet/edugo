import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, LAST_PAGE, type SimEvent, type World } from "./sim";

// Звук эпизода 13 по разбору sound-designer (`docs/reviews/13-sound-designer-polish.md`): только из событий модели. Звуки событий — в окне 0–0.45 с,
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
  count: (s, at) => [0, 0.05, 0.1].forEach((d) => s.noise({ dur: 0.02, freq: 3000, q: 1.5, gain: 0.03, at: at + d })),
  fetch: (s, at) => s.noise({ dur: 0.1, freq: 2200, q: 0.8, gain: 0.04, at }),
  // Изменения строки различимы на слух: подъём — плавный рост, вспышка — два щелчка, зачёркивание — штрих и стук.
  insert: (s, at) => s.tone({ freq: 784, to: 988, dur: 0.12, gain: 0.07, at }),
  delete: (s, at) => {
    s.noise({ dur: 0.22, freq: 2500, q: 1, gain: 0.04, at });
    s.tone({ freq: 330, to: 220, dur: 0.1, wave: "triangle", gain: 0.06, at: at + 0.2 });
  },
  update: (s, at) => {
    s.tone({ freq: 880, dur: 0.04, wave: "triangle", gain: 0.05, at });
    s.tone({ freq: 1047, dur: 0.05, wave: "triangle", gain: 0.05, at: at + 0.06 });
  },
  jump: (s, at) => s.tone({ freq: 300, to: 180, dur: 0.15, wave: "square", gain: 0.06, at }),
  // Флажок воткнули: колокольчик с октавой вниз.
  mark: (s, at) => {
    s.tone({ freq: 1175, dur: 0.14, gain: 0.05, at });
    s.tone({ freq: 587, dur: 0.08, gain: 0.04, at });
  },
  dup: (s, at) => {
    s.tone({ freq: 200, dur: 0.08, wave: "square", gain: 0.1, at });
    s.tone({ freq: 200, dur: 0.08, wave: "square", gain: 0.1, at: at + 0.11 });
  },
  lost: (s, at) => s.tone({ freq: 500, to: 120, dur: 0.19, wave: "triangle", gain: 0.08, at }),
  // Выброшенное растёт с глубиной: страница 2 → 0.22 с, 3 → 0.32 с, дальше 0.4 с; последняя — громче.
  trash: (s, at, e) => {
    const page = e.page ?? 2;
    s.noise({ dur: Math.min(0.12 + 0.1 * (page - 1), 0.4), freq: 400, q: 0.6, gain: page === LAST_PAGE ? 0.08 : 0.06, at });
  },
  verdict: (s, at, e) => e.lamps?.filter((lamp) => lamp).forEach((lamp, i) => lampTone(s, at + 0.08 * i, lamp!)),
};

/** Лесенка по ходу кадра: событие выдачи → нажатие → отсчёт → страница → итог, табло — последним.
 *  Беда (dup, lost) кончается к 0.34 с, лампы — с 0.36 с: между бедой и лампой пауза. */
const SLOT_AT: Partial<Record<EventKind, number>> = {
  insert: 0.05, delete: 0.05, update: 0.05, press: 0.1, jump: 0.1, count: 0.12, dup: 0.15, lost: 0.15, fetch: 0.2, trash: 0.2, mark: 0.25, verdict: 0.36,
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
