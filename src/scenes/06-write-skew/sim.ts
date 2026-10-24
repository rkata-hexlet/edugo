// Мини-модель Postgres для слота доставки: заказы слота — отдельные строки orders, лимит — cap в строке slots.
// Что видит транзакция — снимок (RC — на каждый оператор, RR и SERIALIZABLE — с первого оператора). Write skew:
// оба считают заказы слота по своему снимку и вставляют каждый свою строку — RR не видит конфликта, потому что
// одну и ту же строку никто не меняет. SERIALIZABLE (SSI) ставит на прочитанное метку чтения (SIRead, никого не
// держит); чужая вставка под метку — зависимость; цикл зависимостей — 40001 тому, кто коммитит вторым (при
// записи, если сосед уже закоммичен, иначе на COMMIT). Акт 2.3: счётчик booked в строке слота — UPDATE с условием,
// замок строки и перепроверка после ожидания (RC) или 40001 (RR), как остаток в эпизоде 05.
// Детерминирована: время — счётчик секунд, каждый оператор — секунда.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B";
export const ACTORS: ActorId[] = ["A", "B"];

export type Level = "RC" | "RR" | "SER";
export const LEVEL: Record<Level, string> = { RC: "READ COMMITTED", RR: "REPEATABLE READ", SER: "SERIALIZABLE" };

/** Сколько заказов курьер увозит за слот. */
export const CAP = 3;
/** Сколько заказов уже лежит в слоте в начале каждой сцены. */
export const BOOKED = 2;

/** Заказ слота. at — время коммита; null — ещё не закоммичен (его видит только автор). */
export interface Order {
  who: string; // имя покупателя
  by: ActorId | null; // null — заказ, оформленный до сцены
  at: number | null;
}

/** Версия строки слота (счётчик booked, акт 2.3). at — время коммита; null — не закоммичена и заперта. */
export interface SlotVersion {
  booked: number;
  by: ActorId | null;
  at: number | null;
}

export interface Tx {
  level: Level;
  snapshot: number | null; // видны коммиты не позже этого момента; null — оператора ещё не было
  read: number | null; // сколько заказов слота насчитал последний SELECT count(*)
  mark: boolean; // SERIALIZABLE: метка чтения на заказах слота (SIRead)
  waiting: boolean; // UPDATE строки слота ждёт чужого COMMIT
  doomed: boolean; // SSI: сосед закоммитил, кольцо замкнулось — следующая проверка даст 40001
}

/** Что под сделал в кадре — стрелки кадра. */
export type Act =
  | { kind: "count"; seen: number }
  | { kind: "insert" }
  | { kind: "write" }
  | { kind: "wait" }
  | { kind: "zero" }
  | { kind: "commit" }
  | { kind: "fail" };

export interface Actor {
  id: ActorId;
  label: string;
  tx: Tx | null;
  thought: string | null; // мысль-заблуждение пода
  crossed: string | null; // опровергнутая мысль (живёт кадр)
  failed: boolean; // получил 40001 — до повтора
  retried: boolean;
  acts: Act[];
}

/** Зависимость SSI: reader прочитал (метка), writer вставил под эту метку. */
export interface Dep {
  reader: ActorId;
  writer: ActorId;
}

export type Status = "idle" | "press" | "wait" | "ok" | "busy";
export interface Customer {
  name: string;
  pod: ActorId;
  status: Status;
}

export type Focus = ActorId | "orders" | "slot" | "courier" | "shop" | "board" | "sql" | "code" | "marks";

/** Код пода на Go в кадре: строки и подсвеченные места. */
export interface Code {
  title: string;
  lines: string[];
  mark: { line: number; tone: "warn" | "ok"; note?: string }[];
}

export type FailReason = "update" | "deps"; // 40001: concurrent update (строка слота) / read-write dependencies (SSI)

export type EventKind =
  | "press" | "count" | "insert" | "write" | "wait" | "zero" | "commit" | "fail" | "retry" | "ok" | "busy"
  // mark — метка чтения SSI; dep — чужая вставка попала под метку; doom — кольцо замкнулось, соседу ошибка впереди;
  // overload — у курьера коробок больше, чем он увезёт (тихая беда, как oversold в 05).
  | "mark" | "dep" | "doom" | "overload"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  by?: ActorId;
  lamps?: Verdict;
}

export interface World {
  clock: number;
  orders: Order[];
  slot: SlotVersion[]; // версии строки слота, старые первыми
  slotLockedBy: ActorId | null;
  deps: Dep[];
  /** Метки чтения закоммиченных SERIALIZABLE-транзакций: живут, пока жив их современник. */
  marks: Partial<Record<ActorId, boolean>>;
  actors: Record<ActorId, Actor>;
  customers: Customer[];
  /** Подача: колонка booked видна (акт 2.3); витрина со слотами; код; сверка условия UPDATE; ошибка 40001 пода. */
  counter: boolean;
  showcase: boolean;
  code: Code | null;
  check: { text: string; ok: boolean } | null;
  reason: Partial<Record<ActorId, FailReason>>;
  /** Курьер говорит о слоте (знакомство) — лимит крупно. */
  courierTalk: boolean;
  /** Второй критерий табло («без повтора») — с кадра, где голос называет цену. */
  costShown: boolean;
  /** Вставка эпизода 05 целиком: номер его кадра (рисует view.ts его же отрисовкой). */
  flashback: number | null;
  sql: string[];
  db: string | null;
  plate: string | null;
  chapter: number | null;
  board: Board | null;
  stamp: string | null;
  focus: Focus[] | null;
  term: string | null;
  events: SimEvent[];
  frame: number;
  scene: number;
  replay: boolean;
}

