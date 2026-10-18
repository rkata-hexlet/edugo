import type { Step } from "../../engine/contract";
import {
  claimLease, commit, complete, crash, selectTask, send, updateTask, world,
  type ActorId, type Board, type Focus, type Lamp, type LockMode, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/01-skip-locked.md (сценарий v4.2, покадрово).
// Микрошаг: одна фраза диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  hook: "0. Хук",
  intro: "Знакомство",
  case1: "Кейс 1",
  race: "1.1 Гонка",
  mutex: "1.2 Мьютекс",
  cas: "1.3 Условный UPDATE",
  forUpdate: "1.4 FOR UPDATE",
  skip: "1.5 SKIP LOCKED",
  case2: "Кейс 2",
  stuck: "2.1 Завис или упал",
  zombie: "2.2 Зомби",
  summary: "Итог",
} as const;

const SQL = {
  select: (lock: LockMode) =>
    "SELECT id FROM tasks WHERE status='new'\n  ORDER BY id LIMIT 1" +
    (lock === "for_update" ? " FOR UPDATE" : lock === "skip_locked" ? "\n  FOR UPDATE SKIP LOCKED" : ""),
  take: (id: number) => `UPDATE tasks SET status='in_progress' WHERE id=${id}`,
  takeIfNew: (id: number) => `UPDATE tasks SET status='in_progress'\n  WHERE id=${id} AND status='new'`,
  done: (id: number) => `UPDATE tasks SET status='done' WHERE id=${id}`,
  claimSkip:
    "UPDATE tasks SET status='in_progress'\n" +
    " WHERE id IN (SELECT id FROM tasks WHERE status='new'\n" +
    "   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)\n" +
    "RETURNING id",
  claim:
    "UPDATE tasks SET status='in_progress',\n" +
    "       claim_token=gen_random_uuid(), lease_until=now()+'30s'\n" +
    " WHERE id IN (SELECT id FROM tasks\n" +
    "   WHERE status='new'\n" +
    "      OR (status='in_progress' AND lease_until < now())\n" +
    "   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)\n" +
    "RETURNING id, claim_token, lease_until",
  doneByToken: (id: number, token: string) =>
    `UPDATE tasks SET status='done'\n  WHERE id=${id} AND claim_token='${token}'`,
};

/** Произношение латиницы в закадре для синтеза — как говорят вслух бэкендеры. Экран и субтитр не меняются. */
export const PRONOUNCE: Record<string, string> = {
  "race condition": "рейс кондишн",
  "compare-and-set": "компэр-энд-сет",
  "pessimistic locking": "пессимистик локинг",
  "head-of-line blocking": "хэд-оф-лайн блокинг",
  "non-blocking claim": "нон-блокинг клейм",
  "check-then-act": "чек-зен-экт",
  "at-least-once": "эт-лист-ванс",
  "FOR UPDATE": "фор апдейт",
  "SKIP LOCKED": "скип локт",
  UPDATE: "апдейт",
  COMMIT: "коммит",
  lease: "лиз",
  sync: "синк",
  Go: "гоу",
  Postgres: "постгрес",
  API: "эй-пи-ай",
  A: "эй",
  B: "би",
  C: "си",
};

const rows = (n: number) => `→ ${n} ${n === 1 ? "строка" : "строк"}`;

