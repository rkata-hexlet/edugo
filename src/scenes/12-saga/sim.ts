// Мини-модель саги: бронь живёт в трёх местах — строка в нашей базе (Postgres), деньги у платёжного шлюза, номер у
// поставщика. Общей транзакции нет: каждый вызов сразу делает дело. Поды ведут шаги по одному; исправление — новый шаг
// (возврат, снятие холда, отмена брони), а не откат. С ключом (`keyed`) шлюз и поставщик узнают повтор; с журналом
// (`journal`) ход саги лежит строкой в базе и переживает под. Время не нужно: порядок кадров и есть порядок шагов.

import type { Code } from "../../kit/code";
import type { Board, Verdict } from "../../kit/director";

export type PodId = "A" | "B" | "C";
export const PODS: PodId[] = ["A", "B", "C"];

/** Номер брони у нас — он же ключ в каждом вызове. */
export const BOOKING = "H-7731";
/** Первый номер брони у поставщика. */
export const REF0 = 1042;
export const PRICE = "12 400 ₽";

export type Status = "pending" | "confirmed" | "cancelled";

/** Куда под ходил в кадре: стрелки кадра. */
export type Target = "db" | "gateway" | "supplier" | "guest";
export type Op =
  | "insert" | "charge" | "hold" | "capture" | "release" | "refund" | "book" | "settle" | "log" | "claim" | "skip" | "reply";
/** Вызов пода; ok = false — отказ или нет ответа (таймаут). */
export interface Act {
  op: Op;
  to: Target;
  ok: boolean;
}

export interface Pod {
  id: PodId;
  acts: Act[];
  down: boolean;
  /** Сколько шагов помнит горутина саги в памяти пода; null — горутины нет. */
  memory: number | null;
}

/** Строка выписки в банке гостя. */
export type Line = "charge" | "refund";

export interface Gateway {
  statement: Line[];
  frozen: boolean;
  /** Ключи уже выполненных вызовов: «hold:H-7731». */
  keys: string[];
  /** Сколько следующих вызовов не дождутся ответа. */
  failNext: number;
  say: string | null;
}

export interface SupplierBooking {
  ref: string;
  key: string | null;
  cancelled: boolean;
}

export interface Supplier {
  free: number;
  bookings: SupplierBooking[];
  /** Следующий вызов брони сделает дело, но ответ не дойдёт (таймаут). */
  slow: boolean;
  say: string | null;
}

/** Шаги саги в журнале. */
export type SagaStep = "старт" | "холд" | "бронь" | "списание";
export const SAGA_STEPS: SagaStep[] = ["старт", "холд", "бронь", "списание"];
/**
 * Состояние шага в журнале: начат (записали перед вызовом), сделан (после ответа), отказ (ответ окончательный);
 * отмена и отменён — компенсация шага, её журнал помнит так же, как сам шаг.
 */
export type LogState = "начат" | "сделан" | "отказ" | "отмена" | "отменён";
export interface LogEntry {
  step: SagaStep;
  state: LogState;
}

export interface Saga {
  entries: LogEntry[];
  owner: PodId | null;
}

export type Site = "idle" | "wait" | "error" | "ok";

export interface Guest {
  site: Site;
  pressed: boolean;
  thought: string | null;
}

/** Цепочка шагов внизу кадра: пары «шаг → обратный шаг» или порядок холд → бронь → списание с точкой невозврата. */
export type Chain = "pairs" | "pivot";
/** Вилка решения пода после сбоя: временный → вперёд, окончательный → исправить, исправление → повторять. */
export type Fork = "forward" | "fix" | "retry";

export type Focus = PodId | "guest" | "db" | "gateway" | "supplier" | "log" | "board" | "chain" | "fork" | "code";

export type EventKind =
  | "press" | "insert" | "charge" | "hold" | "capture" | "release" | "refund" | "book" | "full" | "dup" | "same"
  | "timeout" | "confirm" | "cancel" | "error" | "crash" | "log" | "claim" | "skip" | "split"
  | "page" | "rewind" | "verdict" | "card";

export interface SimEvent {
  kind: EventKind;
  by?: PodId;
  lamps?: Verdict;
}

