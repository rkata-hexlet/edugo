// Мини-модель листания. Выдача гостю: таблица `offers` (id, отель, цена) в порядке добавления, порядок выдачи даёт
// только запрос — «по цене, при равной — по id», страница из пяти карточек. Следующую страницу берут по номеру позиции
// (OFFSET) или по закладке — значению ключа последней показанной карточки (`price >`, `price >=`, пара `(price, id) >`).
// Между нажатиями таблица живёт: вставки, удаления, смена цены. Выгрузка броней партнёру — только счёт прочитанных и отданных строк.
// Время не нужно: порядок кадров и есть порядок событий.

import type { Board, Verdict } from "../../kit/director";

export type PodId = "A" | "B" | "C";
export const PODS: PodId[] = ["A", "B", "C"];

export const PAGE = 5;

/** Одна шкала на весь эпизод: три лампы табло. */
export const CRITERIA = ["не пропало", "не дважды", "быстро"];

export interface Offer {
  id: number;
  hotel: string;
  price: number;
  deleted: boolean;
  /** Появилась или сменила цену за время листания: такой карточке закладка ничего не обещает. */
  moved: boolean;
  /** Цена до UPDATE — подпись в таблице. */
  was: number | null;
}

/**
 * Таблица в порядке добавления: id растёт на единицу, по цене строки не стоят. По `price, id`: страница 1 — «Маяк» 3 600 …
 * «Причал» 4415, страница 2 — «Лагуна» 4418 …; ничья по 4 900 — 4413/4415/4418.
 */
export const OFFERS: [number, string, number][] = [
  [4412, "Гавань", 5600], [4413, "Утёс", 4900], [4414, "Маяк", 3600], [4415, "Причал", 4900], [4416, "Дюна", 6800],
  [4417, "Бриз", 4200], [4418, "Лагуна", 4900], [4419, "Сосны", 3800], [4420, "Залив", 6200], [4421, "Рассвет", 5900],
];
/** Дешёвая карточка хука: новый отель. */
export const CHEAP: [number, string, number] = [4422, "Пирс", 3200];
/** UPDATE цены: «Бриз» с первой страницы дорожает и уезжает на вторую. */
export const PRICEY = { id: 4417, price: 6000 };

/** Как берём следующую страницу: отсчётом позиций или закладкой по значению. */
export type Mode = "offset" | "gt" | "gte" | "pair";

export interface Mark {
  price: number;
  id: number;
}

export interface Guest {
  /** Показанные страницы: id карточек по порядку. */
  pages: number[][];
  /** Цены, какими гость их увидел: после UPDATE у него на экране остаётся старая. */
  prices: number[][];
  pressed: boolean;
  say: string | null;
}

/** Выгрузка вчерашних броней партнёру: закрытый период, страницами по тысяче. */
export const BOOKINGS = 2_000_000;
export const BATCH = 1000;
export const LAST_PAGE = BOOKINGS / BATCH;

export interface Export {
  mode: "offset" | "pair";
  /** Номер страницы (с 1) и сколько строк база прочитала и отдала на ней. */
  page: number;
  read: number;
  sent: number;
  /** Прочитано за всю выгрузку до этой страницы включительно: OFFSET каждый раз начинает с первой брони. */
  total: number;
}

export type Focus = PodId | "guest" | "db" | "board" | "sql" | "mark" | "index" | "ghost" | "twins" | "pages" | "behind";

export type EventKind =
  | "press" | "fetch" | "count" | "insert" | "delete" | "update" | "dup" | "lost" | "mark" | "trash" | "jump"
  | "page" | "rewind" | "verdict" | "card";

export interface SimEvent {
  kind: EventKind;
  by?: PodId;
  lamps?: Verdict;
}

