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
  cheat: "Шпаргалка",
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
  const text = [caption, w.card ?? "", w.plate ?? "", w.db ?? "", w.mail ?? "", ...says, ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

interface ShotOptions {
  /** Показать SQL-панель: только где SQL надо прочитать. Глаголы пишут SQL всегда — панель полная. */
  sql?: boolean;
  /** Своё время кадра, с: плашка или шпаргалка. */
  hold?: number;
  /** Оценка текущей попытки на табло — в кадре, где результат уже виден. */
  verdict?: [Lamp, Lamp];
  /** Текст диктора за кадром: объясняет то, что на экране, и называет термин. */
  voice?: string;
  /** О чём говорит диктор — это ярко, остальное приглушено. */
  focus?: Focus[];
  /** Автопроигрывание останавливается на этом кадре. */
  pause?: boolean;
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
      ...(opts.pause ? { pause: true } : {}),
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
  w.events.push({ kind: frozen ? "freeze" : "unfreeze" });
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
  sql(w, who, `BEGIN;\n${SQL.takeIfNew(id)}  ${a.pending ? "⏳ ждёт COMMIT" : rows(a.affected ?? 0)}`);
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
function claim(w: World, who: ActorId): void {
  selectTask(w, who, "skip_locked");
  markTaken(w, who);
  sql(w, who, SQL.claimSkip);
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

  // КЕЙС 2 — воркер завис.
  d.scene(ACT.case2);
  d.chapter(2, ["не застревает", "письмо одно"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nВоркер завис. Чья теперь задача?";
    w.db = "Починили? Посмотрим.";
  }, { hold: 3.5, voice: "Теперь вторая глава: а если воркер завис? Посмотрим, застрянет ли задача и уйдёт ли одно письмо." });

  // 2.1 Завис или упал → lease.
  d.scene(ACT.stuck);
  d.attempt("держим транзакцию");
  d.shot("", (w) => {
    look(w, "B", "skip_locked");
    markTaken(w, "B"); // транзакция открыта: в таблице всё ещё new, но под замком B
    say(w, "B", "📞 Ваш звонок очень важен для нас…");
    freeze(w, "B", true);
  }, { focus: ["B", "row:1"], voice: "Начнём с очевидного: держим транзакцию, пока идёт работа. B берёт задачу и зависает на внешнем API." });
  d.shot("", (w) => {
    setClock(w, 600);
    for (const who of ["A", "C"] as const) {
      claim(w, who);
      commit(w, who);
    }
    w.db = "Упал бы — замки бы снял. А он жив.";
  }, {
    verdict: ["red", "green"], focus: ["clock", "row:1", "A", "C"],
    voice: "Проходит десять минут: блокировка держится до конца транзакции, поэтому остальные обходят задачу, и она застревает.",
  });
  d.scene(ACT.stuck);
  d.w.clock = 610; // часы БД идут дальше, назад не прыгают
  d.attempt("«в работе» и сразу COMMIT");
  d.shot("", (w) => {
    take(w, "B", 1);
    crash(w, "B");
  }, { focus: ["B", "row:1"], voice: "Второй вариант — не держать транзакцию. B ставит задаче статус «в работе» и сразу делает COMMIT, так что блокировки больше нет. Но посреди работы B падает." });
  d.shot("", (w) => {
    for (const who of ["A", "C"] as const) {
      claim(w, who);
      commit(w, who);
    }
    w.db = "В работе. Жив ли он — не знаю.";
  }, { verdict: ["red", "green"], focus: ["A", "C", "row:1"], voice: "Остальные видят «в работе» и поэтому обходят её навсегда." });
  d.scene(ACT.stuck);
  d.w.clock = 670;
  d.w.leaseCols = true;
  d.attempt("lease: токен и срок");
  d.term("Lease");
  d.shot("", (w) => {
    grabWithLease(w, "B");
    w.db = "До 12:11:40. По моим часам.";
  }, {
    sql: true, focus: ["B", "row:1", "clock"],
    voice: "Выходит, нужен срок годности: при захвате тем же оператором ставим токен и срок по часам базы. Это и есть lease.",
  });
  d.shot("", (w) => {
    setClock(w, 675);
    say(w, "B", "До :40 — успею.");
    freeze(w, "B", true);
  }, { focus: ["B", "clock"], voice: "Время идёт. B уверен, что успеет, но всё-таки зависает." });
  d.shot("", (w) => {
    setClock(w, 701);
    w.events.push({ kind: "expire" }); // просрочку замечает захват, а не таймер базы
    grabWithLease(w, "C");
  }, {
    sql: true, focus: ["C", "row:1", "sql", "clock"],
    voice: "Срок вышел, но база сама ничего не освобождает: просрочку замечает следующий захват, и C берёт задачу с новым токеном.",
  });
  const beforeZombie = structuredClone(d.w);

  // 2.2 Зомби.
  d.scene(ACT.zombie, structuredClone(beforeZombie));
  d.shot("", (w) => {
    setClock(w, 710);
    freeze(w, "B", false);
    say(w, "B", "Срок до :40, а проверял я в :15!");
    send(w, "B", 1);
    complete(w, "B", 1, true);
    release(w, "B");
    sql(w, "B", `${SQL.doneByToken(1, "7f3a")}  ${rows(0)}`);
  }, {
    sql: true, focus: ["B", "mail", "sql"],
    voice: "Просыпается B и отправляет письмо, но токен в базе уже чужой, поэтому обновление ничего не меняет.",
  });
  d.shot("", (w) => {
    send(w, "C", 1);
    complete(w, "C", 1, true);
    release(w, "C");
    sql(w, "C", `${SQL.doneByToken(1, "c21e")}  ${rows(1)}`);
  }, {
    verdict: ["green", "red"], focus: ["B", "C", "mail", "row:1"],
    voice: "C тоже отправляет письмо: строка в таблице одна, а писем два. Это тот же check-then-act.",
  });
  d.scene(ACT.zombie, structuredClone(beforeZombie)); // то же самое, но письма с ключом
  d.attempt("lease + Idempotency-Key");
  d.shot("", (w) => {
    bothFinish(w, true);
    w.mail = "Заказ 1? Уже отправлено.";
  }, {
    focus: ["mail"],
    voice: "Поэтому чинить надо у получателя: к письму добавим ключ идемпотентности — номер заказа, не токен. Повтор с тем же ключом не выполняется, возвращается прежний ответ.",
  });
  d.term("At-least-once · idempotency key");
  d.shot("", undefined, {
    verdict: ["green", "green"], focus: ["board"],
    voice: "Ведь исполнение у нас at-least-once, повторы возможны, поэтому дубли гасит получатель.",
  });
  d.shot("", (w) => {
    w.db = "Ровно один раз? Это не ко мне. Это к получателю.";
  }, { voice: "Итак, нужны и lease, и ключ: база защищает запись, а двойной эффект гасит получатель." });

  // Шпаргалка.
  d.scene(ACT.cheat);
  d.chapter(null);
  d.shot("Шпаргалка: запрос целиком.", (w) => {
    w.card =
      "UPDATE tasks SET status='in_progress',\n" +
      "       claim_token=gen_random_uuid(), attempts=attempts+1,\n" +
      "       lease_until=now()+interval '30s'\n" +
      " WHERE id IN (SELECT id FROM tasks\n" +
      "   WHERE (status='new' OR (status='in_progress' AND lease_until<now()))\n" +
      "     AND attempts < 5\n" +
      "   ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)\n" +
      "RETURNING id, claim_token, lease_until;\n\n" +
      "done / продление — только WHERE id=$1 AND claim_token=$2\n" +
      "индекс: ON tasks(id) WHERE status='new' + по lease_until\n" +
      "attempts ≥ 5 → dead-letter queue · порядок — не строгий FIFO\n" +
      "эффекты идемпотентны: доставка at-least-once";
  }, { hold: 8, pause: true, voice: "Дальше идут запрос целиком и конспект: читайте в своём темпе, ролик подождёт." });
  d.shot("Что мы прошли: термины и суть.", (w) => {
    w.card =
      "Competing consumers — несколько воркеров на одну очередь\n" +
      "Race condition · check-then-act — посмотрел, потом взял\n" +
      "Local lock ≠ distributed lock — mutex видит только свой процесс\n" +
      "Compare-and-set — UPDATE … WHERE status='new', проверить affected rows\n" +
      "Pessimistic locking — FOR UPDATE; цена — очередь (head-of-line blocking)\n" +
      "SKIP LOCKED — занято, бери следующую; дубли убирает WHERE под замком\n" +
      "Lease — «в работе» + срок по часам БД, ставится при захвате\n" +
      "Завершение по токену владельца — бережёт только запись в БД\n" +
      "At-least-once + idempotency key = effectively-once\n\n" +
      "База бережёт свою запись. Двойной эффект гасит получатель.";
  }, { hold: 8 });
  d.shot("Подводные камни: на что смотреть в коде.", (w) => {
    w.card =
      "FOR UPDATE — только в транзакции: tx.QueryRow, не db.QueryRow\n" +
      "CAS: проверять RowsAffected(); проигравший ждёт COMMIT победителя\n" +
      "Долгая транзакция: соединение, VACUUM, замок — до таймаута\n" +
      "    idle_in_transaction_session_timeout / transaction_timeout (выкл.)\n" +
      "    пропал узел — до TCP keepalive (~2 ч) или tcp_user_timeout\n" +
      "Закоммитил in_progress и упал — застряло навсегда → lease\n" +
      "Пауза между проверкой срока и действием — тот же check-then-act:\n" +
      "    запись бережёт токен в WHERE, эффект — только идемпотентность\n" +
      "Токен, а не имя пода: имя повторяется (горутины в поде, StatefulSet\n" +
      "    после рестарта) — новый токен на каждый захват\n" +
      "Ключ идемпотентности — заказ + тип письма; повтор возвращает прошлый ответ\n" +
      "    свой получатель: INSERT … ON CONFLICT DO NOTHING в одной транзакции с эффектом";
  }, { hold: 8 });

  return d.steps;
}