export function world(): World {
  const actor = (id: ActorId): Actor => ({ id, label: `Pod ${id}`, tx: null, thought: null, crossed: null, failed: false, retried: false, acts: [] });
  return {
    clock: 0,
    orders: [
      { who: "Вера", by: null, at: 0 },
      { who: "Глеб", by: null, at: 0 },
    ],
    slot: [{ booked: BOOKED, by: null, at: 0 }],
    slotLockedBy: null,
    deps: [],
    marks: {},
    actors: { A: actor("A"), B: actor("B") },
    customers: [
      { name: "Аня", pod: "A", status: "idle" },
      { name: "Борис", pod: "B", status: "idle" },
    ],
    counter: false,
    showcase: false,
    code: null,
    check: null,
    reason: {},
    courierTalk: false,
    costShown: false,
    flashback: null,
    sql: [],
    db: null,
    plate: null,
    chapter: null,
    board: null,
    stamp: null,
    focus: null,
    term: null,
    events: [],
    frame: 0,
    scene: 0,
    replay: false,
  };
}

function tx(w: World, who: ActorId): Tx {
  const t = w.actors[who].tx;
  if (!t) throw new Error(`${who}: транзакции нет`);
  return t;
}

/** Каждый оператор — секунда; снимок RC — на каждый оператор, RR и SERIALIZABLE — с первого. */
function statement(w: World, who: ActorId): Tx {
  const t = tx(w, who);
  w.clock++;
  if (t.level === "RC" || t.snapshot === null) t.snapshot = w.clock;
  return t;
}

/** Видит ли транзакция заказ: свой незакоммиченный или закоммиченный не позже снимка. */
export function sees(w: World, who: ActorId, o: Order): boolean {
  const t = w.actors[who].tx;
  if (o.at === null) return o.by === who;
  if (!t || t.snapshot === null) return true;
  return o.at <= t.snapshot;
}

export function begin(w: World, who: ActorId, level: Level): void {
  const a = w.actors[who];
  a.tx = { level, snapshot: null, read: null, mark: false, waiting: false, doomed: false };
  a.failed = false;
}

/** Обречённая транзакция SSI получает 40001 на ближайшем операторе. */
function doomCheck(w: World, who: ActorId): boolean {
  if (!tx(w, who).doomed) return false;
  fail(w, who, "deps");
  return true;
}

/** SELECT count(*) FROM orders WHERE slot_id = 7 — по снимку; на SERIALIZABLE ставит метку чтения. */
export function count(w: World, who: ActorId): number {
  if (doomCheck(w, who)) return -1;
  const t = statement(w, who);
  const n = w.orders.filter((o) => sees(w, who, o)).length;
  t.read = n;
  w.actors[who].acts.push({ kind: "count", seen: n });
  w.events.push({ kind: "count", by: who });
  if (t.level === "SER" && !t.mark) {
    t.mark = true;
    w.events.push({ kind: "mark", by: who });
  }
  return n;
}

/** Есть ли кольцо зависимостей между двумя подами. */
function ring(w: World, a: ActorId, b: ActorId): boolean {
  const has = (r: ActorId, wr: ActorId) => w.deps.some((d) => d.reader === r && d.writer === wr);
  return has(a, b) && has(b, a);
}

const other = (id: ActorId): ActorId => (id === "A" ? "B" : "A");

/** Закоммиченная SERIALIZABLE-транзакция соседа ещё держит метку (SIRead живут, пока жив кто-то из её современников). */
function committedMark(w: World, id: ActorId): boolean {
  return w.marks[id] === true;
}

/** INSERT INTO orders — своя новая строка. На SERIALIZABLE вставка под чужую метку — зависимость. */
export function insert(w: World, who: ActorId): boolean {
  if (doomCheck(w, who)) return false;
  const t = statement(w, who);
  const name = w.customers.find((c) => c.pod === who)!.name;
  w.orders.push({ who: name, by: who, at: null });
  w.actors[who].acts.push({ kind: "insert" });
  w.events.push({ kind: "insert", by: who });
  if (t.level !== "SER") return true;
  const o = other(who);
  const ot = w.actors[o].tx;
  if ((ot && ot.level === "SER" && ot.mark) || committedMark(w, o)) {
    w.deps.push({ reader: o, writer: who });
    w.events.push({ kind: "dep", by: who });
  }
  // Сосед уже закоммичен, а кольцо замкнулось — ошибка при записи (first committer wins).
  if (ring(w, who, o) && !w.actors[o].tx) {
    fail(w, who, "deps");
    return false;
  }
  return true;
}

