// Мини-модель сервиса бронирования отелей: пул соединений с нашей базой (общий для поиска и брони), поставщик номеров —
// внешний мир со своей очередью и своей таблицей броней (наша база её не видит), журнал ответов гостям и рубильник
// (circuit breaker) в памяти каждого пода. Видимые события (бронь, таймаут, повтор, строка у поставщика) — операции;
// нагрузка — формулами от потока (закон Литтла для пула, волны повторов для поставщика). Время — счётчик мс world.clock.

import type { Code } from "../../kit/code";
import type { Board, Verdict } from "../../kit/director";

export type PodId = "A" | "B" | "C";
export const PODS: PodId[] = ["A", "B", "C"];

/** Слотов в пуле соединений с базой: общий на поиск и брони. */
export const POOL = 6;
/** Сколько поставщик успевает обработать броней в секунду (в кадре без чисел). */
export const SUP_CAP = 2;
/** Короткая транзакция: записать заявку или ответ — слот на миг, мс. */
export const SHORT_TX = 20;

/** Чем занят слот: поиск или бронь какого пода. */
export type Slot = { by: PodId; kind: "search" | "book" } | null;

/** Карточка брони в очереди поставщика. abandoned — наш под уже не ждёт ответа (таймаут), а карточка стоит. */
export interface Card {
  guest: string;
  ref: string | null; // наш номер брони, если передаём
  from: PodId | null; // null — чужие брони, очередь поставщика не только наша
  abandoned: boolean;
}

/** Строка в таблице броней поставщика. */
export interface SupRow {
  id: string;
  guest: string;
  ref: string | null;
}

export type Breaker = "closed" | "open" | "half";

/** Что под сделал в кадре — стрелки кадра. */
export type Act =
  | { kind: "search" } // слот → база → ответ
  | { kind: "slot" } // взял слот под бронь и держит
  | { kind: "call"; ref: string | null; retry: boolean } // позвал поставщика
  | { kind: "timeout" } // бросил ожидание
  | { kind: "reply" } // ответ поставщика дошёл
  | { kind: "fast" }; // разомкнутый рубильник: ответил гостю сразу, не звоня

export interface Pod {
  id: PodId;
  acts: Act[];
  /** Мысль пода: висит, пока она заблуждение. */
  thought: string | null;
  /** Сколько вызовов поставщика под сейчас ждёт (у каждой брони своя горутина). */
  waiting: number;
  breaker: Breaker | null; // null — рубильника нет
  fails: number; // отказов подряд
}

/** Ответ гостю в журнале браузеров. */
export interface Reply {
  by: PodId;
  kind: "search" | "book";
  status: "ok" | "wait" | "unknown" | "later" | "error";
}

export type RetryPolicy = "none" | "now" | "backoff" | "jitter";

export interface Policy {
  timeout: number | null; // мс; null — ждём сколько угодно
  inTx: boolean; // вызов поставщика внутри транзакции (держит слот)
  key: boolean; // передаём наш номер брони
}

export type Focus = PodId | "pool" | "supplier" | "rows" | "guests" | "board" | "clock" | "code" | "db" | "breakers";

export type EventKind =
  | "search" | "slot" | "release" | "call" | "retry" | "timeout" | "confirm" | "dup" | "found" | "jam"
  | "wave" | "spread" | "trip" | "probe" | "close" | "fast" | "down" | "up" | "booked" | "unknown" | "clock"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  by?: PodId;
  n?: number;
  lamps?: Verdict;
}

export interface Supplier {
  /** Сколько отвечает на новую карточку, мс; null — лежит. */
  latency: number | null;
  queue: Card[];
  rows: SupRow[];
  /** Над таблицей «?»: мы не знаем, есть ли бронь (нить кейса 1). */
  doubt: boolean;
}

