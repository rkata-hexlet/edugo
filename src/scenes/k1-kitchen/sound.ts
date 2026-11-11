import type { Sound, Voice } from "../../engine/contract";
import { CREW, type Who, type World } from "./sim";

// Звук «Внутренней кухни» — черновик для sound-designer. Диктора нет, поэтому звук несёт ритм: щелчок хлопушки,
// зуммер «СТОП!», удар печати, бормотание реплик. Звуки событий — в первые 0,45 с кадра.

export const EVENT_WINDOW = 0.45;

/** Голоса группы: бормотание без слов, у каждого свой тембр. Режиссёр говорит синтезом — его не бормочем. */
const VOICES: Record<Exclude<Who, "director">, Voice> = {
  stunt: { wave: "square", pitch: 180, rate: 9, spread: 4, gain: 0.05 },
  exec: { wave: "triangle", pitch: 240, rate: 8, spread: 3, gain: 0.07 },
  arch: { wave: "sine", pitch: 150, rate: 6, spread: 2, gain: 0.08 },
  method: { wave: "sine", pitch: 300, rate: 7, spread: 3, gain: 0.07 },
};

type Recipe = (s: Sound, at: number) => void;

const RECIPES: Record<string, Recipe> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  // Хлопушка: сухой щелчок дерева.
  clap: (s, at) => {
    s.noise({ dur: 0.04, freq: 2500, q: 1.5, gain: 0.25, at: at + 0.2 });
    s.tone({ freq: 900, to: 400, dur: 0.03, wave: "square", gain: 0.08, at: at + 0.2 });
  },
  // «СТОП!» — низкий зуммер.
  stop: (s, at) => s.tone({ freq: 140, dur: 0.35, wave: "square", gain: 0.08, at: at + 0.05 }),
  alert: (s, at) => {
    s.tone({ freq: 880, dur: 0.1, gain: 0.08, at });
    s.tone({ freq: 660, dur: 0.1, gain: 0.08, at: at + 0.14 });
  },
  freeze: (s, at) => [0, 0.06, 0.12].forEach((dt, i) => s.tone({ freq: 2000 + 400 * i, dur: 0.08, gain: 0.04, at: at + dt })),
  letters: (s, at) => {
    for (let i = 0; i < 5; i++) s.tone({ freq: 1500, dur: 0.02, wave: "square", gain: 0.03, at: at + 0.05 * i });
  },
  applause: (s, at) => s.noise({ dur: 0.4, freq: 3000, q: 0.4, gain: 0.05, at }),
  needle: (s, at) => s.noise({ dur: 0.4, freq: 1200, q: 0.3, gain: 0.04, at }),
};

/** Удар печати: засчитан — звонко, сорван — глухо. */
const seal = (s: Sound, at: number, ok: boolean) =>
  ok ? s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at }) : s.tone({ freq: 220, dur: 0.14, wave: "square", gain: 0.09, at });

export function sound(s: Sound, w: World): void {
  w.events.forEach((e, i) => {
    const at = Math.min(0.05 * i, EVENT_WINDOW - 0.05);
    if (e.kind === "seal") seal(s, at, e.lamps?.[0] === "green");
    else RECIPES[e.kind]?.(s, at);
  });
  for (const k of CREW) {
    const say = w.crew[k].say;
    if (k !== "director" && say) s.babble(VOICES[k], say, 0.5);
  }
}
