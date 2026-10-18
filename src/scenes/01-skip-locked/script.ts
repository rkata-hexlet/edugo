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
    " WHERE id = (SELECT id FROM tasks\n" +
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
}

class Director {
  readonly steps: Step<World>[] = [];
  w: World = world();
  private act = "";
  private fresh = false;
  private label: string | null = null;
  private chapterNo: number | null = null;
  private board: Board | null = null;

  /** Новая сцена (свежие 6 задач); ярлык переживает смену сцены внутри акта и сбрасывается на новом акте. */
  scene(act: string, w: World = world()): void {
    if (act !== this.act) this.label = null;
    this.act = act;
    this.w = w;
    this.fresh = this.steps.length > 0;
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
    if (opts.verdict) this.board!.attempts.at(-1)!.lamps = opts.verdict;
    w.chapter = this.chapterNo;
    w.board = structuredClone(this.board);
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
  sql(w, who, SQL.claimSkip);
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
function bothFinish(w: World, keyed: boolean): void {
  setClock(w, 710);
  freeze(w, "B", false);
  for (const who of ["B", "C"] as const) {
    send(w, who, 1, keyed);
    complete(w, who, 1, true);
    release(w, who);
  }
}

export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `12:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  }, { voice: "Три пода взяли одну задачу, и ушло три одинаковых письма." });

  // Знакомство с миром — до первой поломки: таблица, поды, получатель.
  d.scene(ACT.intro);
  d.shot("", undefined, {
    focus: ["table"],
    voice: "Разберёмся. Слева лежит таблица задач в Postgres: в ней шесть задач, и у всех статус «новый».",
  });
  d.shot("", undefined, {
    focus: ["A", "B", "C"],
    voice: "В центре стоят три пода одного сервиса. Каждый берёт задачу из таблицы и выполняет.",
  });
  d.shot("", undefined, {
    focus: ["mail"],
    voice: "Выполнить задачу значит отправить письмо, и на заказ должно уйти одно. Если уйдёт два, это брак.",
  });

  // КЕЙС 1 — раздать задачи без дублей.
  d.scene(ACT.case1);
  d.chapter(1, ["без дублей", "без ожидания"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nКак раздать задачи и не подраться";
  }, { hold: 2.5, voice: "В первой главе раздаём задачи без драки и смотрим на дубли и взаимное ожидание." });

  // 1.1 Гонка.
  d.scene(ACT.race);
  d.attempt("SELECT, потом UPDATE");
  d.shot("", (w) => {
    look(w, "A");
    look(w, "B");
    race(w);
    w.card = "SELECT ──── окно гонки ──── UPDATE";
  }, { focus: ["A", "B", "row:1"], voice: "Двое читают таблицу и видят одну задачу, а между чтением и записью открывается окно гонки." });
  d.term("Race condition · check-then-act");
  d.shot("В таблице одна строка. Писем — два.", (w) => {
    take(w, "A", 1);
    take(w, "B", 1);
    finish(w, "A", 1);
    finish(w, "B", 1);
  }, {
    verdict: ["red", "green"], focus: ["A", "B", "mail", "board"],
    voice: "Оба отправили письмо, и это race condition: сосед вклинился между проверкой и действием.",
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
    w.db = "Но только в своём поде.";
  }, { focus: ["A", "B"], voice: "Закроем окно мьютексом из пакета sync, но он работает лишь внутри процесса, а поды разные." });
  d.term("Local lock ≠ distributed lock");
  d.shot("", (w) => {
    take(w, "A", 1);
    take(w, "B", 1);
    finish(w, "A", 1);
    finish(w, "B", 1);
  }, {
    verdict: ["red", "green"], focus: ["mail", "board"],
    voice: "Письма снова два: мьютекс знает только горутины своего процесса, а нужна блокировка, общая для всех подов.",
  });

  // 1.3 Условный UPDATE.
  d.scene(ACT.cas);
  d.attempt("UPDATE … AND status='new'");
  d.shot("", (w) => {
    for (const who of ALL) look(w, who);
  }, { focus: ["table"], voice: "Значит, проверять должна база: обновим задачу, только если статус всё ещё «новый»." });
  d.shot("", (w) => {
    for (const who of ALL) cas(w, who, 1); // A задел строку, B и C упёрлись в его блокировку
  }, { sql: true, focus: ["A", "row:1", "sql"], voice: "Все трое шлют UPDATE, но база пускает только A." });
  d.shot("", undefined, { focus: ["B", "C", "row:1"], voice: "Поэтому B и C ждут, пока A сделает COMMIT." });
  d.term("Compare-and-set · optimistic locking");
  d.shot("", (w) => commitTx(w, "A"), {
    sql: true, focus: ["B", "C", "sql"],
    voice: "Когда A делает COMMIT, B и C перепроверяют условие и видят, что статус уже не «новый».",
  });
  d.shot("", (w) => finish(w, "A", 1), {
    focus: ["A", "mail"],
    voice: "Так письмо уходит одно. Это compare-and-set, оптимистичный подход: строку мы заранее не запирали.",
  });
  d.shot("", (w) => {
    look(w, "B");
    cas(w, "B", 2);
    look(w, "C");
    cas(w, "C", 2);
    commitTx(w, "B");
  }, { focus: ["B", "C"], voice: "В следующем круге всё повторяется: B берёт вторую, а C снова проигрывает." });
  d.shot("", (w) => {
    look(w, "C");
    cas(w, "C", 3);
    commitTx(w, "C");
    finish(w, "B", 2);
    finish(w, "C", 3);
    w.db = "Кто-то всегда проигрывает.";
  }, { verdict: ["green", "yellow"], focus: ["board"], voice: "Дублей при этом нет, но проигравшие работают вхолостую." });

  // 1.4 FOR UPDATE.
  d.scene(ACT.forUpdate);
  d.attempt("FOR UPDATE");
  d.shot("", (w) => look(w, "A", "for_update"), {
    sql: true, focus: ["A", "row:1", "sql"],
    voice: "Тогда запрём строку заранее через FOR UPDATE: это pessimistic locking. A запирает первую.",
  });
  d.shot("", (w) => {
    look(w, "B", "for_update");
    look(w, "C", "for_update");
    w.db = "Занято. Жди.";
  }, { focus: ["B", "C", "row:1"], voice: "B и C встают за ней в очередь, хотя свободных задач полно." });
  d.term("Pessimistic locking");
  d.shot("", (w) => {
    markTaken(w, "A");
    commitTx(w, "A");
    markTaken(w, "B"); // B перепроверил #1 (замок остался на нём) и взял #2; C ждёт уже B
  }, { focus: ["B", "row:2"], voice: "A делает COMMIT, B просыпается: первая задача уже не подходит, он берёт вторую." });
  d.shot("", undefined, {
    focus: ["C", "row:1"],
    voice: "А C теперь ждёт B, ведь при перепроверке B запер первую строку и держит её до COMMIT. Это head-of-line blocking.",
  });
  d.shot("", (w) => {
    commitTx(w, "B");
    markTaken(w, "C");
    commitTx(w, "C");
    finish(w, "A", 1);
    finish(w, "B", 2);
    finish(w, "C", 3);
  }, { verdict: ["green", "red"], focus: ["board"], voice: "Так по очереди пройдут все: дублей нет, но каждый ждёт предыдущего." });

  // 1.5 SKIP LOCKED.
  d.scene(ACT.skip);
  d.attempt("FOR UPDATE SKIP LOCKED");
  d.shot("", (w) => claim(w, "A"), {
    sql: true, focus: ["A", "row:1", "sql"],
    voice: "Чтобы не ждать, возьмём SKIP LOCKED: он пропускает занятые строки. A берёт первую.",
  });
  d.term("Non-blocking claim · SKIP LOCKED");
  d.shot("", (w) => claim(w, "B"), { focus: ["B", "row:2"], voice: "Теперь B видит, что первая занята, пропускает её и берёт вторую." });
  d.shot("", (w) => {
    claim(w, "C");
    for (const who of ALL) commit(w, who);
    w.db = "Наконец-то воспитанный.";
  }, { focus: ["C", "row:3"], voice: "А C берёт третью, и никто не ждёт: это non-blocking claim." });
  d.shot("", (w) => {
    for (const [who, id] of [["A", 1], ["B", 2], ["C", 3]] as const) finish(w, who, id);
    for (const who of ALL) {
      claim(w, who);
      commit(w, who);
    }
    for (const [who, id] of [["A", 4], ["B", 5], ["C", 6]] as const) finish(w, who, id);
  }, {
    verdict: ["green", "green"], focus: ["table", "mail", "board"],
    voice: "Остальные задачи разбираются так же: дубли гасит условие «статус новый» под блокировкой, а ожидание убирает SKIP LOCKED.",
  });

  // КЕЙС 2 — воркер завис. Нить главы: жив ли B? Со стороны медленного не отличить от мёртвого.
  d.scene(ACT.case2);
  d.chapter(2, ["не застревает", "письмо одно"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nВоркер завис. Чья теперь задача?";
    w.db = "Починили? Посмотрим.";
  }, {
    hold: 3.5,
    voice: "Глава вторая: до сих пор поды были живы, а теперь один замолчит. Что будет с задачей и письмами?",
  });

  // 2.1 Завис или упал → lease.
  d.scene(ACT.stuck);
  d.attempt("держим транзакцию");
  d.shot("", (w) => {
    look(w, "B", "skip_locked");
    markTaken(w, "B"); // транзакция открыта: в таблице всё ещё new, но под замком B
    freeze(w, "B", true);
  }, {
    focus: ["B", "row:1"],
    voice: "Сначала держим транзакцию на время работы: B берёт задачу и замирает в ожидании ответа чужого сервиса.",
  });
  d.shot("", (w) => {
    setClock(w, 600);
    workRest(w);
    w.db = "Упал бы — замки бы снял. А он жив.";
  }, {
    verdict: ["red", "green"], focus: ["clock", "table", "row:1"],
    voice: "Проходит десять минут, остальные задачи давно разобраны, а первая висит: блокировка держится до конца транзакции B.",
  });
  d.scene(ACT.stuck);
  d.w.clock = 610; // часы БД идут дальше, назад не прыгают
  d.attempt("«в работе» и сразу COMMIT");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: не держим транзакцию";
    take(w, "B", 1);
  }, {
    focus: ["B", "row:1"],
    voice: "Ждать конца такой транзакции можно часами, а соединение всё это время занято, так что первый вариант не годится. Попробуем иначе: B ставит статус «в работе» и сразу делает COMMIT, и блокировки больше нет.",
  });
  d.shot("", (w) => crash(w, "B"), { focus: ["B"], voice: "Но посреди работы B падает." });
  d.shot("", (w) => {
    workRest(w);
    w.db = "В работе. Жив ли он — не знаю.";
  }, {
    verdict: ["red", "green"], focus: ["table", "row:1"],
    voice: "Остальные видят «в работе» и не знают, жив ли B. Медленного со стороны не отличить от мёртвого, поэтому задача висит навсегда.",
  });
  d.shot("", undefined, {
    focus: ["board"],
    voice: "Выходит, оба варианта плохи по-своему. С транзакцией дорого, и задача ждёт зависшего, хотя падение база разрулит сама. Без транзакции дёшево, но после падения задача висит навсегда. Значит, нужен способ, который справится с обоими случаями.",
  });
  d.scene(ACT.stuck);
  d.w.clock = 670;
  d.w.leaseCols = true;
  d.attempt("lease: токен и срок");
  d.term("Lease");
  d.shot("", (w) => {
    w.stamp = "⟲ Третий вариант: срок аренды";
    grabWithLease(w, "B");
  }, {
    sql: true, focus: ["B", "row:1", "clock"],
    voice: "Раз со стороны не понять, жив B или нет, договоримся о сроке: при захвате одним запросом база выдаёт токен и срок по своим часам. Это lease.",
  });
  d.shot("", (w) => {
    setClock(w, 675);
    w.actors.B.checkedAt = w.clock;
    say(w, "B", "Запас есть — успею.");
    freeze(w, "B", true);
  }, { focus: ["B", "row:1"], voice: "B проверяет срок, видит запас и именно в этот момент зависает." });
  d.shot("", (w) => {
    setClock(w, 701);
    w.events.push({ kind: "expire" });
  }, { focus: ["row:1", "clock"], voice: "Срок вышел, но в строке ничего не меняется: срок здесь просто значение в колонке." });
  d.shot("", (w) => {
    w.ghost = { row: 1, token: w.rows[0].token! };
    grabWithLease(w, "C");
  }, {
    sql: true, focus: ["C", "row:1", "sql"],
    voice: "Просрочку замечает следующий захват, и C забирает задачу с новым токеном.",
  });
  const beforeZombie = structuredClone(d.w);

  // 2.2 Зомби.
  d.scene(ACT.zombie, structuredClone(beforeZombie));
  d.shot("", (w) => {
    setClock(w, 710);
    freeze(w, "B", false);
    send(w, "B", 1);
  }, {
    focus: ["B", "row:1", "mail"],
    voice: "B просыпается и действует по старой проверке: он отправляет письмо, не зная, что задача уже не его. Это тот же check-then-act.",
  });
  d.shot("", (w) => {
    complete(w, "B", 1, true);
    sql(w, "B", `${SQL.doneByToken(1, "7f3a")}  ${rows(0)}`);
  }, {
    sql: true, focus: ["B", "row:1", "sql"],
    voice: "Отметку B делает после письма, как и положено, но база её не пускает: токен в строке чужой. А письмо уже ушло, и отозвать его нельзя.",
  });
  d.shot("", (w) => {
    release(w, "B");
    send(w, "C", 1);
    complete(w, "C", 1, true);
    release(w, "C");
  }, {
    verdict: ["green", "red"], focus: ["C", "mail", "row:1"],
    voice: "Новый владелец C тоже отправляет письмо. В итоге строка в таблице одна, а писем два. База уберегла свою запись, но письмо ей не подвластно.",
  });
  d.scene(ACT.zombie, structuredClone(beforeZombie)); // то же самое, но письма с ключом
  d.attempt("lease + Idempotency-Key");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: B ещё не проснулся";
    bothFinish(w, true);
    w.mail = "Заказ 1? Уже отправлено.";
  }, {
    focus: ["mail"],
    voice: "Вернёмся к моменту до пробуждения B и добавим письму ключ идемпотентности, номер заказа: Почта увидит повтор и вернёт прежний ответ.",
  });
  d.term("At-least-once · idempotency key");
  d.shot("", undefined, {
    verdict: ["green", "green"], focus: ["board"],
    voice: "Без ключа не обойтись: медленного не отличить от мёртвого, поэтому задачу иногда забирают у живого, и она выполняется дважды. Это at-least-once, и повторы гасит получатель.",
  });
  // Итог: три защиты — каждая на своём месте экрана.
  d.shot("", undefined, {
    focus: ["row:1", "clock"],
    voice: "Подведём итог. Срок аренды, то есть lease, не даёт задаче застрять навсегда.",
  });
  d.shot("", undefined, {
    focus: ["row:1"],
    voice: "Токен не даёт проснувшемуся воркеру распоряжаться чужой задачей: отмечаем её только по своему токену.",
  });
  d.shot("", undefined, {
    focus: ["mail"],
    voice: "А ключ идемпотентности не даёт письму уйти дважды: его проверяет получатель. Только вместе эти три защиты справляются с зависшим воркером.",
  });

  return d.steps;
}
