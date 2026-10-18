// Мини-модель Postgres для эпизода: таблица tasks, построчные блокировки, незакоммиченные правки,
// READ COMMITTED. Детерминирована: время — счётчик секунд world.clock (часы БД), токены — из списка.

export type Status = "new" | "in_progress" | "done";
/** Воркеры: A, B, C — поды. */
export type ActorId = "A" | "B" | "C";
export const ACTORS: ActorId[] = ["A", "B", "C"];

/** Колонки строки tasks (кроме id). */
export interface RowData {
  status: Status;
  token: string | null; // claim_token — токен захвата
  leaseUntil: number | null; // lease_until
}

export interface Row extends RowData {
  id: number;
  lockedBy: ActorId | null; // построчная блокировка, живёт до COMMIT/ROLLBACK
  idle: boolean; // заперта при перепроверке, но не вернулась запросу — держатель её не брал
  draft: RowData | null; // незакоммиченная правка владельца блокировки
}

export type LockMode = "none" | "for_update" | "skip_locked";

/** Незавершённый SELECT … FOR UPDATE: кандидаты из снимка на момент начала запроса. */
export interface Scan {
  lock: LockMode;
  lease: boolean;
  candidates: number[];
  waitingFor: number | null;
  since: number; // с какого момента ждёт
  order: number; // порядок постановки в очередь за блокировкой
}

/** UPDATE, упёршийся в чужую блокировку: ждёт COMMIT/ROLLBACK держателя, потом перепроверяет WHERE. */
export interface PendingUpdate {
  id: number;
  set: Partial<RowData>;
  where: Partial<RowData> | null;
  order: number;
}

export interface Actor {
  id: ActorId;
  label: string;
  present: boolean; // false — под упал
  carrying: number | null; // задача в работе у пода
  seen: number | null; // результат последнего SELECT (id или пусто)
  scan: Scan | null;
  pending: PendingUpdate | null;
  affected: number | null; // сколько строк задел последний UPDATE
  token: string | null; // токен, который воркер считает своим
  mutex: boolean; // держит свой sync.Mutex
  frozen: boolean; // завис (внешний API без таймаута, GC-пауза)
  checkedAt: number | null; // когда под последний раз проверил срок своей аренды (по часам БД)
  say: string | null; // реплика в пузыре
}

/** Письмо в Почту — внешний эффект задачи; таблица tasks его не видит. */
export interface Letter {
  row: number;
  by: ActorId;
  replayed: boolean; // повтор с тем же ключом идемпотентности: Почта вернула прошлый ответ
  keyed: boolean; // письмо отправлено с ключом идемпотентности (номер заказа)
}

export type Focus = ActorId | `row:${number}` | "table" | "mail" | "board" | "clock" | "sql";

/** Табло главы: попытки и их оценка по двум критериям. Оценку проверяют тесты по модели. */
export type Lamp = "red" | "yellow" | "green";
export interface Board {
  criteria: [string, string];
  attempts: { name: string; lamps: [Lamp, Lamp] | null }[]; // null — ещё не проверили
}

/** Событие кадра — для звука. Пишут операции модели и глаголы сценария, не отрисовка. */
export type EventKind =
  | "lock" | "relock" | "skip" | "wait" | "wake" | "commit" | "one" | "zero"
  | "send" | "duplicate" | "replay" | "ticket"
  | "race" | "mutex" | "freeze" | "unfreeze" | "crash" | "expire" | "clock" | "card" | "page";

export interface SimEvent {
  kind: EventKind;
  n?: number; // для clock — на сколько секунд прыгнули часы
  row?: number; // письмо — по какой задаче; skip — какую строку пропустили
  by?: ActorId; // кто отправил / пропустил / проиграл
}

export interface World {
  clock: number;
  rows: Row[];
  actors: Record<ActorId, Actor>;
  letters: Letter[]; // журнал Почты
  sql: string[]; // полный текст запросов кадра
  db: string | null; // реплика кладовщика-Postgres
  mail: string | null; // реплика Почты
  race: boolean; // подсветить окно гонки
  card: string | null; // титр поверх сцены
  plate: string | null; // полноэкранная плашка главы
  chapter: number | null; // номер кейса — в углу всю главу
  board: Board | null; // табло попыток главы
  leaseCols: boolean; // показать колонки claim_token и lease_until
  ghost: { row: number; token: string } | null; // прежний токен строки — зачёркнутым, кадр перехвата
  stamp: string | null; // штамп перехода («⟲ вернёмся…») — мир перемотан
  /** О чём сейчас говорит диктор: A/B/C, row:N, table, mail, board, clock, sql. Остальное приглушено. */
  focus: Focus[] | null;
  term: string | null; // ярлык акта: формальное имя проблемы/паттерна
  issued: number; // сколько токенов выдано
  queued: number; // счётчик очереди за блокировками
  events: SimEvent[]; // что случилось в этом кадре
}

