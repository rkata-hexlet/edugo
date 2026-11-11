import type { Sound } from "../../engine/contract";
import type { World } from "./sim";

// Звук наброска — черновик: вердикт, правка прибора, новый класс на полке. Только из `events`.

type Recipe = (s: Sound, at: number) => void;

const RECIPES: Record<string, Recipe> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  red: (s, at) => s.tone({ freq: 220, dur: 0.18, wave: "square", gain: 0.08, at }),
  green: (s, at) => {
    s.tone({ freq: 784, dur: 0.1, gain: 0.08, at });
    s.tone({ freq: 1047, dur: 0.16, gain: 0.08, at: at + 0.1 });
  },
  edit: (s, at) => s.noise({ dur: 0.08, freq: 3000, q: 1, gain: 0.04, at }),
  met: (s, at) => s.tone({ freq: 1319, to: 1568, dur: 0.12, gain: 0.06, at: at + 0.05 }),
};

export function sound(s: Sound, w: World): void {
  w.events.forEach((e, i) => RECIPES[e.kind]?.(s, Math.min(0.06 * i, 0.4)));
}