export interface World {
  clock: number; // мс
  pool: Slot[];
  /** Гостей с поиском, ждущих свободного слота. */
  searchQueue: number;
  pods: Record<PodId, Pod>;
  supplier: Supplier;
  replies: Reply[];
  policy: Policy;
  /** Поток броней, в секунду (образ в кадре; для формул). */
  bookFlow: number;
  /** Окно кода на Go (знакомство, вызов вне транзакции). */
  code: Code | null;
  /** Время повторов кейса 2: удары в поставщика по секундам после общего таймаута. */
  wave: number[] | null;
  sql: string[];
  db: string | null;
  plate: string | null;
  chapter: number | null;
  board: Board | null;
  stamp: string | null;
  focus: Focus[] | null;
  /** Ещё не показанные зрителю части мира (знакомство вводит их по одной). */
  unseen: ("pool" | "supplier")[];
  term: string | null;
  events: SimEvent[];
  frame: number;
  scene: number;
  replay: boolean;
}

export const GUEST = "Иванов";
export const OUR_REF = "H-7731";

const pod = (id: PodId): Pod => ({ id, acts: [], thought: null, waiting: 0, breaker: null, fails: 0 });

export function world(): World {
  return {
    clock: 0,
    pool: Array.from({ length: POOL }, () => null),
    searchQueue: 0,
    pods: { A: pod("A"), B: pod("B"), C: pod("C") },
    supplier: { latency: 200, queue: [], rows: [], doubt: false },
    replies: [],
    policy: { timeout: null, inTx: true, key: false },
    bookFlow: 0,
    code: null,
    wave: null,
    sql: [],
    db: null,
    plate: null,
    chapter: null,
    board: null,
    stamp: null,
    focus: null,
    unseen: [],
    term: null,
    events: [],
    frame: 0,
    scene: 0,
    replay: false,
  };
}

export function freeSlots(w: World): number {
  return w.pool.filter((s) => s === null).length;
}

function take(w: World, by: PodId, kind: "search" | "book"): boolean {
  const i = w.pool.indexOf(null);
  if (i < 0) return false;
  w.pool[i] = { by, kind };
  return true;
}

function release(w: World, by: PodId, kind: "search" | "book"): void {
  const i = w.pool.findIndex((s) => s?.by === by && s.kind === kind);
  if (i >= 0) w.pool[i] = null;
  w.events.push({ kind: "release", by });
}

/** Поиск: слот на миг → база → список номеров. Нет слота — гость встаёт в очередь и ждёт.
 *  `hold` — слот остаётся занятым до конца кадра, чтобы зритель увидел, что его брали (знакомство с пулом). */
export function search(w: World, who: PodId, hold = false): Reply {
  const p = w.pods[who];
  p.acts.push({ kind: "search" });
  if (!take(w, who, "search")) {
    w.searchQueue++;
    w.events.push({ kind: "jam", by: who });
    return log(w, { by: who, kind: "search", status: "wait" });
  }
  w.events.push({ kind: "search", by: who });
  if (!hold) release(w, who, "search");
  return log(w, { by: who, kind: "search", status: "ok" });
}

function log(w: World, r: Reply): Reply {
  w.replies.push(r);
  return r;
}

/** Номер новой строки у поставщика. */
const supId = (w: World) => `R-${1042 + w.supplier.rows.length}`;

/**
 * Бронь: внутри транзакции — слот на всё время вызова; вне — слот на миг до и после.
 * Поставщик быстрый — ответ сразу; медленный или лежит — под ждёт (`waiting`), карточка в очереди поставщика.
 * Под с разомкнутым рубильником не звонит вовсе: гость сразу получает «попробуйте позже».
 */
export function book(w: World, who: PodId, { retry = false } = {}): void {
  const p = w.pods[who];
  if (p.breaker === "open") {
    p.acts.push({ kind: "fast" });
    w.events.push({ kind: "fast", by: who });
    settle(w, who, "later");
    return;
  }
  if (w.policy.inTx) {
    if (!take(w, who, "book")) throw new Error(`бронь без слота у ${who}`);
    p.acts.push({ kind: "slot" });
    w.events.push({ kind: "slot", by: who });
  }
  const ref = w.policy.key ? OUR_REF : null;
  p.acts.push({ kind: "call", ref, retry });
  w.events.push({ kind: retry ? "retry" : "call", by: who });
  const lat = w.supplier.latency;
  if (lat !== null && lat <= 1000 && !w.supplier.queue.length) {
    answer(w, who, ref);
    return;
  }
  w.supplier.queue.push({ guest: GUEST, ref, from: who, abandoned: false });
  p.waiting++;
  settle(w, who, "wait");
}