/** Время кадра: база + чтение всего текста в кадре (правило «Текст в кадре» в CLAUDE.md). */
export function holdFor(caption: string, w: World): number {
  const says = Object.values(w.actors).map((a) => a.say ?? "");
  const text = [caption, w.card ?? "", w.plate ?? "", w.stamp ?? "", w.db ?? "", w.mail ?? "", ...says, ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

interface ShotOptions {
  /** Показать SQL-панель: только где SQL надо прочитать. Глаголы пишут SQL всегда — панель полная. */
  sql?: boolean;
  /** Своё время кадра, с: плашка главы. */
  hold?: number;
  /** Оценка текущей попытки на табло — в кадре, где результат уже виден. */
  verdict?: [Lamp, Lamp];
  /** Текст диктора за кадром: объясняет то, что на экране, и называет термин. */
  voice?: string;
  /** О чём говорит диктор — это ярко, остальное приглушено. */
  focus?: Focus[];
  /** Какую попытку табло подсветить (по номеру); нет — последнюю. */
  attempt?: number;
}

class Director {
  readonly steps: Step<World>[] = [];
  w: World = world();
  private act = "";
  private fresh = false;
  private label: string | null = null;
  private chapterNo: number | null = null;
  private board: Board | null = null;
  private doubtOf: ActorId | null = null;
  private sceneNo = 0;
  private lastDoubt: ActorId | null = null;

  /**
   * Новая сцена (свежие 6 задач); ярлык переживает смену сцены внутри акта и сбрасывается на новом акте.
   * `replay` — возврат к уже показанному моменту (перемотка, итог): без «перелистывания» и каскада стола.
   */
  scene(act: string, w: World = world(), { replay = false } = {}): void {
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

  /** Глава: номер в углу и чистое табло с двумя критериями; null — вне глав. */
  chapter(no: number | null, criteria: [string, string] | null = null): void {
    this.chapterNo = no;
    this.board = criteria ? { criteria, attempts: [] } : null;
  }

  /** «?» над подом: остальные не знают, жив ли он; null — снять. Переживает смену сцены. */
  doubt(who: ActorId | null): void {
    this.doubtOf = who;
  }

  /** Новая строка табло — попытка, которую сейчас покажем. */
  attempt(name: string): void {
    this.board!.attempts.push({ name, lamps: null });
  }

  /** Применить действия и записать кадр. Реплики, SQL и титры живут один кадр. */
  shot(caption: string, action?: (w: World) => void, opts: ShotOptions = {}): void {
    const w = this.w;
    w.sql = [];
    w.db = null;
    w.mail = null;
    w.race = false;
    w.card = null;
    w.plate = null;
    w.ghost = null;
    w.stamp = null;
    w.term = this.label;
    w.focus = opts.focus ?? null;
    w.events = this.fresh ? [{ kind: "page" }] : [];
    this.fresh = false;
    for (const a of Object.values(w.actors)) a.say = null;
    action?.(w);
    if (!opts.sql) w.sql = [];
    // События подачи — для звука (звук берётся только из World.events, CLAUDE.md).
    if (w.stamp) w.events.push({ kind: "rewind" });
    if (opts.verdict) {
      this.board!.attempts.at(-1)!.lamps = opts.verdict;
      w.events.push({ kind: "verdict", lamps: opts.verdict });
    }
    if (this.doubtOf && this.doubtOf !== this.lastDoubt) w.events.push({ kind: "doubt", by: this.doubtOf });
    this.lastDoubt = this.doubtOf;
    w.chapter = this.chapterNo;
    w.board = structuredClone(this.board);
    if (w.board && opts.attempt !== undefined) w.board.focus = opts.attempt;
    w.doubt = this.doubtOf;
    w.frame = this.steps.length;
    w.scene = this.sceneNo;
    if (w.card || w.plate) w.events.push({ kind: "card" });
    const state = structuredClone(w);
    this.steps.push({
      act: this.act, caption, state, hold: opts.hold ?? holdFor(caption, state),
      ...(opts.voice ? { narration: opts.voice } : {}),
    });
  }
}

// --- Глаголы сценария: операции модели + реплики и SQL. Поды не двигаются — двигаются стрелки. ---

function race(w: World): void {
  w.race = true;
  w.events.push({ kind: "race" });
}

function mutex(w: World, who: ActorId): void {
  w.actors[who].mutex = true;
  w.events.push({ kind: "mutex" });
}

function freeze(w: World, who: ActorId, frozen: boolean): void {
  w.actors[who].frozen = frozen;
  w.events.push({ kind: frozen ? "freeze" : "unfreeze", by: who });
}

function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
}

function sql(w: World, who: ActorId, text: string): void {
  w.sql.push(`${w.actors[who].label} ▸ ${text}`);
}

function say(w: World, who: ActorId, line: string | null): void {
  w.actors[who].say = line;
}

/** SELECT свободной задачи; с блокировкой — в транзакции (ждёт замок или держит его). */
function look(w: World, who: ActorId, lock: LockMode = "none"): void {
  selectTask(w, who, lock);
  sql(w, who, (lock === "none" ? "" : "BEGIN;\n") + SQL.select(lock));
}

/** UPDATE по id без проверок, autocommit: задача в работе. */
function take(w: World, who: ActorId, id: number): void {
  w.events.push({ kind: "relock" }); // короткий тихий щелчок «взял» (autocommit, замок на миг)
  updateTask(w, who, id, { status: "in_progress" });
  commit(w, who);
  w.actors[who].carrying = id;
  sql(w, who, SQL.take(id));
}

/** Условный UPDATE … AND status='new' в транзакции: задел строку — задача его; занято — ждёт COMMIT. */
function cas(w: World, who: ActorId, id: number): void {
  const a = w.actors[who];
  updateTask(w, who, id, { status: "in_progress" }, { status: "new" });
  if (a.affected === 1) a.carrying = id;
  sql(w, who, `BEGIN;\n${SQL.takeIfNew(id)}  ${a.pending ? "-- ждёт COMMIT" : rows(a.affected ?? 0)}`);
}

/** COMMIT; ждавшие UPDATE просыпаются и получают свой результат. */
function commitTx(w: World, who: ActorId): void {
  const waiting = Object.values(w.actors).filter((a) => a.pending);
  commit(w, who);
  sql(w, who, "COMMIT");
  for (const a of waiting) {
    if (a.pending) continue;
    if (a.affected === 1) a.carrying = a.seen;
    sql(w, a.id, rows(a.affected ?? 0));
  }
}

/** Взятая в FOR UPDATE строка (seen) → в работу, в той же транзакции. */
function markTaken(w: World, who: ActorId): void {
  const a = w.actors[who];
  updateTask(w, who, a.seen!, { status: "in_progress" });
  a.carrying = a.seen;
}

/** Захват одним оператором: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED). COMMIT — отдельно,
 *  чтобы показать, как параллельные операторы обходят ещё не закоммиченный захват соседа. */
function claim(w: World, who: ActorId): boolean {
  selectTask(w, who, "skip_locked");
  // Явная транзакция: замок живёт до COMMIT — SKIP LOCKED виден, пока захваты идут одновременно.
  sql(w, who, `BEGIN;\n${SQL.claimSkip}`);
  if (w.actors[who].seen === null) return false; // свободных нет — 0 строк
  markTaken(w, who);
  return true;
}

/** Под закончил с задачей: ни держит, ни смотрит — стрелки к строке гаснут. */
function release(w: World, who: ActorId): void {
  w.actors[who].carrying = null;
  w.actors[who].seen = null;
}

/** Сделать работу: письмо в Почту и done (без токенов). */
function finish(w: World, who: ActorId, id: number): void {
  send(w, who, id);
  complete(w, who, id, false);
  release(w, who);
  sql(w, who, SQL.done(id));
}

function grabWithLease(w: World, who: ActorId): void {
  const id = claimLease(w, who);
  if (id === null) throw new Error(`сценарий: ${who} не нашёл задачу`);
  w.actors[who].carrying = id;
  sql(w, who, SQL.claim);
}

/** A и C разбирают всё, что могут взять (SKIP LOCKED), и делают работу: вред застрявшей задачи — «осталось 1». */
function workRest(w: World): void {
  for (let progress = true; progress; ) {
    progress = false;
    for (const who of ["A", "C"] as const) {
      if (!claim(w, who)) continue;
      const id = w.actors[who].carrying!;
      commit(w, who);
      finish(w, who, id);
      progress = true;
    }
  }
}

/** Зомби и перехвативший доделывают #1: письмо и done по своему токену. keyed — письма с ключом. */
function bothFinish(w: World, keyed: boolean, at: number): void {
  setClock(w, at);
  freeze(w, "B", false);
  for (const who of ["B", "C"] as const) {
    send(w, who, 1, keyed);
    complete(w, who, 1, true);
    release(w, who);
  }
}

/** Часы БД: t секунд от 12:00:00. */
export function clock(t: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${12 + Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function buildSteps(): Step<World>[] {
  const d = new Director();
  const ALL = ["A", "B", "C"] as const;

  // 0. Хук: трое на одну задачу — три письма.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    for (const who of ALL) look(w, who);
    for (const who of ALL) take(w, who, 1);
    for (const who of ALL) finish(w, who, 1);
    w.db = "Вас трое. Задача одна.";
  }, { voice: "Три пода взялись за одну задачу — и ушло три одинаковых письма." });

  // Знакомство с миром — до первой поломки: таблица, поды, получатель.
  d.scene(ACT.intro);
  d.shot("", undefined, {
    focus: ["table"],
    voice: "Разберёмся. Слева — таблица задач в Postgres: в ней шесть записей, и у всех статус «новый».",
  });
  d.shot("", undefined, {
    focus: ["A", "B", "C"],
    voice: "В центре — три пода одного сервиса. Каждый берёт задачу из таблицы и отправляет письмо.",
  });
  // Норма до первой поломки: как выглядит «взял задачу» и «одно письмо» (learning-designer: легенда стрелок).
  d.shot("", (w) => {
    look(w, "A");
    take(w, "A", 1);
  }, { focus: ["A", "row:1"], voice: "Сначала посмотрим, как всё работает в норме: под A берёт первую задачу." });
  d.shot("", (w) => finish(w, "A", 1), {
    focus: ["A", "mail", "row:1"],
    voice: "Он отправляет письмо и отмечает задачу выполненной. Итог: на одну задачу — одно письмо.",
  });
  d.shot("", undefined, {
    focus: ["mail"],
    voice: "Каждая задача — это письмо по конкретному заказу, и уйти оно должно ровно один раз. Если ушло два письма, это дубль и брак.",
  });

  // КЕЙС 1 — раздать задачи без дублей.
  d.scene(ACT.case1);
  d.chapter(1, ["без дублей", "без ожидания"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nКак раздать задачи и не подраться";
  }, { hold: 2.5, voice: "В первом кейсе мы раздаём задачи и следим за двумя вещами: чтобы не было дублей и чтобы никто не простаивал в ожидании." });

  // 1.1 Гонка.
  d.scene(ACT.race);
  d.attempt("SELECT, потом UPDATE");
  d.shot("", (w) => {
    look(w, "A");
    look(w, "B");
    race(w);
    w.card = "SELECT ──── окно гонки ──── UPDATE";
  }, { focus: ["A", "B", "row:1"], voice: "Двое читают таблицу и видят одну и ту же задачу. Между чтением и записью открывается окно гонки." });
  d.term("Race condition · check-then-act");
  d.shot("В таблице одна строка. Писем — два.", (w) => {
    take(w, "A", 1);
    take(w, "B", 1);
    finish(w, "A", 1);
    finish(w, "B", 1);
  }, {
    verdict: ["red", "green"], focus: ["A", "B", "mail", "board"],
    voice: "Оба отправили по письму. Это классический race condition: сосед вклинился между проверкой статуса и действием.",
  });

  // 1.2 Мьютекс.
  d.scene(ACT.mutex);
  d.attempt("sync.Mutex");
  d.shot("", (w) => {
    mutex(w, "A");
    mutex(w, "B");
    look(w, "A");
    look(w, "B");
    say(w, "B", "Я взял мьютекс!");
    w.db = "Но только внутри своего пода.";
  }, { focus: ["A", "B"], voice: "Попробуем закрыть окно мьютексом из пакета sync. Но он работает только внутри одного процесса, а поды у нас разные." });
  d.term("Local lock ≠ distributed lock");
  d.shot("", (w) => {
    take(w, "A", 1);
    take(w, "B", 1);
    finish(w, "A", 1);
    finish(w, "B", 1);
  }, {
    verdict: ["red", "green"], focus: ["mail", "board"],
    voice: "И снова ушло два письма. Мьютекс видит только горутины собственного процесса, а нам нужна блокировка, общая для всех подов.",
  });

  // 1.3 Условный UPDATE.
  d.scene(ACT.cas);
  d.attempt("UPDATE … AND status='new'");
  d.shot("", (w) => {
    for (const who of ALL) look(w, who);
  }, { focus: ["table"], voice: "Значит, проверять условие должна сама база: обновляем задачу, только если её статус всё ещё «новый»." });
  d.shot("", (w) => {
    for (const who of ALL) cas(w, who, 1); // A задел строку, B и C упёрлись в его блокировку
  }, { sql: true, focus: ["A", "row:1", "sql"], voice: "Все трое отправляют UPDATE, но база пропускает только под A." });
  d.shot("", undefined, { focus: ["B", "C", "row:1"], voice: "Поэтому B и C висят в ожидании, пока A не сделает COMMIT и не зафиксирует транзакцию." });
  d.term("Compare-and-set · optimistic locking");
  d.shot("", (w) => commitTx(w, "A"), {
    sql: true, focus: ["B", "C", "sql"],
    voice: "Когда A делает COMMIT, поды B и C перепроверяют условие и видят, что статус уже изменился.",
  });
  d.shot("", (w) => finish(w, "A", 1), {
    focus: ["A", "mail"],
    voice: "В итоге письмо уходит ровно одно. Это подход compare-and-set, или оптимистичная блокировка: мы не запирали строку заранее.",
  });
  d.shot("", (w) => {
    look(w, "B");
    cas(w, "B", 2);
    look(w, "C");
    cas(w, "C", 2);
    commitTx(w, "B");
  }, { focus: ["B", "C"], voice: "На следующем круге всё повторяется: B успевает забрать вторую задачу, а C снова остаётся ни с чем." });
  d.shot("", (w) => {
    look(w, "C");
    cas(w, "C", 3);
    commitTx(w, "C");
    finish(w, "B", 2);
    finish(w, "C", 3);
    w.db = "Кто-то всегда уходит ни с чем.";
  }, { verdict: ["green", "yellow"], focus: ["board"], voice: "Дублей при этом нет, но проигравшие поды работают вхолостую." });

  // 1.4 FOR UPDATE.
  d.scene(ACT.forUpdate);
  d.attempt("FOR UPDATE");
  d.shot("", (w) => look(w, "A", "for_update"), {
    sql: true, focus: ["A", "row:1", "sql"],
    voice: "Тогда заблокируем строку заранее через FOR UPDATE — это пессимистичный подход. Под A запирает первую строку.",
  });
  d.shot("", (w) => {
    look(w, "B", "for_update");
    look(w, "C", "for_update");
    w.db = "Занято. Жди.";
  }, { focus: ["B", "C", "row:1"], voice: "Но B и C встают за ним в очередь, хотя рядом полно свободных задач!" });
  d.term("Pessimistic locking");
  d.shot("", (w) => {
    markTaken(w, "A");
    commitTx(w, "A");
    markTaken(w, "B"); // B перепроверил #1 (замок остался на нём) и взял #2; C ждёт уже B
  }, { focus: ["B", "row:2"], voice: "Под A делает COMMIT. Под B просыпается, видит, что первая задача уже недоступна, и берёт вторую." });
  d.shot("", undefined, {
    focus: ["C", "row:1"],
    voice: "Теперь под C вынужден ждать пода B: при перепроверке B запер первую строку и держит замок до своего COMMIT. Это затор на ровном месте — head-of-line blocking.",
  });
  d.shot("", (w) => {
    commitTx(w, "B");
    markTaken(w, "C");
    commitTx(w, "C");
    finish(w, "A", 1);
    finish(w, "B", 2);
    finish(w, "C", 3);
  }, { verdict: ["green", "red"], focus: ["board"], voice: "Так по цепочке пройдут все задачи: дублей не будет, но каждый под вынужден ждать предыдущего." });

  // 1.5 SKIP LOCKED.
  d.scene(ACT.skip);
  d.attempt("FOR UPDATE SKIP LOCKED");
  d.shot("", (w) => claim(w, "A"), {
    sql: true, focus: ["A", "row:1", "sql"],
    voice: "Чтобы убрать простои, добавим SKIP LOCKED: он просто пропускает уже заблокированные строки. Под A берёт первую задачу.",
  });
  d.term("Non-blocking claim · SKIP LOCKED");
  d.shot("", (w) => claim(w, "B"), { focus: ["B", "row:2"], voice: "Теперь под B видит, что первая строка занята, спокойно проходит мимо и берёт вторую." });
  d.shot("", (w) => {
    claim(w, "C");
    for (const who of ALL) commit(w, who);
    w.db = "Наконец-то порядок.";
  }, { focus: ["C", "row:3"], voice: "Под C тут же забирает третью. Никто никому не мешает — это неблокирующий захват, non-blocking claim." });
  d.shot("", (w) => {
    for (const [who, id] of [["A", 1], ["B", 2], ["C", 3]] as const) finish(w, who, id);
    for (const who of ALL) {
      claim(w, who);
      commit(w, who);
    }
    for (const [who, id] of [["A", 4], ["B", 5], ["C", 6]] as const) finish(w, who, id);
  }, {
    verdict: ["green", "green"], focus: ["table", "mail", "board"],
    voice: "Остальные задачи разбираются точно так же. Дубли отсекает условие «статус новый», которое база проверяет под блокировкой, а ожидания убирает SKIP LOCKED.",
  });

  // КЕЙС 2 — под замолчал. Нить главы: жив ли B? Со стороны медленного не отличить от мёртвого.
  d.scene(ACT.case2);
  d.chapter(2, ["не застревает", "письмо одно"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nПод замолчал. Жив ли он?";
    w.db = "Починили? Ну-ну, посмотрим.";
  }, {
    hold: 3.5,
    voice: "Во втором кейсе один из подов замолкает, и мы не знаем, жив он или умер. Проверим, не застрянет ли задача и уйдёт ли только одно письмо.",
  });

  // 2.1 Завис или упал → lease.
  d.scene(ACT.stuck);
  d.doubt("B");
  d.attempt("держим транзакцию");
  d.shot("", (w) => {
    look(w, "B", "skip_locked");
    markTaken(w, "B"); // транзакция открыта: в таблице всё ещё new, но под замком B
    freeze(w, "B", true);
  }, {
    focus: ["B", "row:1"],
    voice: "Сначала попробуем держать транзакцию открытой всё время работы. Под B берёт задачу и зависает, ожидая ответа от внешнего сервиса.",
  });
  d.shot("", (w) => {
    setClock(w, 600);
    workRest(w);
    w.db = "Упал бы — замки бы снял. Он на связи.";
  }, {
    verdict: ["red", "green"], focus: ["clock", "table", "row:1"],
    voice: "Проходит десять минут. Все остальные задачи давно обработаны, а первая всё висит: блокировка держится до закрытия транзакции пода B.",
  });
  d.shot("", undefined, {
    focus: ["board"],
    voice: "Ждать завершения такой транзакции можно часами, всё это время удерживая соединение с базой. Значит, держать транзакцию всё время работы нельзя.",
  });
  d.scene(ACT.stuck);
  d.w.clock = 610; // часы БД идут дальше, назад не прыгают
  d.attempt("«в работе» и сразу COMMIT");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: не держим транзакцию";
    take(w, "B", 1);
  }, {
    focus: ["B", "row:1"],
    voice: "Попробуем по-другому: под B переводит статус в «в работе» и сразу делает COMMIT, освобождая блокировку.",
  });
  d.shot("", (w) => crash(w, "B"), { focus: ["B"], voice: "Но прямо в процессе обработки под B падает." });
  d.shot("", (w) => {
    setClock(w, 610 + 3600); // час спустя — «навсегда» видно по часам, а не только на словах
    workRest(w);
    w.db = "Жив ли он — понятия не имею.";
  }, {
    verdict: ["red", "green"], focus: ["table", "row:1", "clock"],
    voice: "Остальные поды видят статус «в работе» и не знают, что произошло. Зависший под со стороны не отличить от упавшего, поэтому задача так и висит «в работе» и через час, и через сутки.",
  });
  d.shot("", undefined, {
    focus: ["board"], attempt: 0,
    voice: "Получается, оба пути тупиковые: долгая транзакция держит ресурсы базы, а задача ждёт зависшего пода.",
  });
  d.shot("", undefined, {
    focus: ["board"], attempt: 1,
    voice: "Короткая транзакция обходится дёшево, но после падения пода задача висит навсегда. Нужен подход, который защитит и от падения, и от зависания.",
  });
  const L = 4270; // часы lease-сцены: после часа ожидания в варианте 2, назад не идут
  d.scene(ACT.stuck);
  d.w.clock = L;
  d.w.leaseCols = true;
  d.attempt("lease: токен и срок");
  d.shot("", (w) => {
    w.stamp = "⟲ Третий вариант: срок аренды";
  }, {
    focus: ["table"],
    voice: "Раз мы не можем узнать, жив под или нет, зададим временной лимит — срок аренды. Для этого добавим в таблицу две колонки: токен захвата и время окончания аренды.",
  });
  d.term("Lease");
  d.shot("", (w) => grabWithLease(w, "B"), {
    sql: true, focus: ["B", "row:1", "clock"],
    voice: "При захвате база одним запросом выдаёт поду B токен, то есть уникальную метку именно этого захвата, и фиксирует срок аренды по своим часам. Это и есть lease.",
  });
  d.shot("", (w) => {
    setClock(w, L + 5);
    w.actors.B.checkedAt = w.clock;
    w.actors.B.thought = "Время ещё есть — успею!"; // устаревшая проверка: держится, пока B не узнает правду
    freeze(w, "B", true);
  }, { focus: ["B", "row:1"], voice: "Под B проверяет срок, видит запас по времени и в этот самый момент надолго зависает." });
  d.shot("", (w) => {
    setClock(w, L + 37); // с запасом за дедлайном: красное на полосе видно (tech-expert)
    w.events.push({ kind: "expire" });
  }, { focus: ["row:1", "clock"], voice: "Время аренды истекает, но в самой строке ничего не меняется: срок — это просто значение в колонке." });
  d.shot("", (w) => {
    w.ghost = { row: 1, token: w.rows[0].token! };
    w.events.push({ kind: "ghost" });
    grabWithLease(w, "C");
  }, {
    sql: true, focus: ["C", "row:1", "sql"],
    voice: "Зато просрочку замечает следующий захват: под C забирает подвисшую задачу и получает уже новый токен.",
  });
  const beforeZombie = structuredClone(d.w);

  // 2.2 Зомби.
  d.scene(ACT.zombie, structuredClone(beforeZombie));
  d.shot("", (w) => {
    setClock(w, L + 46);
    freeze(w, "B", false);
    send(w, "B", 1);
  }, {
    focus: ["B", "row:1", "mail"],
    voice: "Но тут под B отвисает! Ориентируясь на свою старую проверку, он отправляет письмо, даже не подозревая, что задачу у него уже отобрали. И снова сработал check-then-act.",
  });
  d.shot("", (w) => {
    complete(w, "B", 1, true);
    sql(w, "B", `${SQL.doneByToken(1, "7f3a")}  ${rows(0)}`);
    w.clash = { row: 1, by: "B" };
    w.events.push({ kind: "clash" });
  }, {
    sql: true, focus: ["B", "row:1", "sql"],
    voice: "Под B пытается отметить задачу выполненной, но база отклоняет запрос: токен в строке уже чужой! Вот только письмо уже улетело, и отменить его нельзя.",
  });
  const afterClash = structuredClone(d.w);
  d.shot("", (w) => {
    release(w, "B");
    w.actors.B.thought = null;
    send(w, "C", 1);
    complete(w, "C", 1, true);
    release(w, "C");
  }, {
    verdict: ["green", "red"], focus: ["C", "mail", "row:1"],
    voice: "Вслед за ним письмо по той же задаче отправляет новый владелец — под C. Итог: запись в базе одна, а писем снова два. База защитила свои данные, но не внешнюю отправку.",
  });
  d.scene(ACT.zombie, structuredClone(beforeZombie), { replay: true }); // то же самое, но письма с ключом
  d.attempt("lease + ключ");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: B ещё не проснулся";
    w.keyed = true;
  }, {
    focus: ["B", "C", "mail"],
    voice: "База не может отозвать письмо, поэтому защитим внешнюю систему отдельно. Вернёмся назад, пока B ещё спит, и добавим ключ идемпотентности — например, номер заказа.",
  });
  d.shot("", (w) => {
    bothFinish(w, true, L + 46);
    w.actors.B.thought = null;
    w.mail = "Заказ №1? Уже отправлено.";
  }, {
    focus: ["mail"],
    voice: "Теперь оба письма уходят с одинаковым ключом. Какое бы из них ни пришло в сервис рассылки вторым, Почта распознает дубль и просто вернёт прежний ответ.",
  });
  const afterKeyed = structuredClone(d.w);
  d.term("At-least-once · idempotency key");
  d.shot("", undefined, {
    verdict: ["green", "green"], focus: ["board"],
    voice: "Раз медленный под не отличить от мёртвого, задачу иногда приходится забирать у ещё живого, а терять письмо нельзя. Так мы приходим к гарантии at-least-once: повторные отправки неизбежны, и защищаться от них должен сам получатель.",
  });

  // Итог: каждый образ пересыгран — те же кадры перехвата, отказа по токену и повтора в Почте.
  d.doubt(null);
  // Повтор звучит тем же звуком, что и в первый раз: события пишем заново.
  d.scene(ACT.summary, structuredClone(beforeZombie), { replay: true });
  d.shot("", (w) => {
    w.actors.B.thought = null;
    w.ghost = { row: 1, token: w.actors.B.token! };
    w.events.push({ kind: "ghost" }, { kind: "ticket" });
  }, {
    focus: ["row:1", "clock", "C", "board"], attempt: 2,
    voice: "Подведём итог. Срок аренды, или lease, не даёт задаче зависнуть навсегда: просроченную работу перехватит первый же под, который придёт за задачей.",
  });
  d.scene(ACT.summary, structuredClone(afterClash), { replay: true });
  d.shot("", (w) => {
    w.actors.B.thought = null;
    w.events.push({ kind: "clash" });
  }, {
    focus: ["row:1", "B", "board"], attempt: 2,
    voice: "Токен захвата защищает базу от зомби-подов: обновить статус задачи можно только со своим актуальным токеном.",
  });
  d.scene(ACT.summary, structuredClone(afterKeyed), { replay: true });
  d.shot("", (w) => w.events.push({ kind: "replay", row: 1, by: "C" }), {
    focus: ["mail", "board"], attempt: 3,
    voice: "А ключ идемпотентности страхует внешние сервисы: получатель определяет дубликат по ключу и отсекает лишнее. Только вместе эти три инструмента справляются с зависшим подом.",
  });

  return d.steps;
}
