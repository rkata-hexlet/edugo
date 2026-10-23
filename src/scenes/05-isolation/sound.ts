import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Озвучка эпизода (черновик MVP по словарю серии, карту sound-designer — после утверждения сюжета):
// чтение — тихий низкий щелчок, запись — тон пода, ожидание замка — тиканье, COMMIT — глухой «пум»,
// 0 строк — пустой «тук», 40001 — резкий «бзз», заказ принят — «динь», нет в наличии — мягкий спад.
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

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
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.14, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  press: (s, at) => s.tone({ freq: 1500, dur: 0.02, wave: "square", gain: 0.05, at }),
  read: (s, at) => {
    s.tone({ freq: 160, to: 90, dur: 0.08, gain: 0.08, at });
    s.noise({ dur: 0.04, freq: 300, q: 1, gain: 0.05, at });
  },
  write: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.08, at }),
  wait: (s, at) => {
    for (let i = 0; i < 3; i++) s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.035, at: at + 0.08 * i });
  },
  insert: (s, at) => s.tone({ freq: 900, to: 1100, dur: 0.04, wave: "triangle", gain: 0.06, at }),
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.14, at });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.14, at });
  },
  zero: (s, at) => s.tone({ freq: 260, dur: 0.06, wave: "triangle", gain: 0.08, at }),
  fail: (s, at) => {
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at });
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.09, at: at + 0.12 });
  },
  retry: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.08, at }),
  none: (s, at) => s.tone({ freq: 500, to: 330, dur: 0.15, wave: "triangle", gain: 0.06, at }),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lamp && lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

/** Лесенка кадра: действия идут по порядку событий; последнему остаётся место на хвост рецепта (≤ 0.15 с). */
function slots(n: number): number[] {
  const step = n > 1 ? Math.min(0.08, (EVENT_WINDOW - 0.16) / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => i * step);
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

/** Озвучить кадр; replay — повтор в итоге: тише и без «перелистывания». */
export function sound(out: Sound, w: World, replay = false): void {
  const s = scaled(out, replay ? 0.7 : 1);
  const events = w.events.filter((e) => RECIPES[e.kind] && !(replay && e.kind === "page"));
  const at = slots(events.length);
  events.forEach((e, i) => RECIPES[e.kind]!(s, at[i], e));
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