/** Последняя закоммиченная версия строки слота. */
export function slotTop(w: World): number {
  for (let i = w.slot.length - 1; i >= 0; i--) if (w.slot[i].at !== null) return i;
  throw new Error("нет закоммиченной версии слота");
}

/** UPDATE slots SET booked = booked + 1 WHERE id = 7 AND booked < cap: строку держит сосед — ждём его COMMIT. */
export function bump(w: World, who: ActorId): "write" | "wait" | "zero" | "fail" {
  const t = statement(w, who);
  if (w.slotLockedBy && w.slotLockedBy !== who) {
    t.waiting = true;
    w.actors[who].acts.push({ kind: "wait" });
    w.events.push({ kind: "wait", by: who });
    return "wait";
  }
  return applyBump(w, who);
}

/** Замок строки слота освободился — UPDATE, который ждал, выполняется на свежей версии. */
export function resume(w: World, who: ActorId): "write" | "zero" | "fail" {
  const t = tx(w, who);
  if (!t.waiting || w.slotLockedBy) throw new Error(`${who}: ждать нечего или замок ещё занят`);
  t.waiting = false;
  return applyBump(w, who);
}

function applyBump(w: World, who: ActorId): "write" | "zero" | "fail" {
  const t = tx(w, who);
  const top = slotTop(w);
  // RR и SERIALIZABLE: строку после снимка изменил другой — 40001 (concurrent update), как остаток в 05.
  if (t.level !== "RC" && w.slot[top].at! > t.snapshot! && w.slotLockedBy !== who) {
    fail(w, who, "update");
    return "fail";
  }
  // RC: условие перепроверяется на последней версии.
  if (w.slot[top].booked >= CAP) {
    w.actors[who].acts.push({ kind: "zero" });
    w.events.push({ kind: "zero", by: who });
    return "zero";
  }
  w.slot.push({ booked: w.slot[top].booked + 1, by: who, at: null });
  w.slotLockedBy = who;
  w.actors[who].acts.push({ kind: "write" });
  w.events.push({ kind: "write", by: who });
  return "write";
}

/** COMMIT. SERIALIZABLE: предкоммитная проверка — обречённый падает, а если кольцо с живым соседом — сосед обречён. */
export function commit(w: World, who: ActorId): boolean {
  const t = tx(w, who);
  if (t.doomed) {
    fail(w, who, "deps");
    return false;
  }
  w.clock++;
  const o = other(who);
  const ot = w.actors[o].tx;
  if (t.level === "SER" && ot && ring(w, who, o)) {
    ot.doomed = true;
    w.events.push({ kind: "doom", by: o });
  }
  if (w.slotLockedBy === who) {
    w.slot[w.slot.length - 1].at = w.clock;
    w.slotLockedBy = null;
  }
  const before = overloaded(w);
  for (const x of w.orders) if (x.by === who && x.at === null) x.at = w.clock;
  if (t.level === "SER" && t.mark && ot) w.marks[who] = true; // метка переживает коммит, пока жив современник
  w.actors[who].tx = null;
  if (!ACTORS.some((id) => w.actors[id].tx)) w.marks = {};
  w.actors[who].acts.push({ kind: "commit" });
  w.events.push({ kind: "commit", by: who });
  if (!before && overloaded(w)) w.events.push({ kind: "overload", by: who });
  return true;
}

/** Откат: свои незакоммиченные заказы и версия слота исчезают, метка и зависимости снимаются. */
export function rollback(w: World, who: ActorId): void {
  if (w.slotLockedBy === who) {
    w.slot.pop();
    w.slotLockedBy = null;
  }
  w.orders = w.orders.filter((o) => o.by !== who || o.at !== null);
  w.deps = w.deps.filter((d) => d.reader !== who && d.writer !== who);
  w.actors[who].tx = null;
  if (!ACTORS.some((id) => w.actors[id].tx)) w.marks = {};
}

function fail(w: World, who: ActorId, reason: FailReason): void {
  rollback(w, who);
  w.reason[who] = reason;
  w.actors[who].failed = true;
  w.actors[who].acts.push({ kind: "fail" });
  w.events.push({ kind: "fail", by: who });
}

/** Повтор после 40001: та же транзакция с начала, со свежим снимком. */
export function retry(w: World, who: ActorId, level: Level): void {
  if (!w.actors[who].failed) throw new Error(`${who}: повторять нечего`);
  begin(w, who, level);
  w.actors[who].retried = true;
  delete w.reason[who];
  w.events.push({ kind: "retry", by: who });
}

/** Коробок у курьера: закоммиченные заказы слота. */
export function boxes(w: World): number {
  return w.orders.filter((o) => o.at !== null).length;
}

/** Курьер перегружен: закоммиченных заказов больше, чем он увозит. */
export function overloaded(w: World): boolean {
  return boxes(w) > CAP;
}

/** Кому-то пришлось повторить транзакцию. */
export function retried(w: World): boolean {
  return ACTORS.some((id) => w.actors[id].retried || w.actors[id].failed);
}
