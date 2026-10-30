// Мини-модель фичефлага в сервисе бронирования. Пульт дежурного держит правила флага (вкл/выкл, процент); под решает,
// показывать ли гостю новую оплату «при заселении», одним из способов: читает пульт напрямую (знакомство), бросает монетку,
// спрашивает сервис флагов на каждый запрос или считает сам по копии правил в памяти. Бакет гостя — FNV-1a от
// «флаг:гость» по модулю 100, как в разборе tech-expert §4.2. Брони лежат в Postgres; старая ветка обработчика отменяет
// бронь с незнакомым значением оплаты, пока под не научили его читать (expand). Время — счётчик секунд `t`.

import type { Board } from "../../kit/director";

export type PodId = "A" | "B" | "C";
export const PODS: PodId[] = ["A", "B", "C"];

export const FLAG = "pay_at_hotel";
/** Второй флаг — для кадра про соль: другая раскатка, тот же гость. */
export const OTHER = "new_search";

/** Гости с бирками-бакетами 07 · 24 · 58 · 91 под флагом оплаты (подобраны под FNV-1a, сверяет тест). */
export const GUESTS = ["g1333", "g1004", "g1271", "g1070"];
export const GUEST = GUESTS[0];

/** Копия правил обновляется в фоне раз в 30 с; у каждого пода свои часы. */
export const REFRESH = 30;
const PHASE: Record<PodId, number> = { A: 4, B: 17, C: 28 };

export type Payment = "paid" | "pending" | "at_hotel";

/** Правила флага: так их держит пульт, так их копирует под. `salted` — в хэш идёт имя флага. */
export interface Rules {
  on: boolean;
  percent: number;
  salted: boolean;
}

/** Как под узнаёт значение флага. */
export type Mode = "direct" | "coin" | "remote" | "local";

export interface Pod {
  id: PodId;
  /** Копия правил в памяти пода (local evaluation); null — ещё не получил. */
  copy: Rules | null;
  /** Под научился читать `at_hotel` (expand). */
  reads: boolean;
  /** Ждёт ответа сервиса флагов. */
  hanging: boolean;
  /** Последняя строка лога. */
  log: string | null;
  /** Под только что запустился. */
  fresh: boolean;
}

export interface Booking {
  id: string;
  guest: string;
  payment: Payment;
  cancelled: boolean;
  /** Решение флага, записанное вместе с бронью; null — не записывали. */
  flow: "new" | "old" | null;
}

/** Что увидел гость на шаге брони: какой под и с новой ли оплатой. */
export interface Visit {
  by: PodId;
  fresh: boolean | "hang";
}

export type Focus =
  | PodId | "guest" | "queue" | "console" | "service" | "db" | "code" | "default" | "boxes" | "split" | "knight" | "steps";

export type EventKind =
  | "toggle" | "slide" | "coin" | "ask" | "hang" | "down" | "copy" | "refresh" | "fail" | "cold"
  | "write" | "cancel" | "keep" | "expand" | "contract" | "page" | "rewind" | "verdict" | "card";

export interface SimEvent {
  kind: EventKind;
  by?: PodId;
}

