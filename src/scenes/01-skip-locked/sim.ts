// Мини-модель Postgres для эпизода: таблица tasks, построчные блокировки, незакоммиченные правки,
// READ COMMITTED. Детерминирована: время — счётчик секунд world.clock (часы БД), токены — из списка.

export type Status = "new" | "in_progress" | "done";
/** Воркеры: A, B, C — поды; B2 — второй воркер пода B. */
export type ActorId = "A" | "B" | "C" | "B2";
export const ACTORS: ActorId[] = ["A", "B", "C", "B2"];

/** Колонки строки tasks (кроме id). */
export interface RowData {
  status: Status;
  token: string | null; // claim_token — номер талона
  leaseUntil: number | null; // lease_until
}

export interface Row extends RowData {
  id: number;
  lockedBy: ActorId | null; // построчная блокировка, живёт до COMMIT/ROLLBACK
  draft: RowData | null; // незакоммиченная правка владельца блокировки
}

export type Place =
  | { kind: "home" }
  | { kind: "shelf"; row: number }
  | { kind: "queue"; row: number }
  | { kind: "road" }
  | { kind: "door" };

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

export interface Actor {
  id: ActorId;
  label: string;
  present: boolean;
  at: Place;
  carrying: number | null;
  seen: number | null; // результат последнего SELECT (id или пусто)
  scan: Scan | null;
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

export interface World {
  clock: number;
  rows: Row[];
  actors: Record<ActorId, Actor>;
  deliveries: Delivery[];
  sql: string[]; // полный текст запросов кадра
  db: string | null; // реплика кладовщика-Postgres
  client: string | null; // реплика клиента у двери
  race: boolean; // подсветить окно гонки
  card: string | null; // титр поверх сцены
  issued: number; // сколько талонов выдано
  queued: number; // счётчик очереди за блокировками
}

const TOKENS = ["7f3a", "c21e", "9b04", "e6d1", "40ac", "d58f"];

export function world(rowCount = 4): World {
  const actor = (id: ActorId, label: string, present = true): Actor => ({
    id, label, present, at: { kind: "home" }, carrying: null, seen: null, scan: null,
    affected: null, token: null, mutex: false, frozen: false, say: null,
  });
  return {
    clock: 0,
    rows: Array.from({ length: rowCount }, (_, i) => ({
      id: i + 1, status: "new", token: null, leaseUntil: null, lockedBy: null, draft: null,
    })),
    actors: {
      A: actor("A", "Pod A"),
      B: actor("B", "Pod B"),
      C: actor("C", "Pod C"),
      B2: actor("B2", "Pod B · воркер 2", false),
    },
    deliveries: [],
    sql: [],
    db: null,
    client: null,
    race: false,
    card: null,
    issued: 0,
    queued: 0,
  };
}

export function rowById(w: World, id: number): Row {
  const r = w.rows.find((x) => x.id === id);
  if (!r) throw new Error(`нет строки #${id}`);
  return r;
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
function advance(w: World, a: Actor): void {
  const s = a.scan!;
  while (s.candidates.length > 0) {
    const r = rowById(w, s.candidates[0]);
    if (r.lockedBy !== null && r.lockedBy !== a.id) {
      if (s.lock === "skip_locked") {
        s.candidates.shift();
        continue;
      }
      if (s.waitingFor !== r.id) s.since = w.clock;
      s.waitingFor = r.id;
      return;
    }
    s.candidates.shift();
    s.waitingFor = null;
    r.lockedBy = a.id;
    if (claimable(visible(r, a.id), s.lease, w.clock)) {
      a.seen = r.id;
      a.scan = null;
      return;
    }
  }
  a.scan = null; // кандидаты кончились — 0 строк
}

/** UPDATE tasks SET <set> WHERE id=$id [AND <where>]; affected = 0 или 1. */
export function updateTask(
  w: World, who: ActorId, id: number, set: Partial<RowData>, where?: (d: RowData) => boolean,
): void {
  const r = rowById(w, id);
  // Настоящий UPDATE здесь ждал бы блокировку; сценарии так не строим, чтобы модель не врала.
  if (r.lockedBy !== null && r.lockedBy !== who) {
    throw new Error(`сценарий: UPDATE #${id} от ${who} упёрся бы в блокировку ${r.lockedBy}`);
  }
  const cur = visible(r, who);
  const a = w.actors[who];
  if (where && !where(cur)) {
    a.affected = 0;
    return;
  }
  r.lockedBy = who;
  r.draft = { status: cur.status, token: cur.token, leaseUntil: cur.leaseUntil, ...set };
  a.affected = 1;
}

/** COMMIT: правки становятся видны всем, блокировки снимаются, ждавшие просыпаются. */
export function commit(w: World, who: ActorId): void {
  const released: number[] = [];
  for (const r of w.rows) {
    if (r.lockedBy !== who) continue;
    if (r.draft) Object.assign(r, r.draft);
    r.draft = null;
    r.lockedBy = null;
    released.push(r.id);
  }
  // Ждавшие просыпаются в порядке очереди; кто не успел — ждёт уже нового владельца.
  const waiters = ACTORS.map((id) => w.actors[id])
    .filter((a) => a.scan?.waitingFor != null && released.includes(a.scan.waitingFor))
    .sort((x, y) => x.scan!.order - y.scan!.order);
  for (const a of waiters) advance(w, a);
}

/** Захват с талоном одним оператором в autocommit:
 *  UPDATE … SET claim_token, lease_until=now()+ttl WHERE id=(SELECT … FOR UPDATE SKIP LOCKED). */
export function claimLease(w: World, who: ActorId, ttl = 30): number | null {
  selectTask(w, who, "skip_locked", true);
  const a = w.actors[who];
  const id = a.seen;
  if (id === null) return null;
  const token = TOKENS[w.issued++ % TOKENS.length];
  updateTask(w, who, id, { status: "in_progress", token, leaseUntil: w.clock + ttl });
  commit(w, who);
  a.token = token;
  return id;
}

/** UPDATE tasks SET status='done' WHERE id=$id [AND claim_token=$мой] ; COMMIT */
export function complete(w: World, who: ActorId, id: number, byToken: boolean): void {
  const mine = w.actors[who].token;
  updateTask(w, who, id, { status: "done" }, byToken ? (d) => d.token === mine : undefined);
  commit(w, who);
}

/** Отдать посылку клиенту. idempotent — клиент отклоняет повтор по ключу заказа. */
export function deliver(w: World, who: ActorId, id: number, idempotent = false): void {
  const already = w.deliveries.some((d) => d.row === id && !d.rejected);
  w.deliveries.push({ row: id, by: who, rejected: idempotent && already });
}

/** id посылок, которые клиент реально получил больше одного раза. */
export function duplicates(w: World): number[] {
  const count = new Map<number, number>();
  for (const d of w.deliveries) if (!d.rejected) count.set(d.row, (count.get(d.row) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([id]) => id);
}