export interface World {
  /** Строки таблицы в порядке хранения; новые — в конец. */
  offers: Offer[];
  /** Что в кадре: таблица как лежит или результат последнего запроса (`ORDER BY price, id`). */
  order: "table" | "query";
  mode: Mode;
  /** Карточки, которые Postgres отсчитал на последнем запросе (OFFSET). */
  counted: number[];
  mark: Mark | null;
  guest: Guest;
  /** Какой под обслужил каждое нажатие — стрелки кадра. */
  served: PodId[];
  /** Пропущенные карточки показаны в щели между страницами. */
  ghost: boolean;
  /** Выгрузка: вместо гостя бухгалтерия партнёра, вместо offers — bookings и индекс. */
  export: Export | null;
  /** Цена закладки: на страницу N не прыгнуть. */
  jump: boolean;
  /** Итог: матрица OFFSET / закладка по трём лампам. */
  matrix: boolean;
  /** Тизер: в кадре только гость, Postgres пока пуст. */
  teaser: boolean;
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
  return {
    offers: OFFERS.map(([id, hotel, price]) => ({ id, hotel, price, deleted: false, moved: false, was: null })),
    order: "table",
    mode: "offset",
    counted: [],
    mark: null,
    guest: { pages: [], prices: [], pressed: false, say: null },
    served: [],
    ghost: false,
    export: null,
    jump: false,
    matrix: false,
    teaser: false,
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

/** Порядок выдачи: по цене, при равной — по id. */
export const before = (a: Mark, b: Mark) => a.price < b.price || (a.price === b.price && a.id < b.id);

/** Выдача, какой её вернёт запрос сейчас: `ORDER BY price, id`, проданных нет. */
export const listing = (w: World): Offer[] =>
  w.offers.filter((o) => !o.deleted).sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));

export const offer = (w: World, id: number): Offer => w.offers.find((o) => o.id === id)!;

/** Показанные гостю карточки подряд, со всех страниц. */
export const shown = (w: World): number[] => w.guest.pages.flat();

const ORDER = `ORDER BY price, id LIMIT ${PAGE}`;
const SQL: Record<Mode, (m: Mark | null, offset: number) => string> = {
  offset: (_, n) => `SELECT * FROM offers\nORDER BY price, id\nLIMIT ${PAGE}${n ? ` OFFSET ${n}` : ""}`,
  gt: (m) => `SELECT * FROM offers\nWHERE price > ${m!.price}\n${ORDER}`,
  gte: (m) => `SELECT * FROM offers\nWHERE price >= ${m!.price}\n${ORDER}`,
  pair: (m) => `SELECT * FROM offers\nWHERE (price, id) > (${m!.price}, ${m!.id})\n${ORDER}`,
};

/** Запрос следующей страницы — как его увидит база. */
export const nextSql = (w: World): string => SQL[w.guest.pages.length ? w.mode : "offset"](w.mark, w.guest.pages.length * PAGE);

/** Гость жмёт «Показать ещё» (или открывает выдачу): под `by` берёт у базы следующую страницу. */
export function next(w: World, by: PodId = "A"): number[] {
  const all = listing(w);
  const n = w.guest.pages.length;
  let rows: Offer[];
  w.counted = [];
  if (!n) rows = all.slice(0, PAGE);
  else if (w.mode === "offset") {
    w.counted = all.slice(0, n * PAGE).map((o) => o.id);
    rows = all.slice(n * PAGE, (n + 1) * PAGE);
    emit(w, "count");
  } else {
    // Закладка — ключ последней показанной карточки; в кадре флажок стоит там, откуда искал этот запрос.
    const m = (w.mark = keyOf(w));
    const after = w.mode === "gt" ? (o: Offer) => o.price > m.price : w.mode === "gte" ? (o: Offer) => o.price >= m.price : (o: Offer) => before(m, o);
    rows = all.filter(after).slice(0, PAGE);
  }
  w.sql = [nextSql(w)];
  w.order = "query";
  if (n) {
    w.guest.pressed = true;
    emit(w, "press");
  }
  const seen = new Set(shown(w));
  const ids = rows.map((o) => o.id);
  w.guest.pages.push(ids);
  w.guest.prices.push(rows.map((o) => o.price));
  w.served.push(by);
  emit(w, "fetch", by);
  if (ids.some((id) => seen.has(id))) emit(w, "dup");
  if (w.mode !== "offset" && !n) {
    w.mark = keyOf(w);
    emit(w, "mark");
  }
  return ids;
}

/** Ключ последней показанной карточки. */
function keyOf(w: World): Mark {
  const last = offer(w, shown(w).at(-1)!);
  return { price: last.price, id: last.id };
}