/** Ответ гостю брони: заменяет его «ждите» (одна строка на гостя в журнале). */
function settle(w: World, who: PodId, status: Reply["status"]): void {
  const r = [...w.replies].reverse().find((x) => x.by === who && x.kind === "book" && x.status === "wait");
  if (r) r.status = status;
  else log(w, { by: who, kind: "book", status });
}

/** Попытки кончились: гость получает ошибку. */
export function giveUp(w: World, who: PodId): void {
  const r = [...w.replies].reverse().find((x) => x.by === who && x.kind === "book" && (x.status === "wait" || x.status === "unknown"));
  if (r) r.status = "error";
  else log(w, { by: who, kind: "book", status: "error" });
  w.events.push({ kind: "unknown", by: who });
}

/** Ответ поставщика дошёл до ждущего пода: строка у поставщика, слот свободен, гостю «забронировано». */
function answer(w: World, who: PodId, ref: string | null): void {
  const p = w.pods[who];
  confirm(w, ref);
  p.acts.push({ kind: "reply" });
  p.waiting = Math.max(0, p.waiting - 1);
  p.fails = 0;
  if (w.policy.inTx) release(w, who, "book");
  w.events.push({ kind: "booked", by: who });
  settle(w, who, "ok");
}

/**
 * Поставщик обрабатывает карточку: с нашим номером, который уже видел, — отвечает про ту же бронь;
 * без номера — новая строка (откуда ему знать, что это повтор).
 */
function confirm(w: World, ref: string | null): SupRow {
  const seen = ref && w.supplier.rows.find((r) => r.ref === ref);
  if (seen) {
    w.events.push({ kind: "found" });
    return seen;
  }
  const row = { id: supId(w), guest: GUEST, ref };
  w.supplier.rows.push(row);
  w.supplier.doubt = false;
  w.events.push({ kind: w.supplier.rows.filter((r) => r.guest === GUEST).length > 1 ? "dup" : "confirm" });
  return row;
}

/** Чужие брони в очереди поставщика: он тормозит не из-за нас одних. */
export function backlog(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.supplier.queue.push({ guest: "", ref: null, from: null, abandoned: false });
}

/** Ждущий под бросает ожидание по таймауту: транзакция откатывается, слот — в пул, карточка у поставщика остаётся. */
export function timeout(w: World, who: PodId): void {
  const p = w.pods[who];
  if (!p.waiting) throw new Error(`таймаут без ожидания у ${who}`);
  p.waiting--;
  p.fails++;
  p.acts.push({ kind: "timeout" });
  w.events.push({ kind: "timeout", by: who });
  const card = w.supplier.queue.find((c) => c.from === who && !c.abandoned);
  if (card) card.abandoned = true;
  if (w.policy.inTx) release(w, who, "book");
  w.supplier.doubt = true;
  settle(w, who, "unknown");
  if (p.breaker === "closed" && p.fails >= 3) trip(w, who);
}

/** Поставщик разгребает очередь: n первых карточек (брошенные тоже — он о нашем таймауте не знает). */
export function serve(w: World, n = 1): void {
  for (const c of w.supplier.queue.splice(0, n)) {
    if (c.from && !c.abandoned && w.pods[c.from].waiting) answer(w, c.from, c.ref);
    else if (c.from) confirm(w, c.ref); // брошенная нами карточка — бронь у поставщика всё равно появится
  }
}

/** Рубильник пода размыкается: дальше под не звонит. */
export function trip(w: World, who: PodId): void {
  w.pods[who].breaker = "open";
  w.events.push({ kind: "trip", by: who });
}

/** Half-open: рубильник приоткрыт, следующий вызов — пробный. */
export function halfOpen(w: World, who: PodId): void {
  w.pods[who].breaker = "half";
  w.events.push({ kind: "probe", by: who });
}

