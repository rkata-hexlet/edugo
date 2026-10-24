// Мини-модель оплаты: приложение Иры шлёт запрос на под, под зовёт банк (внешний эффект, таблица его не видит) и пишет
// платёж в Postgres. Ключ идемпотентности — строка idempotency_keys с UNIQUE: вставка второго такого же ключа даёт
// 0 строк (ON CONFLICT DO NOTHING), решение «это повтор» принимает под. Захват ключа коммитится до банка; результат
// (платёж, done, ответ) — одной транзакцией. Срок захвата (locked_until) даёт перехват брошенного ключа; банк, получивший
// тот же ключ, не списывает второй раз, а возвращает прежний результат.
// Детерминирована: время — счётчик секунд, который двигает сценарий.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B";
export const ACTORS: ActorId[] = ["A", "B"];

export const ORDER = 7;
export const AMOUNT = 990;
export const BALANCE = 5000;
/** Срок захвата ключа, с. */
export const LEASE = 30;

/** Платёж в таблице payments. */
export interface Payment {
  order: number;
  amount: number;
  by: ActorId;
}

export type KeyStatus = "processing" | "done";

/** Строка idempotency_keys. response — сохранённый ответ; lockedUntil — срок захвата (кейс 2). */
export interface KeyRow {
  key: string;
  status: KeyStatus;
  response: string | null;
  lockedUntil: number | null;
  by: ActorId;
}

/** Списание в журнале банка. key — ключ, переданный банку; attempt — ключ попытки в приложении (по нему тест считает дубли). */
export interface Charge {
  order: number;
  amount: number;
  key: string | null;
  attempt: string | null;
  by: ActorId;
}

/** Что видит Ира на экране. */
export type Screen = "buy" | "spin" | "error" | "paid" | "used" | "busy";

export interface Phone {
  screen: Screen;
  balance: number;
  key: string | null; // ключ текущей попытки оплаты
  tunnel: boolean; // связи нет: ответ до телефона не дойдёт
  thought: string | null;
}

/** Что под сделал в кадре — стрелки кадра. */
export type Act =
  | { kind: "req"; key: string | null } // приложение → под
  | { kind: "reply"; text: string; tone: "ok" | "warn" | "error"; lost: boolean } // под → приложение
  | { kind: "bank"; key: string | null; replayed: boolean } // под → банк
  | { kind: "db"; table: "payments" | "keys" }; // под → таблица

export interface Actor {
  id: ActorId;
  label: string;
  dead: boolean;
  atBank: boolean; // ждёт ответа банка
  thought: string | null;
  crossed: string | null;
  acts: Act[];
}

/** Колонки idempotency_keys в кадре: появляются, когда о них говорит голос. */
export type KeyCols = "key" | "status" | "lease";

export type Focus = ActorId | "phone" | "bank" | "payments" | "keys" | "board" | "sql" | "code" | "db" | "lb";

/** Вставки поверх сцены: две попытки одного заказа (почему ключ не номер заказа). */
export type Aside = "attempts";

export type EventKind =
  | "press" | "req" | "lost" | "reply" | "charge" | "double" | "replayed" | "insert" | "conflict" | "done" | "busy"
  | "crash" | "takeover" | "tick"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  by?: ActorId;
  lamps?: Verdict;
  /** tick: сколько секунд прошло. */
  n?: number;
}

