// Мини-модель Postgres для одной строки товара: MVCC — UPDATE не правит строку на месте, а создаёт новую
// версию; незакоммиченную версию держит замок, чужой UPDATE ждёт COMMIT. Что видит транзакция — снимок:
// на READ COMMITTED новый на каждый оператор, на REPEATABLE READ — с первого оператора до конца транзакции.
// После ожидания замка RC перепроверяет условие UPDATE на свежей версии, а RR отказывает (40001), если
// строку после его снимка изменил другой. Детерминирована: время — счётчик секунд, каждый оператор — секунда.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B";
export const ACTORS: ActorId[] = ["A", "B"];

export type Level = "RC" | "RR";
export const LEVEL: Record<Level, string> = { RC: "READ COMMITTED", RR: "REPEATABLE READ" };

/** Сколько кружек было на складе в начале каждой сцены. */
export const STOCK = 1;

/** Версия строки товара. at — время коммита; null — ещё не закоммичена (её видит только автор). */
export interface Version {
  stock: number;
  by: ActorId | null; // null — исходная строка
  at: number | null;
}

export interface Order {
  by: ActorId;
  committed: boolean;
}

/** UPDATE, который ждёт замка: записать готовое число или уменьшить на единицу, если больше нуля. */
export type Write = { kind: "set"; value: number } | { kind: "dec" };

export interface Tx {
  level: Level;
  /** Снимок: видны коммиты не позже этого момента; null — оператора ещё не было. */
  snapshot: number | null;
  /** Что транзакция прочитала последним SELECT. */
  read: number | null;
  waiting: Write | null;
}

/** Что под сделал в этом кадре — стрелки кадра. */
export type Act =
  | { kind: "read"; version: number }
  | { kind: "write"; version: number }
  | { kind: "wait" }
  | { kind: "zero" }
  | { kind: "insert" }
  | { kind: "commit" }
  | { kind: "fail" };

export interface Actor {
  id: ActorId;
  label: string;
  tx: Tx | null;
  thought: string | null; // мысль пода — пока она его заблуждение
  crossed: string | null; // мысль, которую только что опровергли (живёт кадр)
  /** Последний снимок транзакции — держится и после отката, до нового BEGIN (линия снимка в кадре 40001). */
  seen: number | null;
  failed: boolean; // получил 40001 — до повтора
  retried: boolean; // транзакция начата заново после 40001
  acts: Act[];
}

/** Покупатель на витрине. Аня — у пода A, Борис — у пода B. */
export type Status = "idle" | "press" | "wait" | "ok" | "none";
export interface Customer {
  name: string;
  pod: ActorId;
  status: Status;
}

export type Focus = ActorId | "row" | "orders" | "shop" | "board" | "clock" | "sql" | "ladder" | "code";

/** Код пода на Go в кадре: строки и подсвеченные места (warn — где беда, ok — что поправили). */
export interface Code {
  title: string;
  lines: string[];
  mark: { line: number; tone: "warn" | "ok" }[];
}

export type EventKind =
  | "press" | "read" | "write" | "wait" | "zero" | "insert" | "commit" | "fail" | "retry" | "ok" | "none"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  by?: ActorId;
  lamps?: Verdict;
}