export interface World {
  console: Rules;
  /** Сервис флагов: в кадре только в кейсе 2. */
  service: "up" | "down" | null;
  mode: Mode;
  pods: Record<PodId, Pod>;
  /** Очередь гостей с бирками — кейс 1. */
  queue: boolean;
  /** Второй пульт (флаг поиска) — кадр про соль. */
  twin: boolean;
  /** Шаги брони гостя в кадре. */
  visits: Visit[];
  guestSay: string | null;
  /** Гость у стойки отеля с отменённой бронью — хук и его рифмы. */
  desk: boolean;
  bookings: Booking[];
  /** Кейс 3: под раскладывает брони по ящикам старой ветки. */
  boxes: boolean;
  /** Строка кода в кадре (Go) и подсвеченный кусок. */
  code: string[];
  codeMark: string | null;
  /** «Код откатился, данные остались» — две колонки. */
  split: boolean;
  /** Contract: старая ветка и флаг убраны. */
  contracted: boolean;
  /** Итог: Knight Capital — две колонки рифмы. */
  knight: boolean;
  /** Слово дежурного у пульта. */
  dutySay: string | null;
  podSay: { by: PodId; text: string } | null;
  t: number;
  coins: number;
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

const pod = (id: PodId): Pod => ({ id, copy: null, reads: false, hanging: false, log: null, fresh: false });

export function world(): World {
  return {
    console: { on: false, percent: 100, salted: true },
    service: null,
    mode: "direct",
    pods: { A: pod("A"), B: pod("B"), C: pod("C") },
    queue: false,
    twin: false,
    visits: [],
    guestSay: null,
    desk: false,
    bookings: [],
    boxes: false,
    code: [],
    codeMark: null,
    split: false,
    contracted: false,
    knight: false,
    dutySay: null,
    podSay: null,
    t: 0,
    coins: 0,
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

const emit = (w: World, kind: EventKind, by?: PodId) => w.events.push(by ? { kind, by } : { kind });

/** FNV-1a, 32 бита: одинаковый на всех подах и после перезапуска. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Бакет гостя 0…99; без соли — от одного id гостя, одинаковый для всех флагов. */
export const bucket = (guest: string, flag: string = FLAG, salted = true): number => fnv(salted ? `${flag}:${guest}` : guest) % 100;

/** 7 → «07». */
export const tag = (n: number) => String(n).padStart(2, "0");

/** Правила говорят «новая оплата» этому гостю. */
export const allows = (r: Rules, guest: string, flag: string = FLAG): boolean => r.on && bucket(guest, flag, r.salted) < r.percent;

/** Монетка без генератора случайных чисел: детерминированная последовательность «на 10 % из ста» для запросов подряд. */
const COINS = [true, false, true, false, false, true];

// --- Пульт. ---

export function toggle(w: World, on: boolean): void {
  w.console.on = on;
  emit(w, "toggle");
}

export function slide(w: World, percent: number): void {
  w.console.percent = percent;
  emit(w, "slide");
}

// --- Сервис флагов. ---

export function serviceDown(w: World): void {
  w.service = "down";
  emit(w, "down");
}

/** Под стартует: забирает у сервиса копию правил; сервис лежит — копии нет, работает дефолт из кода. */
export function boot(w: World, id: PodId): void {
  const p = w.pods[id];
  p.fresh = true;
  if (w.service === "up") {
    p.copy = { ...w.console };
    emit(w, "copy", id);
  } else {
    p.copy = null;
    p.log = "flags: нет правил, дефолт";
    emit(w, "cold", id);
  }
}

/** Прошло `sec` секунд: у кого подошёл срок, тот обновляет копию в фоне; сервис лежит — остаётся прежняя, строка в лог. */
export function tick(w: World, sec: number): void {
  const from = w.t;
  w.t += sec;
  for (const id of PODS) {
    const p = w.pods[id];
    if (!p.copy && !p.fresh) continue;
    const due = Math.floor((w.t - PHASE[id]) / REFRESH) > Math.floor((from - PHASE[id]) / REFRESH);
    if (!due) continue;
    if (w.service === "up") {
      p.copy = { ...w.console };
      p.log = null;
      emit(w, "refresh", id);
    } else {
      p.log = "flags: refresh failed";
      emit(w, "fail", id);
    }
  }
}

/** Секунд до ближайшего обновления копии у пода — кольцо «30 с». */
export const untilRefresh = (w: World, id: PodId): number => {
  const r = (w.t - PHASE[id]) % REFRESH;
  return REFRESH - (r < 0 ? r + REFRESH : r);
};

/** Под решает для гостя: новая оплата, старая или повис в ожидании сервиса флагов. */
export function decide(w: World, id: PodId, guest: string = GUEST): boolean | "hang" {
  const p = w.pods[id];
  switch (w.mode) {
    case "direct":
      return allows(w.console, guest);
    case "coin":
      emit(w, "coin", id);
      return COINS[w.coins++ % COINS.length];
    case "remote":
      emit(w, "ask", id);
      if (w.service !== "up") {
        p.hanging = true;
        emit(w, "hang", id);
        return "hang";
      }
      return allows(w.console, guest);
    case "local":
      return p.copy ? allows(p.copy, guest) : false; // нет копии — дефолт из кода: false
  }
}

/** Гость проходит шаг брони через под `id`; если решение уже записано в брони, под читает его, а не флаг. */
export function visit(w: World, id: PodId, guest: string = GUEST): Visit {
  const b = w.bookings.find((x) => x.guest === guest && x.flow);
  const fresh = b ? b.flow === "new" : decide(w, id, guest);
  const v = { by: id, fresh };
  w.visits.push(v);
  return v;
}

/** Бронь с решением, принятым один раз в начале: метка едет с бронью. */
export function startBooking(w: World, id: PodId, guest: string = GUEST): Booking {
  const fresh = decide(w, id, guest) === true;
  const b: Booking = { id: `H-${8120 + w.bookings.length}`, guest, payment: fresh ? "at_hotel" : "paid", cancelled: false, flow: fresh ? "new" : "old" };
  w.bookings.push(b);
  w.visits.push({ by: id, fresh });
  emit(w, "write", id);
  return b;
}


// --- Данные: брони и старая ветка. ---

/** Брони в базе (без кадра): новая ветка уже записала свои. */
export function seed(w: World, rows: [string, Payment][]): void {
  for (const [id, payment] of rows) w.bookings.push({ id, guest: GUEST, payment, cancelled: false, flow: null });
}

/** Новая ветка пишет бронь «оплата при заселении». */
export function writeNew(w: World, id: string, by: PodId = "A"): void {
  w.bookings.push({ id, guest: GUEST, payment: "at_hotel", cancelled: false, flow: null });
  emit(w, "write", by);
}

/** Куда старая ветка кладёт бронь: оплачено — хорошо, ждём — полчаса, иначе — отменить. Под после expand знает `at_hotel`. */
export type Box = "paid" | "wait" | "cancel" | "known";
export const boxOf = (b: Booking, reads: boolean): Box =>
  b.payment === "paid" ? "paid" : b.payment === "pending" ? "wait" : reads ? "known" : "cancel";

/** Старая ветка обработчика брони проходит по свежим броням на поде `id`. */
export function oldBranch(w: World, id: PodId): void {
  w.boxes = true;
  for (const b of w.bookings) {
    if (b.cancelled) continue;
    const box = boxOf(b, w.pods[id].reads);
    if (box === "cancel") {
      b.cancelled = true;
      emit(w, "cancel", id);
    } else if (box === "known") emit(w, "keep", id);
  }
}

/** Expand: обычный деплой, после него все поды (и ночные задачи) читают `at_hotel`; флаг не трогаем. */
export function expand(w: World): void {
  for (const id of PODS) w.pods[id].reads = true;
  emit(w, "expand");
}

/** Contract: убираем старую ветку и сам флаг; чтение `at_hotel` остаётся. */
export function contract(w: World): void {
  w.contracted = true;
  emit(w, "contract");
}

export const cancelled = (w: World): Booking[] => w.bookings.filter((b) => b.cancelled);
