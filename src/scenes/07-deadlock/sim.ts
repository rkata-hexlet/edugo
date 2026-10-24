// Мини-модель Postgres для заказа из нескольких товаров: каждая позиция корзины — атомарный UPDATE строки products
// (stock = stock - 1 WHERE id = $1 AND stock > 0). Запись запирает строку до COMMIT; чужая запись в запертую строку
// ждёт. Две корзины в разном порядке — цикл ожидания (deadlock): каждый держит строку, которую ждёт другой.
// Детектор Postgres срабатывает через deadlock_timeout у того, кто ждёт дольше (начал ждать первым), и прерывает
// его транзакцию с 40P01. Замки строк одинаковы на любом уровне изоляции; после ожидания READ COMMITTED перепроверяет
// условие на свежей версии, SERIALIZABLE отказывает 40001, если строку после снимка изменил другой.
// Детерминирована: время — счётчик операторов.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B";
export const ACTORS: ActorId[] = ["A", "B"];

export type Level = "RC" | "SER";

export const TEAPOT = 3;
export const MUG = 7;
/** Остаток каждого товара в начале сцены: склад большой, нехватки не будет. */
export const STOCK = 10;

/** Строка products. draft — незакоммиченная запись под замком её автора. at — время последнего коммита. */
export interface Product {
  id: number;
  name: string;
  stock: number;
  at: number;
  draft: { stock: number; by: ActorId } | null;
}

export interface Order {
  who: string;
  by: ActorId;
  at: number | null; // null — не закоммичен
}

export interface Tx {
  level: Level;
  snapshot: number; // SERIALIZABLE: коммиты позже снимка — чужие изменения (в Postgres снимок — на первом запросе; здесь на BEGIN, разницы в кадре нет)
  waiting: number | null; // id строки, чьего замка ждёт UPDATE
  since: number | null; // когда начал ждать — детектор срабатывает у того, кто ждёт дольше
}

/** Что под сделал в кадре — стрелки кадра. */
export type Act = { kind: "write"; id: number } | { kind: "commit" } | { kind: "fail"; undone: number[] };

export interface Actor {
  id: ActorId;
  label: string;
  tx: Tx | null;
  /** Порядок, в котором код пода идёт по корзине, и сколько позиций уже списано. */
  plan: number[];
  pos: number;
  thought: string | null; // мысль-заблуждение пода
  crossed: string | null; // опровергнутая мысль (живёт кадр)
  failed: boolean; // получил 40P01 — до повтора
  retried: boolean;
  acts: Act[];
}

export type Status = "idle" | "press" | "wait" | "ok" | "fail";
export interface Customer {
  name: string;
  pod: ActorId;
  cart: number[]; // в каком порядке покупатель положил товары
  status: Status;
}

export type Focus = ActorId | "products" | "orders" | "shop" | "board" | "sql" | "code" | "db";

/** Код пода на Go в кадре: строки и подсвеченные места. */
export interface Code {
  title: string;
  lines: string[];
  mark: { line: number; tone: "warn" | "ok"; note?: string }[];
}

/** Вставки поверх сцены: распродажа, кольцо под вопросом (одним запросом), пути с замками, 40P01 против 40001. */
export type Aside = "sale" | "paths" | "codes" | "any";

export type FailReason = "deadlock" | "serialize"; // 40P01 / 40001

export type EventKind =
  | "press" | "write" | "wait" | "resume" | "zero" | "commit" | "fail" | "retry" | "ok" | "refused"
  // ring — ожидание замкнуло цикл; tick — секундомер deadlock_timeout; detect — детектор нашёл цикл.
  | "ring" | "tick" | "detect"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  by?: ActorId;
  lamps?: Verdict;
}