const TOKENS = ["7f3a", "c21e", "9b04", "e6d1", "40ac", "d58f"];

export function world(rowCount = 6): World {
  const actor = (id: ActorId, label: string): Actor => ({
    id, label, present: true, carrying: null, seen: null, scan: null,
    pending: null, affected: null, token: null, mutex: false, frozen: false, checkedAt: null, say: null,
  });
  return {
    clock: 0,
    rows: Array.from({ length: rowCount }, (_, i) => ({
      id: i + 1, status: "new", token: null, leaseUntil: null, lockedBy: null, idle: false, draft: null,
    })),
    actors: {
      A: actor("A", "Pod A"),
      B: actor("B", "Pod B"),
      C: actor("C", "Pod C"),
    },
    letters: [],
    sql: [],
    db: null,
    mail: null,
    race: false,
    card: null,
    plate: null,
    chapter: null,
    board: null,
    leaseCols: false,
    ghost: null,
    stamp: null,
    focus: null,
    term: null,
    issued: 0,
    queued: 0,
    events: [],
  };
}

export function rowById(w: World, id: number): Row {
  const r = w.rows.find((x) => x.id === id);
  if (!r) throw new Error(`нет строки #${id}`);
  return r;
}

/** Строка, которую воркер ждёт: запрос с блокировкой или UPDATE. */
export function waitingFor(a: Actor): number | null {
  return a.scan?.waitingFor ?? a.pending?.id ?? null;
}

/** Что видит транзакция воркера: свою незакоммиченную правку или закоммиченную версию. */
export function visible(r: Row, who: ActorId): RowData {
  return r.lockedBy === who && r.draft ? r.draft : r;
}

/** WHERE status='new' [OR (status='in_progress' AND lease_until < now())] */
function claimable(d: RowData, lease: boolean, clock: number): boolean {
  if (d.status === "new") return true;
  return lease && d.status === "in_progress" && d.leaseUntil !== null && d.leaseUntil < clock;
}

/** SELECT id FROM tasks WHERE <claimable> ORDER BY id LIMIT 1 [FOR UPDATE [SKIP LOCKED]] */
export function selectTask(w: World, who: ActorId, lock: LockMode = "none", lease = false): void {
  const a = w.actors[who];
  const candidates = w.rows.filter((r) => claimable(visible(r, who), lease, w.clock)).map((r) => r.id);
  a.seen = null;
  if (lock === "none") {
    a.seen = candidates[0] ?? null;
    return;
  }
  a.scan = { lock, lease, candidates, waitingFor: null, since: w.clock, order: ++w.queued };
  advance(w, a);
}

/**
 * Продвинуть запрос с блокировкой по кандидатам снимка. Занято: SKIP LOCKED — дальше,
 * FOR UPDATE — ждать. Дождавшись, строка блокируется и перепроверяется по свежей версии;
 * не подходит — остаётся заблокированной, но не возвращается, берём следующего кандидата.
 */
function advance(w: World, a: Actor, woke = false): void {
  const s = a.scan!;
  while (s.candidates.length > 0) {
    const r = rowById(w, s.candidates[0]);
    if (r.lockedBy !== null && r.lockedBy !== a.id) {
      if (s.lock === "skip_locked") {
        s.candidates.shift();
        w.events.push({ kind: "skip", row: r.id, by: a.id });
        continue;
      }
      if (s.waitingFor !== r.id) {
        s.since = w.clock;
        if (!woke) w.events.push({ kind: "wait" });
      }
      s.waitingFor = r.id;
      return;
    }
    s.candidates.shift();
    s.waitingFor = null;
    r.lockedBy = a.id;
    w.events.push({ kind: woke ? "relock" : "lock" });
    if (claimable(visible(r, a.id), s.lease, w.clock)) {
      a.seen = r.id;
      a.scan = null;
      return;
    }
    r.idle = true;
  }
  a.scan = null; // кандидаты кончились — 0 строк
}

/** UPDATE tasks SET <set> WHERE id=$id [AND <where>]; affected = 0 или 1.
 *  Строка под чужой блокировкой — ждём её COMMIT/ROLLBACK и перепроверяем WHERE на свежей версии. */
export function updateTask(
  w: World, who: ActorId, id: number, set: Partial<RowData>, where: Partial<RowData> | null = null,
): void {
  const a = w.actors[who];
  const r = rowById(w, id);
  if (r.lockedBy !== null && r.lockedBy !== who) {
    a.pending = { id, set, where, order: ++w.queued };
    a.affected = null;
    w.events.push({ kind: "wait" });
    return;
  }
  apply(w, a, r, set, where);
}

function apply(w: World, a: Actor, r: Row, set: Partial<RowData>, where: Partial<RowData> | null): void {
  const cur = visible(r, a.id);
  if (where && !Object.entries(where).every(([k, v]) => cur[k as keyof RowData] === v)) {
    a.affected = 0;
    w.events.push({ kind: "zero", by: a.id, row: r.id });
    return;
  }
  r.lockedBy = a.id;
  r.idle = false;
  r.draft = { status: cur.status, token: cur.token, leaseUntil: cur.leaseUntil, ...set };
  a.affected = 1;
  if (where) w.events.push({ kind: "one" });
}

