import type { Step } from "../../engine/contract";
import {
  claimLease, commit, complete, crash, deliver, selectTask, updateTask, waitingFor, world,
  type ActorId, type LockMode, type Place, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/01-skip-locked.md (сценарий v3, покадрово).

export const ACT = {
  hook: "0. Хук",
  race: "1. Нормальный мир → час пик",
  naive: "2. Наивные фиксы",
  crowd: "3a. Толпа",
  convoy: "3b. Конвой",
  skip: "3c. Обход",
  lease: "4. Курьер завис / упал",
  zombie: "5. B и C",
  cheat: "6. Шпаргалка",
} as const;

const SQL = {
  select: (lock: LockMode) =>
    "SELECT id FROM tasks WHERE status='new'\n  ORDER BY id LIMIT 1" +
    (lock === "for_update" ? " FOR UPDATE" : lock === "skip_locked" ? "\n  FOR UPDATE SKIP LOCKED" : ""),
  take: (id: number) => `UPDATE tasks SET status='in_progress' WHERE id=${id}`,
  takeIfNew: (id: number) => `UPDATE tasks SET status='in_progress'\n  WHERE id=${id} AND status='new'`,
  done: (id: number) => `UPDATE tasks SET status='done' WHERE id=${id}`,
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

const rows = (n: number) => `→ ${n} ${n === 1 ? "строка" : "строк"}`;

const home: Place = { kind: "home" };
const road: Place = { kind: "road" };
const door = (row: number): Place => ({ kind: "door", row });
const shelf = (row: number): Place => ({ kind: "shelf", row });

/** Время кадра: база + чтение всего текста в кадре (правило «Текст в кадре» в CLAUDE.md). */
export function holdFor(caption: string, w: World): number {
  const says = Object.values(w.actors).map((a) => a.say ?? "");
  const text = [caption, w.card ?? "", w.db ?? "", w.client?.text ?? "", ...says, ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

interface ShotOptions {
  /** Показать SQL-панель: только где SQL надо прочитать. Глаголы пишут SQL всегда — панель полная. */
  sql?: boolean;
  /** Своё время кадра, с: монтаж или шпаргалка. */
  hold?: number;
}

class Director {
  readonly steps: Step<World>[] = [];
  w: World = world();
  private act = "";
  private fresh = false;
  private label: string | null = null;

  /** Новая сцена; ярлык переживает смену сцены внутри акта и сбрасывается на новом акте. */
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

  /** Применить действия и записать кадр. Реплики, SQL и титры живут один кадр. */
  shot(caption: string, action?: (w: World) => void, opts: ShotOptions = {}): void {
    const w = this.w;
    w.sql = [];
    w.db = null;
    w.client = null;
    w.race = false;
    w.card = null;
    w.term = this.label;
    w.events = this.fresh ? [{ kind: "page" }] : [];
    this.fresh = false;
    for (const a of Object.values(w.actors)) a.say = null;
    action?.(w);
    if (!opts.sql) w.sql = [];
    const card = w.card as string | null; // action мог выставить титр
    if (card) w.events.push({ kind: card.includes("🎉") ? "party" : "card" });
    const state = structuredClone(w);
    this.steps.push({ act: this.act, caption, state, hold: opts.hold ?? holdFor(caption, state) });
  }
}

// --- Глаголы сценария: операции модели + реплики, SQL и перемещения ---

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

/** Подойти к стеллажу и выбрать задачу; встать у найденной полки или в очередь. С блокировкой — в транзакции. */
function look(w: World, who: ActorId, lock: LockMode = "none", line: string | null = null): void {
  selectTask(w, who, lock);
  place(w, who);
  say(w, who, line);
  sql(w, who, (lock === "none" ? "" : "BEGIN;\n") + SQL.select(lock));
}

/** Поставить воркера туда, где его держит запрос: в очередь за замком или к найденной полке. */
function place(w: World, who: ActorId): void {
  const a = w.actors[who];
  const wait = waitingFor(a);
  if (wait !== null) a.at = { kind: "queue", row: wait };
  else if (a.seen !== null) a.at = shelf(a.seen);
}

/** UPDATE по id без проверок + COMMIT: посылка в руках. */
function take(w: World, who: ActorId, id: number): void {
  updateTask(w, who, id, { status: "in_progress" });
  commit(w, who);
  w.actors[who].carrying = id;
  sql(w, who, `${SQL.take(id)}; COMMIT`);
}

/** Условный UPDATE … AND status='new' в транзакции: задел строку — посылка в руках; занято — ждёт. */
function cas(w: World, who: ActorId, id: number): void {
  const a = w.actors[who];
  updateTask(w, who, id, { status: "in_progress" }, { status: "new" });
  place(w, who);
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

/** Довезти до двери и отметить done (без талонов). */
function drop(w: World, who: ActorId, id: number): void {
  w.actors[who].at = door(id);
  deliver(w, who, id);
  complete(w, who, id, false);
  w.actors[who].carrying = null;
  sql(w, who, `${SQL.done(id)}; COMMIT`);
}

function grabWithLease(w: World, who: ActorId): number {
  const id = claimLease(w, who);
  if (id === null) throw new Error(`сценарий: ${who} не нашёл задачу`);
  const a = w.actors[who];
  a.at = shelf(id);
  a.carrying = id;
  say(w, who, `талон #${a.token}`);
  sql(w, who, SQL.claim);
  return id;
}

export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `12:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


export function buildSteps(): Step<World>[] {
  const d = new Director();

  // 1. Нормальный мир → час пик.
  d.scene(ACT.race);
  d.shot("Полка — задача. Курьеры — три пода одного сервиса.", (w) => look(w, "A", "none", "что свободно?"));
  d.shot("", (w) => {
    take(w, "A", 1);
    w.actors.A.at = road;
    w.db = "Бери. Распишись. Следующий.";
  });
  d.shot("", (w) => {
    drop(w, "A", 1);
    look(w, "B");
    take(w, "B", 2);
    w.actors.B.at = road;
    w.db = "Распишись. Следующий.";
  }, { hold: 1.8 });
  d.shot("Час пик.", (w) => {
    drop(w, "B", 2);
    w.actors.A.at = home;
    look(w, "A", "none", "полка 3 свободна!");
  });
  d.term("Race condition · check-then-act");
  d.shot("A ещё ничего не записал.", (w) => {
    look(w, "B", "none", "полка 3 свободна!");
    say(w, "A", "полка 3 свободна!");
    race(w);
    w.db = "Свободна. Пока что.";
  });
  d.shot("", (w) => {
    w.race = true;
    w.card = "ОКНО ГОНКИ\n\nSELECT ──── сюда влезет сосед ──── UPDATE";
    w.db = "Я показал, что было. Дальше сами.";
  });
  d.shot("UPDATE по id ничего не проверяет.", (w) => {
    take(w, "A", 3);
    take(w, "B", 3);
  }, { sql: true });
  d.shot("", (w) => {
    drop(w, "A", 3);
    drop(w, "B", 3);
    w.client = { row: 3, text: "Две одинаковые?!" };
  });

  // 2. Наивные фиксы — монтаж.
  d.scene(ACT.naive);
  d.shot("Фикс №1: перепроверить. Окно не закрылось — переехало.", (w) => {
    look(w, "A", "none", "точно new? ✓");
    look(w, "B", "none", "точно new? ✓");
    race(w);
  });
  d.shot("", (w) => {
    take(w, "A", 1);
    take(w, "B", 1);
  });
  d.scene(ACT.naive);
  d.shot("Фикс №2: sync.Mutex.", (w) => {
    mutex(w, "B");
    say(w, "B", "Я повесил замок!");
    w.db = "На свой рюкзак.";
  });
  d.term("Local lock ≠ distributed lock");
  d.shot("", (w) => {
    mutex(w, "A");
    look(w, "A", "none", "mu.Lock() ✓");
    look(w, "B");
    race(w);
    w.card = "Mutex видит только свой под.\nОбщее у подов — только база.";
  });

  // 3a. Толпа: условный UPDATE.
  d.scene(ACT.crowd);
  d.shot("Способ 1: «бери, только если ещё new».", (w) => {
    look(w, "A");
    look(w, "B");
    look(w, "C");
  });
  d.shot("Остальные ждут его COMMIT.", (w) => {
    cas(w, "A", 1);
    cas(w, "B", 1);
    cas(w, "C", 1);
  }, { sql: true });
  d.term("Compare-and-set · optimistic locking");
  d.shot("", (w) => {
    commitTx(w, "A");
    say(w, "B", "0 строк…");
    say(w, "C", "0 строк…");
  }, { sql: true });
  d.shot("Дублей нет. Но кто-то всегда проигрывает.", (w) => {
    w.actors.A.at = road;
    look(w, "C");
    look(w, "B");
    cas(w, "C", 2);
    cas(w, "B", 2);
    commitTx(w, "C");
    say(w, "B", "Опять ноль строк…");
  });

  // 3b. Конвой: FOR UPDATE.
  d.scene(ACT.convoy);
  d.shot("Способ 2: A вешает замок на #1.", (w) => look(w, "A", "for_update"), { sql: true });
  d.term("Pessimistic locking");
  d.shot("Хотя #2–#4 свободны.", (w) => {
    look(w, "B", "for_update");
    look(w, "C", "for_update", "Я стою за тем, кто стоит за тем, кто держит.");
    w.db = "Занято. Жди.";
  });
  d.shot("Ждут ровно столько, сколько длится транзакция A.", (w) => {
    setClock(w, w.clock + 3);
    updateTask(w, "A", 1, { status: "in_progress" });
    say(w, "A", "не тороплюсь…");
  });
  d.shot("C теперь ждёт B.", (w) => {
    commit(w, "A");
    sql(w, "A", "COMMIT");
    w.actors.A.carrying = 1;
    w.actors.A.at = road;
    place(w, "B");
    place(w, "C");
    say(w, "B", "#2!");
  }, { sql: true });
  d.shot("", (w) => {
    setClock(w, w.clock + 3);
    updateTask(w, "B", 2, { status: "in_progress" });
    commit(w, "B");
    w.actors.B.carrying = 2;
    w.actors.B.at = road;
    place(w, "C");
    w.card = "FOR UPDATE: дублей нет,\nно все стоят в очереди.";
  });

  // 3c. Обход: SKIP LOCKED.
  d.scene(ACT.skip);
  d.shot("Способ 3: SKIP LOCKED.", (w) => look(w, "A", "skip_locked"), { sql: true });
  d.term("Non-blocking claim · SKIP LOCKED");
  d.shot("", (w) => {
    look(w, "B", "skip_locked", "Занято? Ну и ладно.");
    look(w, "C", "skip_locked");
    w.db = "Наконец-то воспитанный.";
  });
  d.shot("Без дублей и без очереди.", (w) => {
    for (const who of ["A", "B", "C"] as const) {
      take(w, who, w.actors[who].seen!);
      w.actors[who].at = road;
    }
  });
  d.shot("", (w) => {
    drop(w, "A", 1);
    drop(w, "B", 2);
    drop(w, "C", 3);
    w.card = "FOR UPDATE SKIP LOCKED\nЗанято — иди к следующей.";
  });

  // 4. Курьер завис / упал → талон.
  d.scene(ACT.lease);
  d.shot("", (w) => {
    w.card = "Починили! 🎉";
  });
  d.shot("Вариант 1: держать транзакцию, пока везём.", (w) => {
    look(w, "B", "skip_locked");
    updateTask(w, "B", 1, { status: "in_progress" });
    sql(w, "B", `${SQL.take(1)}\n  -- без COMMIT: везём внутри транзакции`);
    w.actors.B.carrying = 1;
    w.actors.B.at = road;
  }, { sql: true });
  d.shot("B завис на внешнем API.", (w) => {
    setClock(w, 5);
    freeze(w, "B", true);
    say(w, "B", "📞 Ваш звонок очень важен для нас…");
    w.db = "Упал бы — соединение закрылось бы,\nзамки бы снял. А он жив.";
  });
  d.shot("10 минут. Все обходят #1. Её никто не везёт.", (w) => {
    setClock(w, 600);
    look(w, "A", "skip_locked");
    look(w, "C", "skip_locked");
  });
  d.shot("Убили под — замок снялся сам.", (w) => {
    crash(w, "B");
    const b = w.actors.B; // под перезапустился: тот же B, новое соединение
    b.present = true;
    b.frozen = false;
    b.at = home;
    w.events.push({ kind: "appear" });
  });
  d.scene(ACT.lease);
  d.w.clock = 610; // часы склада идут дальше, назад не прыгают
  d.shot("Вариант 2: отметить «в работе» и сразу COMMIT.", (w) => {
    look(w, "B", "skip_locked");
    take(w, "B", 1);
    w.actors.B.at = road;
  }, { sql: true });
  d.shot("#1 «в работе» навсегда.", (w) => {
    crash(w, "B");
    setClock(w, 660);
    look(w, "A", "skip_locked");
    look(w, "C", "skip_locked");
    w.db = "В работе. Жив ли он — не знаю.";
  });
  d.scene(ACT.lease);
  d.w.clock = 660;
  d.shot("", (w) => {
    w.card = "Lease: при захвате — «в работе» + срок по часам БД.\nНе успел — берёт другой.";
  });
  d.term("Lease");
  d.shot("", (w) => {
    setClock(w, 670);
    grabWithLease(w, "B");
    w.db = "Талон до 12:11:40. По моим часам.";
  }, { sql: true });
  d.shot("B проверил срок — и снова завис.", (w) => {
    setClock(w, 675);
    w.actors.B.at = road;
    say(w, "B", "До :40 — успею.");
    freeze(w, "B", true);
  });
  d.shot("", (w) => {
    setClock(w, 701);
    w.db = "Срок вышел. Заберёт тот, кто спросит.";
  });
  d.shot("C берёт #1.", (w) => {
    w.events.push({ kind: "expire" }); // просрочку замечает захват, а не таймер базы
    grabWithLease(w, "C");
  });

  // 5. B и C → та же дверь.
  d.scene(ACT.zombie, structuredClone(d.w));
  d.shot("", (w) => {
    setClock(w, 710);
    freeze(w, "B", false);
    say(w, "B", "Талон до :40, я проверял в :15!");
    w.db = "Проверял — в :15. Сейчас :50.";
  });
  d.term("At-least-once · idempotency key");
  d.shot("Запись цела. Посылка уже у клиента.", (w) => {
    const b = w.actors.B;
    b.at = door(1);
    deliver(w, "B", 1, true);
    complete(w, "B", 1, true);
    b.carrying = null;
    say(w, "B", "…а посылку я уже отвёз.");
    sql(w, "B", `${SQL.doneByToken(1, "7f3a")}  ${rows(0)}`);
    w.db = "Талон #7f3a сгорел.";
  }, { sql: true });
  d.shot("", (w) => {
    const c = w.actors.C;
    c.at = door(1);
    deliver(w, "C", 1, true);
    complete(w, "C", 1, true);
    c.carrying = null;
    sql(w, "C", `${SQL.doneByToken(1, "c21e")}  ${rows(1)}`);
    w.client = { row: 1, text: "Заказ 1? Уже получил. Спасибо." };
  }, { sql: true });
  d.shot("", (w) => {
    w.db = "Ровно один раз? Это не ко мне. Это к двери.";
  });
  d.shot("", (w) => {
    w.card = "Склад бережёт свою запись.\nДвойной эффект ловит получатель.";
  });

  // 6. Шпаргалка — после ролика текста можно много.
  d.scene(ACT.cheat);
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
      "attempts ≥ 5 → полка возвратов · порядок — не строгий FIFO\n" +
      "эффекты идемпотентны: доставка at-least-once";
  }, { hold: 12 });
  d.shot("Что мы прошли — этими словами и отвечать.", (w) => {
    w.card =
      "Competing consumers — несколько воркеров на одну очередь\n" +
      "Race condition · check-then-act — посмотрел, потом взял\n" +
      "Local lock ≠ distributed lock — mutex видит только свой процесс\n" +
      "Compare-and-set — UPDATE … WHERE status='new', проверить affected rows;\n" +
      "    читаем без замка, но запись ждёт незакоммиченного соперника\n" +
      "Pessimistic locking — FOR UPDATE; цена — head-of-line blocking\n" +
      "SKIP LOCKED — та же блокировка строки, но без ожидания; не строгий FIFO\n" +
      "Lease — «в работе» + срок по часам БД, ставится при захвате\n" +
      "Завершение по токену владельца — тот же CAS, бережёт только запись в БД\n" +
      "At-least-once + idempotency key = effectively-once";
  }, { hold: 15 });
  d.shot("Что спросят на собесе.", (w) => {
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
      "Идемпотентность у получателя — INSERT … ON CONFLICT DO NOTHING\n" +
      "    в одной транзакции с самим эффектом";
  }, { hold: 15 });

  // 0. Хук — исход акта 5 без идемпотентности у двери, но без талонов и сроков: их зритель
  // ещё не знает. Ставится в начало.
  const hook = new Director();
  hook.scene(ACT.hook);
  hook.shot("Каждый был уверен, что посылка его.", (w) => {
    w.actors.A.present = false;
    for (const who of ["B", "C"] as const) {
      w.actors[who].at = door(1);
      deliver(w, who, 1);
    }
    complete(w, "C", 1, false);
    w.client = { row: 1, text: "Мне два одинаковых заказа?" };
  });
  hook.scene(ACT.hook);
  hook.shot("", (w) => {
    w.card = "Competing consumers:\nнесколько подов, одна очередь.\nКак не сделать работу дважды?";
  });

  return [...hook.steps, ...d.steps];
}