export interface World {
  clock: number;
  products: Product[];
  orders: Order[];
  actors: Record<ActorId, Actor>;
  customers: Customer[];
  reason: Partial<Record<ActorId, FailReason>>;
  /** Подача: секундомер deadlock_timeout, с; код; вставка; сверка условия у пода B; кадр эпизода 05 во вставке. */
  stopwatch: number | null;
  code: Code | null;
  aside: Aside | null;
  check: { text: string; ok: boolean } | null;
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
  const actor = (id: ActorId, plan: number[]): Actor => ({
    id, label: `Pod ${id}`, tx: null, plan, pos: 0, thought: null, crossed: null, failed: false, retried: false, acts: [],
  });
  return {
    clock: 0,
    products: [
      { id: TEAPOT, name: "Чайник", stock: STOCK, at: 0, draft: null },
      { id: MUG, name: "Кружка", stock: STOCK, at: 0, draft: null },
    ],
    orders: [],
    actors: { A: actor("A", [MUG, TEAPOT]), B: actor("B", [TEAPOT, MUG]) },
    customers: [
      { name: "Аня", pod: "A", cart: [MUG, TEAPOT], status: "idle" },
      { name: "Борис", pod: "B", cart: [TEAPOT, MUG], status: "idle" },
    ],
    reason: {},
    stopwatch: null,
    code: null,
    aside: null,
    check: null,
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

export const other = (id: ActorId): ActorId => (id === "A" ? "B" : "A");

export function product(w: World, id: number): Product {
  const p = w.products.find((x) => x.id === id);
  if (!p) throw new Error(`нет товара ${id}`);
  return p;
}

function tx(w: World, who: ActorId): Tx {
  const t = w.actors[who].tx;
  if (!t) throw new Error(`${who}: транзакции нет`);
  return t;
}

/** Кто держит замок строки (незакоммиченная запись). */
export function holder(w: World, id: number): ActorId | null {
  return product(w, id).draft?.by ?? null;
}

/** Строки, которые под держит запертыми. */
export function held(w: World, who: ActorId): number[] {
  return w.products.filter((p) => p.draft?.by === who).map((p) => p.id);
}

export function begin(w: World, who: ActorId, level: Level): void {
  const a = w.actors[who];
  w.clock++;
  a.tx = { level, snapshot: w.clock, waiting: null, since: null };
  a.pos = 0;
  a.failed = false;
}

/** Цикл ожидания: каждый ждёт строку, которую держит другой. */
export function deadlocked(w: World): boolean {
  return ACTORS.every((id) => {
    const t = w.actors[id].tx;
    return !!t && t.waiting !== null && holder(w, t.waiting) === other(id);
  });
}

/**
 * UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0 — следующая позиция плана пода.
 * Строку держит сосед — ждём его COMMIT или отката.
 */
export function take(w: World, who: ActorId): "write" | "wait" | "zero" | "fail" {
  const a = w.actors[who];
  const t = tx(w, who);
  const id = a.plan[a.pos];
  w.clock++;
  const h = holder(w, id);
  if (h && h !== who) {
    t.waiting = id;
    t.since = w.clock;
    w.events.push({ kind: "wait", by: who });
    if (deadlocked(w)) w.events.push({ kind: "ring", by: who });
    return "wait";
  }
  return apply(w, who, id);
}

/** Замок освободился — UPDATE, который ждал, выполняется на свежей версии строки. */
export function resume(w: World, who: ActorId): "write" | "zero" | "fail" {
  const t = tx(w, who);
  if (t.waiting === null || holder(w, t.waiting)) throw new Error(`${who}: ждать нечего или замок ещё занят`);
  const id = t.waiting;
  t.waiting = null;
  t.since = null;
  w.events.push({ kind: "resume", by: who });
  return apply(w, who, id);
}

function apply(w: World, who: ActorId, id: number): "write" | "zero" | "fail" {
  const t = tx(w, who);
  const p = product(w, id);
  // SERIALIZABLE: строку после снимка изменил другой — 40001 (concurrent update).
  if (t.level === "SER" && !p.draft && p.at > t.snapshot) {
    fail(w, who, "serialize");
    return "fail";
  }
  // READ COMMITTED: условие перепроверяется на последней версии.
  const stock = p.draft?.stock ?? p.stock;
  if (stock <= 0) {
    w.events.push({ kind: "zero", by: who });
    return "zero";
  }
  p.draft = { stock: stock - 1, by: who };
  w.actors[who].pos++;
  w.actors[who].acts.push({ kind: "write", id });
  w.events.push({ kind: "write", by: who });
  return "write";
}

/**
 * Детектор deadlock: через deadlock_timeout проверку запускает тот, кто ждёт дольше; нашёл цикл — прерывает свою
 * транзакцию (40P01). Возвращает прерванного или null, если цикла нет.
 */
export function detect(w: World): ActorId | null {
  if (!deadlocked(w)) return null;
  const victim = [...ACTORS].sort((x, y) => tx(w, x).since! - tx(w, y).since!)[0];
  w.events.push({ kind: "detect", by: victim });
  fail(w, victim, "deadlock");
  return victim;
}

/** INSERT INTO orders — заказ после всех позиций. */
export function place(w: World, who: ActorId, name: string): void {
  tx(w, who);
  w.clock++;
  w.orders.push({ who: name, by: who, at: null });
}

/** COMMIT: записи становятся видны всем, замки снимаются. */
export function commit(w: World, who: ActorId): void {
  tx(w, who);
  w.clock++;
  for (const p of w.products) {
    if (p.draft?.by !== who) continue;
    p.stock = p.draft.stock;
    p.at = w.clock;
    p.draft = null;
  }
  for (const o of w.orders) if (o.by === who && o.at === null) o.at = w.clock;
  w.actors[who].tx = null;
  w.actors[who].acts.push({ kind: "commit" });
  w.events.push({ kind: "commit", by: who });
}

/** Откат: свои записи исчезают, остатки возвращаются, замки снимаются. */
export function rollback(w: World, who: ActorId): void {
  for (const p of w.products) if (p.draft?.by === who) p.draft = null;
  w.orders = w.orders.filter((o) => o.by !== who || o.at !== null);
  w.actors[who].tx = null;
}

function fail(w: World, who: ActorId, reason: FailReason): void {
  const undone = held(w, who);
  rollback(w, who);
  w.reason[who] = reason;
  w.actors[who].failed = true;
  w.actors[who].acts.push({ kind: "fail", undone });
  w.events.push({ kind: "fail", by: who });
}

/** Повтор после 40P01 нашим кодом: та же транзакция с начала. */
export function retry(w: World, who: ActorId, level: Level): void {
  if (!w.actors[who].failed) throw new Error(`${who}: повторять нечего`);
  begin(w, who, level);
  w.actors[who].retried = true;
  delete w.reason[who];
  w.events.push({ kind: "retry", by: who });
}

/** Оба заказа приняты: у каждого покупателя закоммичен заказ. */
export function accepted(w: World): boolean {
  return ACTORS.every((id) => w.orders.some((o) => o.by === id && o.at !== null));
}

/** Кому-то пришлось повторить транзакцию. */
export function retried(w: World): boolean {
  return ACTORS.some((id) => w.actors[id].retried);
}