export interface World {
  clock: number;
  versions: Version[]; // старые первыми
  lockedBy: ActorId | null;
  orders: Order[];
  actors: Record<ActorId, Actor>;
  customers: Customer[];
  /** Подача: стопка версий строки (с 1.1), часы БД и снимки (с REPEATABLE READ), витрина, вставка эпизода 01. */
  stack: boolean;
  clockShown: boolean;
  showcase: boolean;
  flashback: boolean;
  ladder: boolean; // лесенка четырёх уровней изоляции Postgres
  code: Code | null;
  /** Чью линию снимка рисуем (одна линия — learning-designer); null — никакую. */
  horizon: ActorId | null;
  /** Сверка условия UPDATE после ожидания: что проверила база и прошло ли. */
  check: { text: string; ok: boolean } | null;
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
  const actor = (id: ActorId): Actor => ({ id, label: `Pod ${id}`, tx: null, thought: null, crossed: null, seen: null, failed: false, retried: false, acts: [] });
  return {
    clock: 0,
    versions: [{ stock: STOCK, by: null, at: 0 }],
    lockedBy: null,
    orders: [],
    actors: { A: actor("A"), B: actor("B") },
    customers: [
      { name: "Аня", pod: "A", status: "idle" },
      { name: "Борис", pod: "B", status: "idle" },
    ],
    stack: false,
    clockShown: false,
    showcase: false,
    flashback: false,
    ladder: false,
    code: null,
    horizon: null,
    check: null,
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

/** Последняя закоммиченная версия — её номер. */
export function latest(w: World): number {
  for (let i = w.versions.length - 1; i >= 0; i--) if (w.versions[i].at !== null) return i;
  throw new Error("нет закоммиченной версии");
}

/** Какую версию видит транзакция: свою незакоммиченную или последнюю закоммиченную не позже снимка. */
export function visible(w: World, who: ActorId): number {
  const tx = w.actors[who].tx;
  if (!tx || tx.snapshot === null) throw new Error(`${who}: снимка нет`);
  for (let i = w.versions.length - 1; i >= 0; i--) {
    const v = w.versions[i];
    if (v.at === null ? v.by === who : v.at <= tx.snapshot) return i;
  }
  throw new Error(`${who}: ничего не видно`);
}

function tx(w: World, who: ActorId): Tx {
  const t = w.actors[who].tx;
  if (!t) throw new Error(`${who}: транзакции нет`);
  return t;
}

/** Каждый оператор занимает секунду; снимок RC — на каждый оператор, RR — с первого. */
function statement(w: World, who: ActorId): Tx {
  const t = tx(w, who);
  w.clock++;
  if (t.level === "RC" || t.snapshot === null) t.snapshot = w.clock;
  w.actors[who].seen = t.snapshot;
  return t;
}

export function begin(w: World, who: ActorId, level: Level = "RC"): void {
  const a = w.actors[who];
  a.tx = { level, snapshot: null, read: null, waiting: null };
  a.failed = false;
  a.seen = null;
}

/** SELECT stock: число из видимой версии. */
export function read(w: World, who: ActorId): number {
  const t = statement(w, who);
  const i = visible(w, who);
  t.read = w.versions[i].stock;
  w.actors[who].acts.push({ kind: "read", version: i });
  w.events.push({ kind: "read", by: who });
  return t.read;
}

export type Outcome = "wait" | "write" | "zero" | "fail";

/** UPDATE: строку держит чужая транзакция — ждём её COMMIT (resume), иначе выполняем сразу. */
export function write(w: World, who: ActorId, op: Write): Outcome {
  const t = statement(w, who);
  if (w.lockedBy && w.lockedBy !== who) {
    t.waiting = op;
    w.actors[who].acts.push({ kind: "wait" });
    w.events.push({ kind: "wait", by: who });
    return "wait";
  }
  return apply(w, who, op);
}

/** Замок освободился: UPDATE, который ждал, выполняется на свежей версии строки. */
export function resume(w: World, who: ActorId): Outcome {
  const t = tx(w, who);
  if (!t.waiting || w.lockedBy) throw new Error(`${who}: ждать нечего или замок ещё занят`);
  const op = t.waiting;
  t.waiting = null;
  return apply(w, who, op);
}

function apply(w: World, who: ActorId, op: Write): Outcome {
  const t = tx(w, who);
  const top = latest(w);
  // RR: строку после снимка изменил другой — решение принято по устаревшим данным, 40001.
  if (t.level === "RR" && w.versions[top].at! > t.snapshot! && w.lockedBy !== who) {
    fail(w, who);
    return "fail";
  }
  const own = w.lockedBy === who ? w.versions.length - 1 : null;
  const current = w.versions[own ?? top].stock;
  // RC: условие UPDATE перепроверяется на последней версии. В «set» условие только id — оно всегда верно.
  if (op.kind === "dec" && current <= 0) {
    w.actors[who].acts.push({ kind: "zero" });
    w.events.push({ kind: "zero", by: who });
    return "zero";
  }
  const stock = op.kind === "set" ? op.value : current - 1;
  if (own !== null) w.versions[own].stock = stock;
  else w.versions.push({ stock, by: who, at: null });
  w.lockedBy = who;
  w.actors[who].acts.push({ kind: "write", version: w.versions.length - 1 });
  w.events.push({ kind: "write", by: who });
  return "write";
}

export function insert(w: World, who: ActorId): void {
  statement(w, who);
  w.orders.push({ by: who, committed: false });
  w.actors[who].acts.push({ kind: "insert" });
  w.events.push({ kind: "insert", by: who });
}

export function commit(w: World, who: ActorId): void {
  tx(w, who);
  w.clock++;
  if (w.lockedBy === who) {
    w.versions[w.versions.length - 1].at = w.clock;
    w.lockedBy = null;
  }
  for (const o of w.orders) if (o.by === who) o.committed = true;
  w.actors[who].tx = null;
  w.actors[who].acts.push({ kind: "commit" });
  w.events.push({ kind: "commit", by: who });
}

/** Откат: своя незакоммиченная версия и заказы исчезают, замок снят. */
export function rollback(w: World, who: ActorId): void {
  if (w.lockedBy === who) {
    w.versions.pop();
    w.lockedBy = null;
  }
  w.orders = w.orders.filter((o) => o.by !== who || o.committed);
  w.actors[who].tx = null;
}

/** Ошибка сериализации 40001: транзакция откатывается целиком, её надо начать заново. */
function fail(w: World, who: ActorId): void {
  rollback(w, who);
  w.actors[who].failed = true;
  w.actors[who].acts.push({ kind: "fail" });
  w.events.push({ kind: "fail", by: who });
}

/** Повтор после 40001: та же транзакция с начала, со свежим снимком. */
export function retry(w: World, who: ActorId, level: Level): void {
  if (!w.actors[who].failed) throw new Error(`${who}: повторять нечего`);
  begin(w, who, level);
  w.actors[who].retried = true;
  w.events.push({ kind: "retry", by: who });
}

/** Продано больше, чем было: закоммиченных заказов больше начального остатка. */
export function oversold(w: World): boolean {
  return w.orders.filter((o) => o.committed).length > STOCK;
}

/** Кому-то пришлось повторить транзакцию. */
export function retried(w: World): boolean {
  return ACTORS.some((id) => w.actors[id].retried || w.actors[id].failed);
}
