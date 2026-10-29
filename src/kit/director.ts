import type { Step } from "../engine/contract";

// Режиссёр серии: из глаголов сценария собирает кадры по общей грамматике подачи (docs/series-style.md, «Подача серии») —
// сцены и перемотка, главы с табло критериев (обычно двух), ярлык акта, фокус, голос диктора. Что живёт в мире эпизода
// один кадр сверх общего (реплика Почты, сомнение над подом), эпизод добавляет в `clear` и `finish`.

export type Lamp = "red" | "yellow" | "green";
/** Оценка попытки по критериям главы, лампа на критерий; null — эта лампа ещё не горит (или прежняя). */
export type Verdict = (Lamp | null)[];

/** Табло главы: попытки и их оценка. Оценку сверяют тесты эпизода по модели. */
export interface Board {
  criteria: string[];
  attempts: { name: string; lamps: Verdict | null }[]; // null — ещё не проверили
  focus?: number; // о какой попытке говорит диктор; нет — о последней
}

/** Поля мира, которыми распоряжается режиссёр. Событие подачи — для звука (звук только из `events`). */
export interface Staged<F> {
  sql: string[]; // полный текст запросов кадра
  db: string | null; // реплика Postgres
  plate: string | null; // полноэкранная плашка главы
  stamp: string | null; // штамп перехода («⟲ Вернёмся…») — мир перемотан
  term: string | null; // ярлык акта
  focus: F[] | null; // о чём говорит диктор — ярко, остальное приглушено
  chapter: number | null;
  board: Board | null;
  events: { kind: string; lamps?: Verdict }[];
  frame: number; // номер кадра — ключ разовых эффектов отрисовки
  scene: number; // номер сцены («свежий стол»)
}

export interface ShotOptions<F> {
  /** Показать SQL-панель: только где SQL надо прочитать. Глаголы пишут SQL всегда — панель полная. */
  sql?: boolean;
  /** Своё время кадра, с: плашка главы. */
  hold?: number;
  /** Оценка текущей попытки на табло — в кадре, где результат уже виден; null — лампа прежняя. */
  verdict?: Verdict;
  /** Текст диктора за кадром: объясняет то, что на экране, и называет термин. */
  voice?: string;
  /** О чём говорит диктор — это ярко, остальное приглушено. */
  focus?: F[];
  /** Какую попытку табло подсветить (по номеру); нет — последнюю. */
  attempt?: number;
}

export abstract class Director<F, W extends Staged<F>> {
  readonly steps: Step<W>[] = [];
  w: W;
  private act = "";
  private fresh = false;
  private label: string | null = null;
  private chapterNo: number | null = null;
  private board: Board | null = null;
  private sceneNo = 0;

  /** `blank` — свежий мир эпизода: с него начинается сцена без своего мира. */
  constructor(private readonly blank: () => W) {
    this.w = blank();
  }

  /** Время кадра без голоса: база + чтение текста в кадре. */
  protected abstract hold(caption: string, w: W): number;

  /** Сбросить то, что у эпизода живёт один кадр, — до действий кадра. */
  protected clear(_w: W): void {}

  /** Дописать кадр после действий и табло, до номера кадра (события эпизода, флаги подачи). */
  protected finish(_w: W): void {}

  /** Кадр с титром или плашкой — звучит перелистом карточки. */
  protected carded(w: W): boolean {
    return !!w.plate;
  }

  /**
   * Новая сцена; ярлык переживает смену сцены внутри акта и сбрасывается на новом акте.
   * `replay` — возврат к уже показанному моменту (перемотка, итог): без «перелистывания» и въезда стола.
   */
  scene(act: string, w: W = this.blank(), { replay = false } = {}): void {
    if (act !== this.act) this.label = null;
    this.act = act;
    this.w = w;
    this.fresh = this.steps.length > 0 && !replay;
    if (!replay) this.sceneNo++;
  }

  /** Ярлык акта — со следующего кадра, когда механика уже показана. */
  term(label: string): void {
    this.label = label;
  }

  /** Глава: номер в углу и чистое табло с критериями (обычно двумя); null — вне глав. */
  chapter(no: number | null, criteria: string[] | null = null): void {
    this.chapterNo = no;
    this.board = criteria ? { criteria, attempts: [] } : null;
  }

  /** Новая строка табло — попытка, которую сейчас покажем. */
  attempt(name: string): void {
    this.board!.attempts.push({ name, lamps: null });
  }

  /** Применить действия и записать кадр. Реплики, SQL и титры живут один кадр. */
  shot(caption: string, action?: (w: W) => void, opts: ShotOptions<F> = {}): void {
    const w = this.w;
    w.sql = [];
    w.db = null;
    w.plate = null;
    w.stamp = null;
    this.clear(w);
    w.term = this.label;
    w.focus = opts.focus ?? null;
    w.events = this.fresh ? [{ kind: "page" }] : [];
    this.fresh = false;
    action?.(w);
    if (!opts.sql) w.sql = [];
    if (w.stamp) w.events.push({ kind: "rewind" });
    if (opts.verdict) {
      const a = this.board!.attempts.at(-1)!;
      a.lamps = this.board!.criteria.map((_, i) => opts.verdict![i] ?? a.lamps?.[i] ?? null);
      w.events.push({ kind: "verdict", lamps: opts.verdict });
    }
    this.finish(w);
    w.chapter = this.chapterNo;
    w.board = structuredClone(this.board);
    if (w.board && opts.attempt !== undefined) w.board.focus = opts.attempt;
    w.frame = this.steps.length;
    w.scene = this.sceneNo;
    if (this.carded(w)) w.events.push({ kind: "card" });
    const state = structuredClone(w);
    this.steps.push({
      act: this.act, caption, state, hold: opts.hold ?? this.hold(caption, state),
      ...(opts.voice ? { narration: opts.voice } : {}),
    });
  }
}