export interface World {
  clock: number;
  payments: Payment[];
  keys: KeyRow[];
  ledger: Charge[];
  /** Память банка: ключ → номер списания в журнале. */
  bankKeys: Record<string, number>;
  phone: Phone;
  actors: Record<ActorId, Actor>;
  /** Подача: колонки ключей (null — таблицы ключей ещё нет), часы БД, «?» над итогом, реплика банка, код, вставка. */
  keyCols: KeyCols[] | null;
  clockShown: boolean;
  doubt: boolean;
  bank: string | null;
  code: { title: string; lines: string[]; mark: { line: number; tone: "warn" | "ok"; note?: string }[] } | null;
  aside: Aside | null;
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
  const actor = (id: ActorId): Actor => ({ id, label: `Pod ${id}`, dead: false, atBank: false, thought: null, crossed: null, acts: [] });
  return {
    clock: 0,
    payments: [],
    keys: [],
    ledger: [],
    bankKeys: {},
    phone: { screen: "buy", balance: BALANCE, key: null, tunnel: false, thought: null },
    actors: { A: actor("A"), B: actor("B") },
    keyCols: null,
    clockShown: false,
    doubt: false,
    bank: null,
    code: null,
    aside: null,
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

function alive(w: World, who: ActorId): Actor {
  const a = w.actors[who];
  if (a.dead) throw new Error(`${who}: под упал`);
  return a;
}

/** Приложение шлёт запрос оплаты на под (с ключом текущей попытки, если он есть). */
export function request(w: World, who: ActorId): void {
  alive(w, who).acts.push({ kind: "req", key: w.phone.key });
  w.phone.screen = "spin";
  w.events.push({ kind: "req", by: who });
}

/** SELECT по заказу в payments: есть ли уже платёж. */
export function paid(w: World, who: ActorId): boolean {
  alive(w, who).acts.push({ kind: "db", table: "payments" });
  return w.payments.some((p) => p.order === ORDER);
}

/**
 * Вызов банка. Тот же ключ банк уже видел — возвращает прежний результат и не списывает; иначе списывает с карты.
 * Возвращает true, если деньги ушли сейчас.
 */
export function charge(w: World, who: ActorId, key: string | null = null): boolean {
  const a = alive(w, who);
  a.atBank = false;
  if (key !== null && key in w.bankKeys) {
    a.acts.push({ kind: "bank", key, replayed: true });
    w.events.push({ kind: "replayed", by: who });
    return false;
  }
  const dup = w.ledger.length > 0;
  w.ledger.push({ order: ORDER, amount: AMOUNT, key, attempt: w.phone.key, by: who });
  if (key !== null) w.bankKeys[key] = w.ledger.length - 1;
  w.phone.balance -= AMOUNT;
  a.acts.push({ kind: "bank", key, replayed: false });
  w.events.push({ kind: dup ? "double" : "charge", by: who });
  return true;
}

/** Под ушёл в банк, а банк ещё думает: ответа нет. */
export function callBank(w: World, who: ActorId): void {
  alive(w, who).atBank = true;
}

/** INSERT INTO payments (autocommit). */
export function insertPayment(w: World, who: ActorId): void {
  alive(w, who).acts.push({ kind: "db", table: "payments" });
  w.payments.push({ order: ORDER, amount: AMOUNT, by: who });
  w.events.push({ kind: "insert", by: who });
}

/** INSERT INTO idempotency_keys … ON CONFLICT DO NOTHING (autocommit): "inserted" или "conflict" (0 строк). */
export function claimKey(w: World, who: ActorId, key: string, lease = false): "inserted" | "conflict" {
  alive(w, who).acts.push({ kind: "db", table: "keys" });
  if (w.keys.some((k) => k.key === key)) {
    w.events.push({ kind: "conflict", by: who });
    return "conflict";
  }
  w.keys.push({ key, status: "processing", response: null, lockedUntil: lease ? w.clock + LEASE : null, by: who });
  w.events.push({ kind: "insert", by: who });
  return "inserted";
}

export function keyRow(w: World, key: string): KeyRow {
  const k = w.keys.find((x) => x.key === key);
  if (!k) throw new Error(`нет ключа ${key}`);
  return k;
}

/** SELECT строки ключа: статус и сохранённый ответ. */
export function readKey(w: World, who: ActorId, key: string): KeyRow {
  alive(w, who).acts.push({ kind: "db", table: "keys" });
  return keyRow(w, key);
}

/** Одна транзакция: платёж, status = done, сохранённый ответ. */
export function finishKey(w: World, who: ActorId, key: string, response: string): void {
  const k = keyRow(w, key);
  if (k.by !== who || k.status !== "processing") throw new Error(`${who}: ключ ${key} не его`);
  insertPayment(w, who);
  alive(w, who).acts.push({ kind: "db", table: "keys" });
  k.status = "done";
  k.response = response;
  k.lockedUntil = null;
  w.events.push({ kind: "done", by: who });
}

/**
 * UPDATE … SET locked_until = now() + срок WHERE key = $1 AND status = 'processing' AND locked_until < now():
 * брошенный ключ переходит к повтору (в модели — и владелец строки). false — срок ещё не вышел.
 */
export function takeOver(w: World, who: ActorId, key: string): boolean {
  alive(w, who).acts.push({ kind: "db", table: "keys" });
  const k = keyRow(w, key);
  if (k.status !== "processing" || k.lockedUntil === null || k.lockedUntil >= w.clock) return false;
  k.by = who;
  k.lockedUntil = w.clock + LEASE;
  w.events.push({ kind: "takeover", by: who });
  return true;
}

/** Ответ пода приложению; в туннеле он теряется по дороге. */
export function reply(w: World, who: ActorId, text: string, tone: "ok" | "warn" | "error", screen: Screen): void {
  const lost = w.phone.tunnel;
  alive(w, who).acts.push({ kind: "reply", text, tone, lost });
  w.events.push({ kind: lost ? "lost" : tone === "warn" ? "busy" : "reply", by: who });
  if (!lost) w.phone.screen = screen;
}

/** Под упал (OOM Killer): незаписанный ответ уходит с ним. */
export function crash(w: World, who: ActorId): void {
  const a = w.actors[who];
  a.dead = true;
  a.atBank = false;
  a.thought = null;
  w.events.push({ kind: "crash", by: who });
}

/** Часы БД идут. */
export function advance(w: World, seconds: number): void {
  w.clock += seconds;
  w.events.push({ kind: "tick", n: seconds });
}

/** Попытки с двумя списаниями: по ключу попытки, без ключа — по номеру заказа. */
export function duplicated(w: World): boolean {
  const n = new Map<string, number>();
  for (const c of w.ledger) {
    const id = c.attempt ?? `order:${c.order}`;
    n.set(id, (n.get(id) ?? 0) + 1);
  }
  return [...n.values()].some((x) => x > 1);
}

/** Экран Иры говорит правду: «оплачено» — только если списано, ошибка — только если не списано; «в работе» честно всегда. */
export function honest(w: World): boolean {
  const charged = w.ledger.length > 0;
  const s = w.phone.screen;
  if (s === "paid") return charged;
  if (s === "error" || s === "used") return !charged;
  return true;
}

/** Ключ завис: processing, владелец мёртв, а срока нет. */
export function stuck(w: World): boolean {
  return w.keys.some((k) => k.status === "processing" && w.actors[k.by].dead && k.lockedUntil === null);
}