export interface World {
  booking: { id: string; status: Status } | null;
  gateway: Gateway;
  supplier: Supplier;
  saga: Saga | null;
  pods: Record<PodId, Pod>;
  guest: Guest;
  /** Ключ идемпотентности в каждом вызове. */
  keyed: boolean;
  /** Ещё не показанные зрителю части мира (знакомство вводит их по одной). */
  unseen: ("gateway" | "supplier")[];
  /** Кадр «одна транзакция на троих» — рамка рвётся. */
  split: boolean;
  chain: Chain | null;
  fork: Fork | null;
  code: Code | null;
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

const pod = (id: PodId): Pod => ({ id, acts: [], down: false, memory: null });

export function world(): World {
  return {
    booking: null,
    gateway: { statement: [], frozen: false, keys: [], failNext: 0, say: null },
    supplier: { free: 3, bookings: [], slow: false, say: null },
    saga: null,
    pods: { A: pod("A"), B: pod("B"), C: pod("C") },
    guest: { site: "idle", pressed: false, thought: null },
    keyed: false,
    unseen: [],
    split: false,
    chain: null,
    fork: null,
    code: null,
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

const act = (w: World, by: PodId, op: Op, to: Target, ok = true) => w.pods[by].acts.push({ op, to, ok });
const emit = (w: World, kind: EventKind, by?: PodId) => w.events.push(by ? { kind, by } : { kind });

/** Горутина пода помнит ещё один сделанный шаг. */
function remember(w: World, by: PodId): void {
  const p = w.pods[by];
  if (p.memory !== null) p.memory++;
}

/** Повтор вызова к шлюзу с тем же ключом: шлюз узнаёт и ничего не меняет. */
function seen(w: World, by: PodId, op: string): boolean {
  if (!w.keyed) return false;
  const key = `${op}:${BOOKING}`;
  if (!w.gateway.keys.includes(key)) {
    w.gateway.keys.push(key);
    return false;
  }
  emit(w, "same", by);
  return true;
}

// --- Шаги саги: вызов пода `by` к своей базе, шлюзу, поставщику. ---

/** Гость жмёт «Забронировать», сайт крутит «Оформляем…». */
export function press(w: World): void {
  w.guest.pressed = true;
  w.guest.site = "wait";
  emit(w, "press");
}

/** Строка брони `pending` в нашей базе. */
export function insert(w: World, by: PodId): void {
  w.booking = { id: BOOKING, status: "pending" };
  act(w, by, "insert", "db");
  emit(w, "insert", by);
  remember(w, by);
}

/** Списание сразу (без холда): строка «−12 400 ₽» в выписке. */
export function charge(w: World, by: PodId): void {
  act(w, by, "charge", "gateway");
  if (seen(w, by, "charge")) return;
  w.gateway.statement.push("charge");
  emit(w, "charge", by);
  remember(w, by);
}

/** Холд: деньги заморожены на карте гостя, к нам не ушли. */
export function hold(w: World, by: PodId): void {
  act(w, by, "hold", "gateway");
  if (seen(w, by, "hold")) return;
  w.gateway.frozen = true;
  emit(w, "hold", by);
  remember(w, by);
}

/** Подтвердить холд — списать замороженное (capture). */
export function capture(w: World, by: PodId): void {
  act(w, by, "capture", "gateway");
  if (seen(w, by, "capture")) return;
  w.gateway.frozen = false;
  w.gateway.statement.push("charge");
  emit(w, "capture", by);
  remember(w, by);
}

/** Снять холд; шлюз может не ответить — тогда холд висит, вызов надо повторить. */
export function release(w: World, by: PodId): boolean {
  if (w.gateway.failNext > 0) {
    w.gateway.failNext--;
    act(w, by, "release", "gateway", false);
    emit(w, "timeout", by);
    return false;
  }
  act(w, by, "release", "gateway");
  if (seen(w, by, "release")) return true;
  w.gateway.frozen = false;
  emit(w, "release", by);
  return true;
}

/** Возврат: новая строка «+12 400 ₽» в выписке; списание остаётся. */
export function refund(w: World, by: PodId): void {
  act(w, by, "refund", "gateway");
  if (seen(w, by, "refund")) return;
  w.gateway.statement.push("refund");
  emit(w, "refund", by);
}

/** Действующие брони у поставщика. */
export const active = (w: World) => w.supplier.bookings.filter((b) => !b.cancelled);

/**
 * Бронь у поставщика. Мест нет — окончательный отказ. С ключом поставщик узнаёт повтор и возвращает прежнюю бронь.
 * `slow` — бронь создана, но ответ не дошёл: исход для пода неизвестен.
 */
export function book(w: World, by: PodId): "ok" | "full" | "timeout" {
  const s = w.supplier;
  const mine = w.keyed ? active(w).find((b) => b.key === BOOKING) : undefined;
  if (mine) {
    act(w, by, "book", "supplier");
    emit(w, "same", by);
    remember(w, by);
    return "ok";
  }
  if (s.free === 0) {
    act(w, by, "book", "supplier", false);
    emit(w, "full", by);
    return "full";
  }
  s.free--;
  s.bookings.push({ ref: `R-${REF0 + s.bookings.length}`, key: w.keyed ? BOOKING : null, cancelled: false });
  emit(w, active(w).length > 1 ? "dup" : "book", by);
  if (s.slow) {
    s.slow = false;
    act(w, by, "book", "supplier", false);
    emit(w, "timeout", by);
    return "timeout";
  }
  act(w, by, "book", "supplier");
  remember(w, by);
  return "ok";
}

/** Итог в нашей базе и ответ гостю. */
export function settle(w: World, by: PodId, status: "confirmed" | "cancelled"): void {
  w.booking!.status = status;
  act(w, by, "settle", "db");
  emit(w, status === "confirmed" ? "confirm" : "cancel", by);
  reply(w, by, status === "confirmed");
}

/** Под отвечает гостю: бронь есть или ошибка. */
export function reply(w: World, by: PodId, ok: boolean): void {
  w.guest.site = ok ? "ok" : "error";
  act(w, by, "reply", "guest", ok);
  if (!ok) emit(w, "error", by);
}

/** Под убит (SIGTERM при выкатке): горутина и её память пропадают. */
export function crash(w: World, by: PodId): void {
  const p = w.pods[by];
  p.down = true;
  p.memory = null;
  emit(w, "crash", by);
}

/** Горутина саги в поде: память шагов пустая. */
export function spawn(w: World, by: PodId): void {
  w.pods[by].memory = 0;
}

// --- Журнал саги (saga log) в Postgres. ---

/** Завести журнал: строка саги в базе. */
export function openLog(w: World, owner: PodId): void {
  w.saga = { entries: [], owner };
}

/** Записать в журнал состояние шага. */
export function log(w: World, by: PodId, step: SagaStep, state: LogState): void {
  const s = w.saga!;
  const e = s.entries.find((x) => x.step === step);
  if (e) e.state = state;
  else s.entries.push({ step, state });
  act(w, by, "log", "db");
  emit(w, "log", by);
}

/** Шаг с записью в журнал до и после. Под может умереть между вызовом и записью «сделан» — `dieAfterCall`. */
export function logged(w: World, by: PodId, step: SagaStep, call: () => unknown, dieAfterCall = false): void {
  log(w, by, step, "начат");
  call();
  if (dieAfterCall) return crash(w, by);
  log(w, by, step, "сделан");
}

/** Под захватывает застрявшую сагу (FOR UPDATE SKIP LOCKED); второй — пропускает занятую строку. */
export function claim(w: World, by: PodId): void {
  w.saga!.owner = by;
  act(w, by, "claim", "db");
  emit(w, "claim", by);
}

export function skip(w: World, by: PodId): void {
  act(w, by, "skip", "db", false);
  emit(w, "skip", by);
}

/** Какой шаг журнал считает следующим: первый не сделанный. */
export function nextStep(w: World): SagaStep | null {
  return SAGA_STEPS.find((step) => w.saga!.entries.find((e) => e.step === step)?.state !== "сделан") ?? null;
}

// --- Лампы табло: по ним тест сверяет оценки кадров. ---

/** Чистая сумма списаний гостя: списания минус возвраты. */
export const net = (w: World) => w.gateway.statement.filter((l) => l === "charge").length - w.gateway.statement.filter((l) => l === "refund").length;

/** Кейс 1, «при своих»: нет списания без брони у поставщика. */
export function evenLamp(w: World): "red" | "green" {
  return net(w) > 0 && active(w).length === 0 ? "red" : "green";
}

/** Кейс 1, «без возврата»: в выписке нет строки возврата. */
export function noRefundLamp(w: World): "red" | "green" {
  return w.gateway.statement.includes("refund") ? "red" : "green";
}

/** Кейс 2, «дошла до конца»: бронь в нашей базе не висит в pending. */
export function doneLamp(w: World): "red" | "green" {
  return w.booking && w.booking.status !== "pending" ? "green" : "red";
}

/** Кейс 2, «одна бронь»: у поставщика не больше одной брони на наш номер. */
export function onceLamp(w: World): "red" | "green" {
  return active(w).length <= 1 ? "green" : "red";
}