/** Подключился новый отель — новая строка в конце таблицы. */
export function insert(w: World, [id, hotel, price]: [number, string, number]): void {
  w.offers.push({ id, hotel, price, deleted: false, moved: true, was: null });
  w.sql = [`INSERT INTO offers (id, hotel, price)\nVALUES (${id}, '${hotel}', ${price})`];
  w.order = "table";
  emit(w, "insert");
}

/** Другой гость купил последний номер — предложение удаляют; в кадре строка зачёркнута на месте. */
export function remove(w: World, id: number): void {
  offer(w, id).deleted = true;
  w.sql = [`DELETE FROM offers\nWHERE id = ${id}`];
  w.order = "table";
  emit(w, "delete");
}

/** Отель сменил цену — строка остаётся на месте, место в выдаче ей заново определит сортировка. */
export function reprice(w: World, id: number, price: number): void {
  const o = offer(w, id);
  o.was = o.price;
  o.price = price;
  o.moved = true;
  w.sql = [`UPDATE offers SET price = ${price}\nWHERE id = ${id}`];
  w.order = "table";
  emit(w, "update");
}

/**
 * Пропущенные: карточки, что всё листание стояли на месте (не удалены, не новые, цену не меняли), лежат до последней показанной,
 * а гость их не видел. Гарантия закладки — только для них.
 */
export function lost(w: World): number[] {
  const ids = shown(w);
  if (!ids.length) return [];
  const last = offer(w, ids.at(-1)!);
  const seen = new Set(ids);
  return listing(w).filter((o) => !o.moved && !seen.has(o.id) && before(o, last)).map((o) => o.id);
}

/** Новые за время листания, вставшие позади закладки: гость их не увидит, и закладка этого не обещала. */
export const behind = (w: World): number[] =>
  w.mark ? listing(w).filter((o) => o.moved && !shown(w).includes(o.id) && before(o, w.mark!)).map((o) => o.id) : [];

/** Показать пропущенные: карточка проваливается в щель между страницами. */
export function reveal(w: World): void {
  w.ghost = true;
  if (lost(w).length) emit(w, "lost");
}

/** Показанные дважды и больше. */
export function dups(w: World): number[] {
  const ids = shown(w);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

/** Гость пытается прыгнуть на далёкую страницу: у закладки её нет. */
export function jump(w: World): void {
  w.jump = true;
  w.guest.pressed = true;
  emit(w, "jump");
}

// --- Выгрузка. ---

/** Выгрузка страницы `page`: OFFSET по индексу от первой брони читает и выбрасывает всё до неё; закладка встаёт сразу на место. */
export function exportPage(w: World, mode: Export["mode"], page: number, by: PodId = "A"): void {
  const read = mode === "offset" ? page * BATCH : BATCH;
  const total = mode === "offset" ? (BATCH * page * (page + 1)) / 2 : BATCH * page;
  w.export = { mode, page, read, sent: BATCH, total };
  w.served.push(by);
  w.sql = [mode === "offset"
    ? `SELECT * FROM bookings\nORDER BY created_at, id\nLIMIT ${BATCH} OFFSET ${(page - 1) * BATCH}`
    : `SELECT * FROM bookings\nWHERE (created_at, id) > ($1, $2)\nORDER BY created_at, id LIMIT ${BATCH}`];
  emit(w, "fetch", by);
  if (read > BATCH) emit(w, "trash");
}

/** Сумма прочитанного за всю выгрузку OFFSET: 1 000 + 2 000 + … + 2 000 000. */
export const offsetTotal = () => (BATCH * LAST_PAGE * (LAST_PAGE + 1)) / 2;

// --- Лампы табло: по ним тест сверяет оценки кадров. ---

/** «Не пропало»: каждая карточка, что стояла на месте, показана хоть раз. */
export const lostLamp = (w: World): "red" | "green" => (lost(w).length ? "red" : "green");

/** «Не дважды»: ни одна карточка не показана дважды. */
export const dupLamp = (w: World): "red" | "green" => (dups(w).length ? "red" : "green");

/** «Быстро»: страница выгрузки читает не больше, чем отдаёт. */
export const fastLamp = (w: World): "red" | "green" => (w.export!.read > w.export!.sent ? "red" : "green");