/** COMMIT: правки становятся видны всем, блокировки снимаются, ждавшие просыпаются. */
export function commit(w: World, who: ActorId): void {
  finish(w, who, true);
}

/** ROLLBACK: правки отброшены, блокировки сняты. Так же кончается транзакция упавшего пода. */
export function rollback(w: World, who: ActorId): void {
  finish(w, who, false);
}

function finish(w: World, who: ActorId, keep: boolean): void {
  const released: number[] = [];
  for (const r of w.rows) {
    if (r.lockedBy !== who) continue;
    if (keep && r.draft) Object.assign(r, r.draft);
    r.draft = null;
    r.lockedBy = null;
    r.idle = false;
    released.push(r.id);
  }
  if (keep && released.length > 0) w.events.push({ kind: "commit" });
  // Ждавшие просыпаются в порядке очереди; кто не успел — ждёт уже нового владельца.
  const waiters = ACTORS.map((id) => w.actors[id])
    .filter((a) => released.includes(waitingFor(a) ?? -1))
    .sort((x, y) => (x.scan?.order ?? x.pending!.order) - (y.scan?.order ?? y.pending!.order));
  for (const a of waiters) {
    if (a.scan) {
      advance(w, a, true);
      if (a.scan === null) w.events.push({ kind: "wake" });
      continue;
    }
    const p = a.pending!;
    const r = rowById(w, p.id);
    if (r.lockedBy !== null && r.lockedBy !== a.id) continue; // успел другой ждавший — ждём его
    a.pending = null;
    w.events.push({ kind: "wake" });
    apply(w, a, r, p.set, p.where);
  }
}

/** Под упал: соединение закрылось, его транзакция откатилась, воркера больше нет. */
export function crash(w: World, who: ActorId): void {
  rollback(w, who);
  const a = w.actors[who];
  a.present = false;
  a.carrying = null;
  a.scan = null;
  a.pending = null;
  w.events.push({ kind: "crash" });
}

/** Срок аренды задачи, с: lease_until = now() + LEASE_TTL. */
export const LEASE_TTL = 30;

/** Захват с токеном и сроком одним оператором в autocommit:
 *  UPDATE … SET claim_token, lease_until=now()+ttl WHERE id=(SELECT … FOR UPDATE SKIP LOCKED). */
export function claimLease(w: World, who: ActorId, ttl = LEASE_TTL): number | null {
  selectTask(w, who, "skip_locked", true);
  const a = w.actors[who];
  const id = a.seen;
  if (id === null) return null;
  const token = TOKENS[w.issued++ % TOKENS.length];
  w.events.push({ kind: "ticket" });
  updateTask(w, who, id, { status: "in_progress", token, leaseUntil: w.clock + ttl });
  commit(w, who);
  a.token = token;
  return id;
}

/** UPDATE tasks SET status='done' WHERE id=$id [AND claim_token=$мой] ; COMMIT */
export function complete(w: World, who: ActorId, id: number, byToken: boolean): void {
  const mine = w.actors[who].token;
  updateTask(w, who, id, { status: "done" }, byToken ? { token: mine } : null);
  commit(w, who);
}

/** Отправить письмо по задаче. keyed — с Idempotency-Key: повтор Почта не шлёт, а возвращает прошлый ответ. */
export function send(w: World, who: ActorId, id: number, keyed = false): void {
  const already = w.letters.some((l) => l.row === id && !l.replayed);
  const replayed = keyed && already;
  w.letters.push({ row: id, by: who, replayed, keyed });
  w.events.push({ kind: replayed ? "replay" : "send", row: id, by: who });
  if (!replayed && already) w.events.push({ kind: "duplicate", row: id, by: who });
}

/** Задачи, по которым ушло больше одного письма. */
export function duplicates(w: World): number[] {
  const count = new Map<number, number>();
  for (const l of w.letters) if (!l.replayed) count.set(l.row, (count.get(l.row) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([id]) => id);
}

/** Задача застряла без срока: замок держит зависший/упавший под или «в работе» без lease у пода,
 *  который её не делает. Талон со сроком — ожидание ограничено, это не «застряла». */
export function stuck(w: World): boolean {
  return stuckRows(w).length > 0;
}

/** id задач, застрявших без срока (см. stuck). */
export function stuckRows(w: World): number[] {
  const dead = (id: ActorId | null) => id !== null && (w.actors[id].frozen || !w.actors[id].present);
  const holder = (r: Row) => ACTORS.find((id) => w.actors[id].carrying === r.id) ?? null;
  return w.rows.filter((r) =>
    dead(r.lockedBy) ||
    (r.status === "in_progress" && r.leaseUntil === null && (holder(r) === null || dead(holder(r))))).map((r) => r.id);
}
