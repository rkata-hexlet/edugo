// Мини-модель Postgres для эпизода: таблица tasks, построчные блокировки, незакоммиченные правки,
// READ COMMITTED. Детерминирована: время — счётчик секунд world.clock (часы БД), токены — из списка.

export type Status = "new" | "in_progress" | "done";
/** Воркеры: A, B, C — поды. */
export type ActorId = "A" | "B" | "C";
export const ACTORS: ActorId[] = ["A", "B", "C"];

/** Колонки строки tasks (кроме id). */
export interface RowData {
  status: Status;
  token: string | null; // claim_token — номер талона
  leaseUntil: number | null; // lease_until
}

export interface Row extends RowData {
  id: number;
  lockedBy: ActorId | null; // построчная блокировка, живёт до COMMIT/ROLLBACK
  idle: boolean; // заперта при перепроверке, но не вернулась запросу — держатель её не брал
  draft: RowData | null; // незакоммиченная правка владельца блокировки
}

export type Place =
  | { kind: "home" }
  | { kind: "shelf"; row: number }
  | { kind: "queue"; row: number }
  | { kind: "road" }
  | { kind: "door"; row: number }; // у каждого заказа своя дверь

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
  present: boolean;
  at: Place;
  carrying: number | null;
  seen: number | null; // результат последнего SELECT (id или пусто)
  scan: Scan | null;
  pending: PendingUpdate | null;
  affected: number | null; // сколько строк задел последний UPDATE
  token: string | null; // талон, который воркер считает своим
  mutex: boolean; // держит свой sync.Mutex
  frozen: boolean; // завис (внешний API без таймаута, GC-пауза)
  say: string | null; // реплика в пузыре
}

export interface Delivery {
  row: number;
  by: ActorId;
  rejected: boolean; // клиент отклонил повтор по ключу идемпотентности
}

/** Событие кадра — для звука. Пишут операции модели и глаголы сценария, не отрисовка. */
export type EventKind =
  | "lock" | "relock" | "skip" | "wait" | "wake" | "commit" | "one" | "zero"
  | "deliver" | "duplicate" | "rejected" | "ticket"
  | "race" | "mutex" | "freeze" | "unfreeze" | "appear" | "crash" | "expire" | "clock" | "card" | "party" | "page";

export interface SimEvent {
  kind: EventKind;
  n?: number; // для clock — на сколько секунд прыгнули часы
  row?: number; // для доставки — какая посылка
  by?: ActorId; // для доставки — кто привёз
}

export interface World {
  clock: number;
  rows: Row[];
  actors: Record<ActorId, Actor>;
  deliveries: Delivery[];
  sql: string[]; // полный текст запросов кадра
  db: string | null; // реплика кладовщика-Postgres
  client: { row: number; text: string } | null; // реплика клиента заказа row
  race: boolean; // подсветить окно гонки
  card: string | null; // титр поверх сцены
  term: string | null; // ярлык акта: формальное имя проблемы/паттерна
  issued: number; // сколько талонов выдано
  queued: number; // счётчик очереди за блокировками
  events: SimEvent[]; // что случилось в этом кадре
}

const TOKENS = ["7f3a", "c21e", "9b04", "e6d1", "40ac", "d58f"];

export function world(rowCount = 4): World {
  const actor = (id: ActorId, label: string): Actor => ({
    id, label, present: true, at: { kind: "home" }, carrying: null, seen: null, scan: null,
    pending: null, affected: null, token: null, mutex: false, frozen: false, say: null,
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
    deliveries: [],
    sql: [],
    db: null,
    client: null,
    race: false,
    card: null,
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
        w.events.push({ kind: "skip" });
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
    w.events.push({ kind: "zero" });
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

/** Захват с талоном одним оператором в autocommit:
 *  UPDATE … SET claim_token, lease_until=now()+ttl WHERE id=(SELECT … FOR UPDATE SKIP LOCKED). */
export function claimLease(w: World, who: ActorId, ttl = 30): number | null {
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

/** Отдать посылку клиенту. idempotent — клиент отклоняет повтор по ключу заказа. */
export function deliver(w: World, who: ActorId, id: number, idempotent = false): void {
  const already = w.deliveries.some((d) => d.row === id && !d.rejected);
  const rejected = idempotent && already;
  w.deliveries.push({ row: id, by: who, rejected });
  w.events.push({ kind: rejected ? "rejected" : "deliver", row: id, by: who });
  if (!rejected && already) w.events.push({ kind: "duplicate", row: id, by: who });
}

/** id посылок, которые клиент реально получил больше одного раза. */
export function duplicates(w: World): number[] {
  const count = new Map<number, number>();
  for (const d of w.deliveries) if (!d.rejected) count.set(d.row, (count.get(d.row) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([id]) => id);
}