/** Пробный вызов прошёл — рубильник замкнут. */
export function closeBreaker(w: World, who: PodId): void {
  w.pods[who].breaker = "closed";
  w.pods[who].fails = 0;
  w.events.push({ kind: "close", by: who });
}

export function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
}

// --- Формулы нагрузки: по ним табло сверяет тест. ---

/** Сколько мс бронь держит слот: внутри транзакции — пока ждёт поставщика (или до таймаута), вне — две короткие транзакции. */
export function slotHold(w: World): number {
  if (!w.policy.inTx) return 2 * SHORT_TX;
  const lat = w.supplier.latency ?? Infinity;
  return Math.min(lat, w.policy.timeout ?? Infinity);
}

/** Слотов занято бронями в среднем: поток × время удержания (закон Литтла), не больше пула. */
export function bookSlots(w: World): number {
  return Math.min(POOL, (w.bookFlow * slotHold(w)) / 1000);
}

/** Поиск отвечает: зелёный — пул почти свободен, жёлтый — дышит на пределе, красный — слотов нет. */
export function searchLamp(w: World): "red" | "yellow" | "green" {
  const busy = bookSlots(w);
  return busy >= POOL ? "red" : busy > POOL / 2 ? "yellow" : "green";
}

/** Гость знает, что с бронью: висит без ответа — нет; «проверяем» — исход неизвестен; ответ — да. */
export function guestLamp(w: World): "red" | "yellow" | "green" {
  const books = w.replies.filter((r) => r.kind === "book");
  if (w.policy.timeout === null && Object.values(w.pods).some((p) => p.waiting > 0)) return "red";
  return books.some((r) => r.status === "unknown") ? "yellow" : "green";
}

/** Броней у поставщика на одного гостя. */
export function bookingsOf(w: World, guest = GUEST): number {
  return w.supplier.rows.filter((r) => r.guest === guest).length;
}

/** Удары повторов по секундам после общего таймаута n ждущих (все отвалились в одну секунду). */
export function retryWave(policy: RetryPolicy, n: number, tries = 3): number[] {
  const at: number[] = [];
  const jit = [0.1, 0.3, 0.5, 0.9, 0.8, 0.7, 0.5, 0.1, 0.95]; // разброс — детерминированная «случайность»
  for (let k = 0; k < n; k++) {
    let t = 0;
    for (let i = 0; i < tries; i++) {
      // Сразу: следующий удар — как только снова истёк таймаут (3 с). Backoff: пауза 1, 2, 4 с; jitter — пауза ± половина.
      const pause = policy === "now" ? 3 : 2 ** i;
      t += policy === "jitter" ? pause * (0.5 + jit[(k * tries + i) % jit.length]) : pause;
      at.push(t);
    }
  }
  const len = Math.ceil(Math.max(...at)) + 1;
  const wave = Array.from({ length: len }, () => 0);
  for (const t of at) wave[Math.floor(t)]++;
  return wave;
}

/** Поставщик не добит: пик ударов выше его ёмкости — красный; повторы есть, но разнесены — жёлтый; лишних нет — зелёный. */
export function supplierLamp(wave: number[] | null): "red" | "yellow" | "green" {
  if (!wave || !wave.some((x) => x > 0)) return "green";
  return Math.max(...wave) > SUP_CAP ? "red" : "yellow";
}

/** Ответ сразу: никто из гостей не ждал всех попыток ради ошибки. */
export function fastLamp(w: World): "red" | "green" {
  return w.replies.some((r) => r.status === "error") ? "red" : "green";
}

/** Брони снова идут: поставщик поднялся и бронь прошла; лежит под лавиной повторов — нет; лежит и отдыхает — рано судить. */
export function resumeLamp(w: World): "red" | "green" | null {
  if (w.supplier.latency === null) return supplierLamp(w.wave) === "red" ? "red" : null;
  return w.replies.some((r) => r.kind === "book" && r.status === "ok") ? "green" : "red";
}
