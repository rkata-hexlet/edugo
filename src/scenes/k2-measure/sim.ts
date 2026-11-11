import type { Staged } from "../../kit/director";

// Модель наброска «Почему верная починка не проходит с первого раза» (поиск формата кухни, 11.11): не симуляция,
// а доска объяснения. Схема стенда из звеньев — виртуалка с сервисом и базой, нагрузка, графики и алерт, набор
// починок, проверка, вердикт и CI, площадка вокруг. Правки копятся на звеньях.
// Звук выбирает sound.ts только по `events`.

/** Три причины: почему верное решение не проходит проверку с первого раза. Только недетерминированные — те, что
 * не закрываются разовой правкой кода проверки (решение пользователя 11.11). */
export const CLASSES = ["данные запаздывают", "шум как сигнал", "нагрузка не та"] as const;
/** Советы итога — по одному на причину. */
export const TIPS = [
  "Ждём и смотрим дольше самой большой задержки",
  "Меряем без соседей и с запасом до порога",
  "Нагрузка как в жизни, повторов — с запасом",
];
export type ClassNo = 0 | 1 | 2;

/** Станции круга задачи внутри главы «нагрузка не та». */
export const STATIONS = ["не сходится", "почему", "правка", "снова"] as const;

/** Звенья схемы. `deck` — набор верных и ложных починок. */
export const LINKS = ["site", "load", "vm", "graphs", "deck", "check", "verdict"] as const;
export type Link = (typeof LINKS)[number];
/** Звенья, на которые ложатся правки (в итоге — счёт). Решение (верная починка) правок не получает. */
export const EDITABLE = ["site", "load", "check"] as const satisfies readonly Link[];
export type Editable = (typeof EDITABLE)[number];

export type Focus = Link | "loop" | "shelf" | "pic";
export type Lamp = "red" | "green" | null;

/** Картинка примера: график, столбики или «думали / на стенде». */
export type Picture =
  | { kind: "chart"; title: string; points: number[]; mark: { at: number; label: string } | null; note: string | null; bad: boolean }
  | { kind: "bars"; title: string; bars: { label: string; value: number; text: string; bad: boolean }[] }
  | { kind: "vs"; title: string; left: { head: string; text: string }; right: { head: string; text: string; bad: boolean } };

export interface World extends Staged<Focus> {
  title: { head: string; text: string } | null;
  on: Record<Link, boolean>;
  /** Правки звена: отметки копятся, числа — только в итоге (`tally`). */
  edits: Record<Editable, number>;
  site: string;
  load: "steady" | "bursts";
  /** Поломка в сервисе видна (трещина), пока на сервисе нет починки. */
  fault: boolean;
  alert: boolean;
  /** Починка из набора, которую сейчас примерили к сервису. */
  card: { right: boolean; name: string } | null;
  /** Что сейчас считает проверка. */
  check: string;
  /** Вердикт проверки и чего мы ждали от этой починки; не совпало — CI красный. */
  verdict: { lamp: Lamp; expect: Lamp };
  /** Сверка CI видна: в пути задачи вердикт показан без CI, где CI в истории не участвовал. */
  ciOn: boolean;
  loop: { on: boolean; at: number | null; lap: number };
  /** Номера подозреваемых 1–3 у звеньев (хук). */
  suspects: Link[];
  /** Строка правила главы, 4–6 слов, на месте картинки. */
  rule: string | null;
  shelf: { on: boolean; met: ClassNo[]; active: ClassNo | null };
  pic: Picture | null;
  /** Итог: счёт правок на звеньях и рамка «измерение» вокруг всего, кроме решения. */
  tally: boolean;
  moral: string | null;
  /** Итоговый список советов: сколько строк открыто и честная оговорка под ними. */
  tips: { shown: number; caveat: string | null } | null;
}

export function world(): World {
  return {
    sql: [], db: null, plate: null, stamp: null, term: null, focus: null, chapter: null, board: null,
    events: [], frame: 0, scene: 0,
    title: null,
    on: { site: false, load: false, vm: false, graphs: false, deck: false, check: false, verdict: false },
    edits: { site: 0, load: 0, check: 0 },
    site: "ноутбук",
    load: "steady",
    fault: true,
    alert: false,
    card: null,
    check: "ошибки и время ответа",
    verdict: { lamp: null, expect: null },
    ciOn: true,
    loop: { on: false, at: null, lap: 0 },
    suspects: [],
    rule: null,
    shelf: { on: false, met: [], active: null },
    pic: null,
    tally: false,
    moral: null,
    tips: null,
  };
}

/** CI сверяет вердикт с ожидаемым: null — сверять нечего. */
export function ci(w: World): "green" | "red" | null {
  const { lamp, expect } = w.verdict;
  return w.ciOn && lamp && expect ? (lamp === expect ? "green" : "red") : null;
}
