import type { Mood } from "../../kit/characters";
import type { Staged } from "../../kit/director";

// Модель наброска «Врёт не решение, а прибор» (поиск формата кухни, 11.11): не симуляция, а доска объяснения.
// Цепочка «решение → прибор → вердикт», круг цикла, полка пяти классов, картинка примера, двое у стенда.
// Звук выбирает sound.ts только по `events`.

/** Пять классов: почему верное решение не проходит проверку с первого раза. */
export const CLASSES = ["окно перехода", "шум как сигнал", "нагрузка не та", "мерим не то", "модель ≠ стенд"] as const;
export type ClassNo = 0 | 1 | 2 | 3 | 4;

/** Станции цикла. */
export const STATIONS = ["красное", "почему", "правка", "снова"] as const;

export const CREW = ["agent", "author"] as const;
export type Who = (typeof CREW)[number];

export type Focus = "chain" | "fix" | "gauge" | "loop" | "shelf" | "pic" | Who;

/** Картинка примера: график с порогом, столбики или «на бумаге / на стенде». */
export type Picture =
  | { kind: "chart"; title: string; points: number[]; limit: number | null; mark: { at: number; label: string } | null; bad: boolean }
  | { kind: "bars"; title: string; bars: { label: string; value: number; text: string; bad: boolean }[] }
  | { kind: "vs"; title: string; left: { head: string; text: string }; right: { head: string; text: string; bad: boolean } };

export interface World extends Staged<Focus> {
  title: { head: string; text: string } | null;
  /** Цепочка проверки: решение, прибор между ним и вердиктом, вердикт. */
  chain: {
    on: boolean;
    fix: string; // верное решение — не меняется весь ролик
    fixEdits: number;
    gauge: string; // что меряет прибор
    gaugeEdits: number;
    verdict: "red" | "green" | null;
  };
  /** Круг цикла; at — где сейчас метка, lap — номер круга. */
  loop: { on: boolean; at: number | null; lap: number };
  /** Полка классов: какие уже встретились, о каком речь; byMeet — гнёзда заполняются по порядку встречи (цикл). */
  shelf: { on: boolean; met: ClassNo[]; active: ClassNo | null; byMeet: boolean };
  pic: Picture | null;
  crew: Record<Who, { on: boolean; mood: Mood; say: string | null }>;
  /** Итоговая мысль крупно — один кадр. */
  moral: string | null;
}

export function world(): World {
  return {
    sql: [], db: null, plate: null, stamp: null, term: null, focus: null, chapter: null, board: null,
    events: [], frame: 0, scene: 0,
    title: null,
    chain: { on: false, fix: "верная починка", fixEdits: 0, gauge: "", gaugeEdits: 0, verdict: null },
    loop: { on: false, at: null, lap: 0 },
    shelf: { on: false, met: [], active: null, byMeet: false },
    pic: null,
    crew: { agent: { on: false, mood: "idle", say: null }, author: { on: false, mood: "idle", say: null } },
    moral: null,
  };
}
