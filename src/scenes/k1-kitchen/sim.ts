import type { Mood } from "../../kit/characters";
import type { Staged } from "../../kit/director";

// Модель «Внутренней кухни» (сценарий docs/episodes/kitchen-01-late-emails.md): не симуляция базы, а сцена
// съёмочной группы. Кто на площадке, кто что сказал, что показывают графики и печати трюков.
// Событие подачи — для звука; звук и эффекты выбирают sound.ts и view.ts только по `events`.

/** Съёмочная группа. Режиссёр — пользователь; остальные — роли агентов. */
export const CREW = ["director", "stunt", "exec", "arch", "method"] as const;
export type Who = (typeof CREW)[number];

export interface Member {
  on: boolean; // в кадре
  mood: Mood;
  say: string | null; // реплика — живёт один кадр
  bow: boolean; // поклон в титрах
}

/** О чём кадр: это ярко, остальное приглушено. */
export type Focus = Who | "stage" | "chart" | "inbox" | "art" | "seals";

/** Печать трюка: ЗАСЧИТАН — проверка отработала как надо; СОРВАН — дубль сорвался. */
export interface Seal {
  name: string;
  ok: boolean;
  note: string;
}

export type EventKind =
  | "page" | "rewind" | "card" | "verdict" // от режиссёра серии
  | "clap" | "stop" | "seal" | "say" | "alert" | "freeze" | "letters" | "applause" | "needle";

export interface World extends Staged<Focus> {
  /** Титульная карточка ролика. */
  title: { head: string; text: string } | null;
  /** Хлопушка «Сцена N, дубль M» — один кадр. */
  clap: { scene: string; take: number } | null;
  /** Красный штамп «СТОП!» и за что — один кадр. */
  stop: string | null;
  crew: Record<Who, Member>;
  /** Площадка: восемь (или 16) обработчиков, очередь, хозяин-сосед, распродажа. */
  stage: {
    on: boolean;
    workers: number;
    spread: boolean; // SKIP LOCKED: каждый у своей строки
    queue: number; // сколько строк видно в очереди (хвост — «+N»)
    tail: string | null; // подпись хвоста
    host: "none" | "busy" | "frozen"; // хозяин площадки — сюжет про пул соединений
    sale: boolean;
  };
  inbox: { on: boolean; letters: number; repeats: number };
  chart: { on: boolean; points: number[]; alert: boolean };
  /** Вставка настоящего артефакта: строки лога, вывод команды. Один кадр. */
  art: { title: string; lines: string[] } | null;
  seals: Seal[];
  needle: boolean; // иголка в водопаде
  /** Счётчик сорванных дублей; показывается только в кадре, где меняется. */
  fails: number;
  failsShown: boolean;
  /** Счётчик ложных трюков. */
  tricks: { honest: number; fake: number } | null;
  credits: string[] | null;
}

const member = (on = false): Member => ({ on, mood: "idle", say: null, bow: false });

export function world(): World {
  return {
    sql: [], db: null, plate: null, stamp: null, term: null, focus: null, chapter: null, board: null,
    events: [], frame: 0, scene: 0,
    title: null, clap: null, stop: null,
    crew: { director: member(), stunt: member(), exec: member(), arch: member(), method: member() },
    stage: { on: false, workers: 8, spread: false, queue: 6, tail: null, host: "none", sale: false },
    inbox: { on: false, letters: 0, repeats: 0 },
    chart: { on: false, points: [], alert: false },
    art: null, seals: [], needle: false, fails: 0, failsShown: false, tricks: null, credits: null,
  };
}

/** Ровная линия отставания, затем рост с распродажи; `rise` — сколько точек роста. */
export function lagPoints(rise: number, fall = 0): number[] {
  const flat = Array.from({ length: 8 }, () => 0.08);
  const up = Array.from({ length: rise }, (_, i) => 0.08 + (0.9 * (i + 1)) / Math.max(rise, 1));
  const top = up.at(-1) ?? 0.08;
  const down = Array.from({ length: fall }, (_, i) => top * (1 - (i + 1) / fall) + 0.04);
  return [...flat, ...up, ...down];
}
