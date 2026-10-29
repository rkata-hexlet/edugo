import { STAGE, type Pen, type TextContent } from "../../engine/contract";
import { bob, elephant } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { bookmark, buyButton, mug, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import type { SqlMark } from "../../kit/sql";
import { board, bubble, lamp, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import {
  BATCH, BOOKINGS, CRITERIA, LAST_PAGE, PODS, behind, dups, listing, lost, offer, type Focus, type Offer, type PodId,
  type SimEvent, type World,
} from "./sim";

// MVP эпизода 13 (арка v2): серые фигуры. Слева — гость с телефоном-окном вокруг границы страниц (выгрузка — бухгалтерия
// партнёра), в середине — поды, справа — Postgres. В Postgres — либо таблица `offers` как лежит (по id; когда она меняется),
// либо результат запроса `ORDER BY price, id` с подписью «не сама таблица»: окно страницы, флажок закладки, пропущенные.
// В выгрузке — таблица `bookings` и индекс `(created_at, id)` рядом, счёт прочитано/отдано. Внизу — SQL и табло.

const GUEST = { x: 30, y: 104, w: 270, h: 370 };
const SERVICE = { x: 316, y: 104, w: 150, h: 370 };
const POD_X = 359;
const POD_Y: Record<PodId, number> = { A: 124, B: 236, C: 348 };
const DB = { x: 482, y: 104, w: 758, h: 370 };
const ROW = { y: 150, h: 26, step: 29 };
/** Таблица и результат запроса — на одном месте и одной ширины; справа — поле подписей. */
const RESULT = { x: 600, w: 300 };
const SIDE_X = 934;
const GHOST_X = 1050;
const TITLE_Y = ROW.y - 14;
/** Выгрузка: таблица и индекс — столбики, справа счётчик. */
const SHELF = { y: 160, h: 260, w: 56 };
const TABLE_X = 520;
const INDEX_X = 660;
/** Лестница проходов OFFSET слева от индекса: каждый проход — полоска от первой брони. */
const PASS = { x: 594, step: 16, w: 10 };
/** Первые страницы показываем крупно: в масштабе двух миллионов тысяча строк — меньше пикселя. */
const ZOOM = 3 * BATCH;
const COUNT_X = 980;
const BOARD = { x: 700, y: 490, w: 540, rowH: 30 };
const LAMP_X = [250, 365, 480];
const SQL_X = 30;
const BOTTOM = 648;
const CHAPTER_X = 1100;
const TERM = { x: 960, y: 66 };
/** Телефон гостя — окно: последняя страница и хвост прошлой. */
const TAIL = 2;

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"]) => w.events.some((e) => e.kind === kind);

/** 4900 → «4 900». */
const rub = (n: number) => n.toLocaleString("ru-RU").replace(/\s/g, " ");
const card = (o: Offer) => `${o.hotel} · ${rub(o.price)} ₽`;
const rowY = (i: number) => ROW.y + i * ROW.step;

function drawHeader(pen: Pen, w: World): void {
  elephant(pen, "db:face", { x: DB.x + 8, y: 8, talking: !!w.db, scale: 1.08 });
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER_X, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

/** Гость: кнопка «Показать ещё» и телефон — окно вокруг границы страниц; дубль — красным. */
function drawGuest(pen: Pen, w: World): void {
  const g = w.guest;
  pen.group("guest", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    person(pen, "guest:p", { x: GUEST.x + 14, y: GUEST.y + 14, shirt: COLOR.browser, mood: g.say ? "sad" : "idle" });
    buyButton(pen, "guest:btn", { x: GUEST.x + 70, y: GUEST.y + 18, pressed: g.pressed && !w.jump, label: "Показать ещё", w: 186 });
    const phone = { x: GUEST.x + 14, y: GUEST.y + 72, w: GUEST.w - 28, h: GUEST.h - 86 };
    pen.rect("guest:phone", { x: phone.x, y: phone.y, width: phone.w, height: phone.h, rx: 14, fill: COLOR.bg2, stroke: COLOR.line, "stroke-width": 2 });
    if (!g.pages.length) {
      pen.text("guest:none", { x: phone.x + 16, y: phone.y + 34, ...SANS, "font-style": "italic", fill: COLOR.faint }, "пусто");
      return;
    }
    const seen = new Set<number>();
    const all = g.pages.flatMap((ids, p) => ids.map((id, i) => {
      const dup = seen.has(id);
      seen.add(id);
      return { id, p, dup, price: g.prices[p][i] };
    }));
    // Первое появление дубля — красной рамкой без заливки: зритель видит пару, а не ищет «оригинал» сам.
    const twice = new Set(all.filter((c) => c.dup).map((c) => c.id));
    const missing = w.ghost && lost(w).length > 0;
    const last = g.pages.length - 1;
    const from = Math.max(0, all.findIndex((c) => c.p === last) - TAIL);
    let y = phone.y + 10;
    if (from) {
      pen.text("guest:more", { x: phone.x + phone.w / 2, y: y + 16, ...SANS, "text-anchor": "middle", fill: COLOR.faint }, "⋮");
      y += 24;
    }
    all.slice(from).forEach(({ id, p, dup, price }, i, list) => {
      if (i && list[i - 1].p !== p) {
        pen.line(`guest:div${p}`, { x1: phone.x + 10, y1: y + 2, x2: phone.x + phone.w - 10, y2: y + 2, stroke: COLOR.muted, "stroke-width": 2, "stroke-dasharray": "6 4" });
        y += 6;
        // Пропавшая карточка: гость её не видит — на её месте пустой слот.
        if (missing && p === last) {
          pen.rect("guest:slot", { x: phone.x + 8, y, width: phone.w - 16, height: 24, rx: 5, fill: "none", stroke: COLOR.error, "stroke-width": 2, "stroke-dasharray": "5 4", class: "fx-fade d3" });
          pen.text("guest:slot:t", { x: phone.x + phone.w / 2, y: y + 19, ...SANS, "text-anchor": "middle", "font-weight": 700, fill: COLOR.error, class: "fx-fade d3" }, "?");
          y += 27;
        }
      }
      const key = `guest:c${p}:${id}`;
      pen.rect(key, { x: phone.x + 8, y, width: phone.w - 16, height: 24, rx: 5, fill: dup ? COLOR.alarmBg : COLOR.surface2, stroke: twice.has(id) ? COLOR.error : "none", "stroke-width": 2, class: p === last && p ? "fx-slide" : "" });
      pen.text(`${key}:t`, { x: phone.x + 16, y: y + 19, ...SANS, fill: dup ? COLOR.error : p === last ? COLOR.ink : COLOR.muted }, card({ ...offer(w, id), price }));
      y += 27;
    });
  }, fade(w, "guest"));
}

/** Выгрузка: бухгалтерия партнёра забирает брони страницами; на глубине кофе остыл. */
function drawPartner(pen: Pen, w: World): void {
  const e = w.export!;
  const cold = e.read > e.sent;
  pen.group("partner", 0, 0, () => {
    panel(pen, "partner:box", { ...GUEST });
    person(pen, "partner:p", { x: GUEST.x + 14, y: GUEST.y + 14, shirt: COLOR.warn, mood: cold ? "sad" : "idle" });
    mug(pen, "partner:mug", { x: GUEST.x + 70, y: GUEST.y + 22, steam: !cold });
    pen.text("partner:t", { x: GUEST.x + 14, y: GUEST.y + 100, ...SANS, "font-weight": 700, fill: COLOR.ink }, "Бухгалтерия партнёра");
    pen.text("partner:day", { x: GUEST.x + 14, y: GUEST.y + 132, ...SANS, fill: COLOR.muted }, "брони за вчера");
    pen.text("partner:page", { x: GUEST.x + 14, y: GUEST.y + 172, ...SANS, fill: COLOR.ink }, `страница ${rub(e.page)} из ${rub(LAST_PAGE)}`);
    pen.text("partner:got", { x: GUEST.x + 14, y: GUEST.y + 204, ...SANS, fill: COLOR.ok }, `получено ${rub(e.page * BATCH)}`);
  }, fade(w, "guest"));
}

function drawService(pen: Pen, w: World): void {
  pen.group("svc", 0, 0, () => {
    panel(pen, "svc:box", { ...SERVICE, fill: "none", stroke: COLOR.line, shadow: false });
    pen.text("svc:title", { x: SERVICE.x + 16, y: SERVICE.y + SERVICE.h - 14, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Поды");
  }, fade(w, ...PODS));
  for (const id of PODS) {
    const { color, tint } = ACTOR[id];
    const busy = w.served.includes(id);
    pen.group(`pod:${id}`, POD_X, POD_Y[id], () => {
      bob(pen, `pod:${id}:bob`, { x: 0, y: 0, color, tint, letter: id, mood: busy ? "work" : "idle", look: { x: busy ? 1 : 0, y: 0 } });
    }, fade(w, id));
  }
}

/** Стрелки: гость → под → база для каждого нажатия кадра. */
function drawArrows(pen: Pen, w: World): void {
  for (const id of new Set(w.served)) {
    const y = POD_Y[id] + 32;
    const color = ACTOR[id].color;
    pen.line(`arr:${id}:in`, { x1: GUEST.x + GUEST.w, y1: GUEST.y + 40, x2: POD_X - 6, y2: y, stroke: COLOR.browser, "stroke-width": 2.5, marker: "arrow", ...fade(w, id), ...DRAW });
    pen.line(`arr:${id}:db`, { x1: POD_X + 68, y1: y, x2: DB.x - 6, y2: y, stroke: color, "stroke-width": 3, marker: "arrow", ...fade(w, id), ...DRAW });
  }
}

type Look = { fill?: string; stroke?: string; ink?: string; dash?: boolean; tie?: boolean };

/**
 * Строка с полями id, отель, цена — одна группа `row:id` и в таблице, и в результате: при смене кадра она переезжает
 * на новое место (таблица → порядок запроса, позиции съехали). Внутри — локальные координаты, y = 0 — верх строки.
 */
function drawRow(pen: Pen, w: World, o: Offer, i: number, look: Look, attrs: Record<string, string | number>, extra: (key: string) => void = () => {}): void {
  const key = `row:${o.id}`;
  pen.group(key, 0, rowY(i), () => {
    // Эффект изменения — на внутренней группе: у неё ключ на кадр, а у строки ключ один, чтобы она переезжала.
    const fresh = (o.moved && o.was === null && happened(w, "insert")) || (o.was !== null && happened(w, "update")) || (o.deleted && happened(w, "delete"));
    const [k, fx] = once(`${key}:in`, w.frame, fresh ? (o.deleted ? null : o.was !== null ? "fx-flash" : "fx-rise") : null);
    pen.group(k, 0, 0, () => {
      pen.rect(`${k}:bg`, {
        x: RESULT.x, y: 0, width: RESULT.w, height: ROW.h, rx: 5, fill: look.fill ?? COLOR.surface2, stroke: look.stroke ?? "none", "stroke-width": 2,
        ...(look.dash ? { "stroke-dasharray": "6 4" } : {}),
      });
      const ink = o.deleted ? COLOR.faint : look.ink ?? COLOR.ink;
      pen.text(`${k}:id`, { x: RESULT.x + 8, y: 20, ...MONO, fill: o.deleted ? COLOR.faint : COLOR.muted }, String(o.id));
      pen.text(`${k}:t`, { x: RESULT.x + 70, y: 20, ...SANS, fill: ink }, o.hotel);
      pen.text(`${k}:p`, { x: RESULT.x + RESULT.w - 10, y: 20, ...SANS, "text-anchor": "end", fill: ink }, `${rub(o.price)} ₽`);
      // Удалённая — зачёркнута линией: на кадре DELETE она прорисовывается.
      if (o.deleted) pen.line(`${k}:strike`, { x1: RESULT.x + 6, y1: ROW.h / 2, x2: RESULT.x + RESULT.w - 6, y2: ROW.h / 2, stroke: COLOR.warn, "stroke-width": 2.5, ...(fresh ? DRAW : {}) });
      // Ничья по цене — пунктир под ценой (амбер занят изменениями таблицы).
      if (look.tie) pen.line(`${k}:tie`, { x1: RESULT.x + RESULT.w - 84, y1: ROW.h - 3, x2: RESULT.x + RESULT.w - 10, y2: ROW.h - 3, stroke: COLOR.ink, "stroke-width": 2, "stroke-dasharray": "3 3" });
    }, fx);
    if (w.spot.includes(o.id)) pen.rect(`${key}:spot`, { x: RESULT.x - 5, y: -4, width: RESULT.w + 10, height: ROW.h + 8, rx: 8, fill: "none", stroke: COLOR.ink, "stroke-width": 2.5, class: "fx-pop d2" });
    extra(key);
  }, attrs);
}

/** Таблица `offers` как лежит: по id, новые — в конец, удалённые зачёркнуты на месте, у сменивших цену — прежняя. Показана, пока запрос не выполнился. */
function drawTable(pen: Pen, w: World): void {
  pen.text("table:t", { x: RESULT.x, y: TITLE_Y, ...SANS, "font-weight": 700, fill: COLOR.muted, class: "fx-fade", ...fade(w, "db") }, "таблица offers, как лежит");
  w.offers.forEach((o, i) => {
    const note = o.deleted ? "удалена" : o.was !== null ? `было ${rub(o.was)} ₽` : o.moved ? "новая строка" : null;
    drawRow(pen, w, o, i, { stroke: o.moved || o.deleted ? COLOR.warn : undefined }, fade(w, "db"), (key) => {
      if (note) pen.text(`${key}:new`, { x: SIDE_X, y: 20, ...SANS, "font-weight": 700, fill: COLOR.warn, class: "fx-slide d2" }, note);
    });
  });
}

/** Скобка справа от строк a…b: «отсчитал» / «взял» — одной формой, разным цветом; подпись — в поле справа. */
function bracket(pen: Pen, key: string, a: number, b: number, color: string, label: string, attrs: Record<string, string | number>): void {
  const x = RESULT.x + RESULT.w + 12;
  const [top, bottom] = [rowY(a) + 2, rowY(b) + ROW.h - 2];
  pen.group(key, 0, 0, () => {
    pen.path(`${key}:b`, { d: `M ${x} ${top} h 8 V ${bottom} h -8`, stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", ...DRAW });
    pen.text(`${key}:t`, { x: SIDE_X, y: (top + bottom) / 2 + 7, ...SANS, "font-weight": 700, fill: color, class: "fx-fade d2" }, label);
  }, attrs);
}

/**
 * Результат запроса `ORDER BY price, id` — только в кадре, где запрос выполнился. Ярко — страница, которую он отдал (в рамке),
 * остальное приглушено; отсчитанные OFFSET — номером и скобкой, закладка — флажком у значения, пропущенная — «Я здесь!»,
 * изменённая строка — амбер-пунктиром.
 */
function drawResult(pen: Pen, w: World): void {
  const rows = listing(w);
  const page = new Set(w.guest.pages.at(-1));
  const gone = new Set(w.ghost ? lost(w) : []);
  const late = new Set(behind(w));
  const doubled = new Set(dups(w));
  const twins = (o: Offer) => rows.filter((x) => x.price === o.price).length > 1;
  pen.text("result:t", { x: RESULT.x, y: TITLE_Y, ...SANS, "font-weight": 700, fill: COLOR.muted, class: "fx-fade" }, "результат запроса, не сама таблица");
  rows.forEach((o, i) => {
    const ghost = gone.has(o.id);
    const look: Look = {
      fill: ghost ? "none" : undefined, dash: ghost || (o.moved && !doubled.has(o.id) && !late.has(o.id)), ink: ghost ? COLOR.error : undefined,
      stroke: ghost || doubled.has(o.id) ? COLOR.error : late.has(o.id) || o.moved ? COLOR.warn : undefined,
      tie: twins(o) && lit(w, "twins") && !!w.focus,
    };
    drawRow(pen, w, o, i, look, { opacity: page.has(o.id) || ghost || late.has(o.id) ? 1 : DIM }, (key) => {
      const counted = w.counted.indexOf(o.id);
      if (counted >= 0) pen.text(`${key}:n`, { x: RESULT.x - 8, y: 20, ...MONO, "text-anchor": "end", "font-weight": 700, fill: COLOR.warn }, String(counted + 1));
      if (ghost) pen.text(`${key}:ghost`, { x: w.mark ? GHOST_X : SIDE_X, y: 20, ...SANS, "font-weight": 700, fill: COLOR.error, class: "fx-pop d3", ...fade(w, "ghost") }, "Я здесь!");
      if (late.has(o.id)) pen.text(`${key}:behind`, { x: SIDE_X, y: 20, ...SANS, fill: COLOR.warn, ...fade(w, "behind") }, "позади закладки");
    });
  });

  // Окно страницы: рамка вокруг того, что отдал запрос (появляется после переезда строк); у OFFSET — скобки «отсчитал / взял».
  const at = rows.map((o, i) => (page.has(o.id) ? i : -1)).filter((i) => i >= 0);
  if (at.length) {
    const [a, b] = [at[0], at.at(-1)!];
    const attrs = fade(w, "pages", "db");
    pen.rect("page", { x: RESULT.x - 4, y: rowY(a) - 3, width: RESULT.w + 8, height: rowY(b) - rowY(a) + ROW.h + 6, rx: 8, fill: "none", stroke: COLOR.ok, "stroke-width": 2.5, ...attrs });
    if (w.counted.length) bracket(pen, "take", a, b, COLOR.ok, `взял ${at.length}`, attrs);
  }
  if (w.counted.length) {
    const idx = w.counted.map((id) => rows.findIndex((o) => o.id === id));
    bracket(pen, "skip", Math.min(...idx), Math.max(...idx), COLOR.warn, `отсчитал ${w.counted.length}`, fade(w, "pages", "db"));
  }
  if (w.mark) {
    const i = rows.findIndex((o) => o.price === w.mark!.price && o.id === w.mark!.id);
    if (i >= 0) {
      const label: TextContent = w.mode === "pair"
        ? [{ text: rub(w.mark.price) }, { text: ` | ${w.mark.id}`, attrs: { "fill-opacity": 0.75 } }]
        : rub(w.mark.price);
      bookmark(pen, "mark", { x: RESULT.x + RESULT.w + 12, y: rowY(i) + ROW.h / 2, label, fresh: happened(w, "mark"), attrs: fade(w, "mark") });
    }
  }
}

/** Выгрузка: таблица `bookings` как лежит и рядом индекс `(created_at, id)` по порядку; выброшенное — красным, отданное — зелёным. */
function drawBookings(pen: Pen, w: World): void {
  const e = w.export!;
  pen.group("bookings", 0, 0, () => {
    pen.rect("bookings:box", { x: TABLE_X, y: SHELF.y, width: SHELF.w, height: SHELF.h, rx: 6, fill: COLOR.surface2, stroke: COLOR.line, "stroke-width": 2 });
    [0.09, 0.31, 0.38, 0.57, 0.71, 0.93].forEach((f, i) => {
      const y = SHELF.y + f * SHELF.h;
      pen.line(`bookings:r${i}`, { x1: TABLE_X + 8 + (i % 3) * 4, y1: y, x2: TABLE_X + SHELF.w - 8 - (i % 2) * 10, y2: y, stroke: COLOR.line, "stroke-width": 1.5 });
    });
    pen.text("bookings:t", { x: TABLE_X - 20, y: SHELF.y + SHELF.h + 34, ...MONO, fill: COLOR.muted }, "bookings");
  }, fade(w, "db"));
  pen.group("index", 0, 0, () => {
    pen.rect("index:box", { x: INDEX_X, y: SHELF.y, width: SHELF.w, height: SHELF.h, rx: 6, fill: COLOR.bg2, stroke: COLOR.ok, "stroke-width": 2 });
    for (let i = 1; i < 8; i++) {
      const y = SHELF.y + (i * SHELF.h) / 8;
      pen.line(`index:tick${i}`, { x1: INDEX_X + 8, y1: y, x2: INDEX_X + SHELF.w - 8, y2: y, stroke: COLOR.line, "stroke-width": 1.5 });
    }
    pen.text("index:t", { x: INDEX_X - 30, y: SHELF.y + SHELF.h + 34, ...MONO, fill: COLOR.ok }, "индекс (created_at, id)");
    pen.text("index:top", { x: INDEX_X + SHELF.w + 14, y: SHELF.y + 18, ...SANS, fill: COLOR.muted }, "первая бронь");
    if (e.mode === "offset") {
      drawPasses(pen, w);
      return;
    }
    const y = SHELF.y + Math.min((e.page - 1) * BATCH * (SHELF.h / BOOKINGS), SHELF.h - 8);
    pen.rect("index:sent", { x: INDEX_X - 6, y, width: SHELF.w + 12, height: 8, rx: 3, fill: COLOR.ok, class: "fx-pop" });
    bookmark(pen, "mark", {
      x: INDEX_X + SHELF.w + 10, y: y + 4, label: [{ text: "09:12:05" }, { text: " | 880412", attrs: { "fill-opacity": 0.75 } }],
      fresh: e.page === 1, attrs: fade(w, "mark"),
    });
  }, fade(w, "index", "db"));
  pen.group("count", 0, 0, () => {
    pen.text("count:page", { x: COUNT_X, y: DB.y + 90, ...SANS, fill: COLOR.muted }, `страница ${rub(e.page)}`);
    pen.text("count:read", { x: COUNT_X, y: DB.y + 130, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: e.read > e.sent ? COLOR.error : COLOR.ok }, `прочитано ${rub(e.read)}`);
    pen.text("count:sent", { x: COUNT_X, y: DB.y + 166, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.ok }, `отдано ${rub(e.sent)}`);
    if (e.read > e.sent) icon(pen, "count:trash", "trash", COUNT_X, DB.y + 200, 40, COLOR.error);
    if (e.mode === "offset" && e.page > 1) {
      pen.text("count:total:t", { x: COUNT_X, y: DB.y + 280, ...SANS, fill: COLOR.muted }, "за всю выгрузку");
      pen.text("count:total", { x: COUNT_X, y: DB.y + 312, ...SANS, "font-weight": 700, fill: COLOR.error }, `прочитано ${rub(e.total)}`);
    }
  }, fade(w, "db"));
}

/**
 * Проходы OFFSET: страница k читает индекс от первой брони — красное прочитано и выброшено, зелёный кончик отдан. Страницы 1–3
 * — крупно, каждая полоской рядом с прошлыми; на глубине — две короткие, «…» и одна во всю высоту. Новая прорисовывается сверху.
 */
function drawPasses(pen: Pen, w: World): void {
  const e = w.export!;
  const deep = e.page > 3;
  const scale = SHELF.h / (deep ? BOOKINGS : ZOOM);
  const pages = deep ? [1, 2, e.page] : Array.from({ length: e.page }, (_, i) => i + 1);
  if (!deep) {
    pen.text("pass:zoom", { x: INDEX_X + SHELF.w + 14, y: SHELF.y + 48, ...SANS, fill: COLOR.faint }, "крупно:");
    pen.text("pass:zoom2", { x: INDEX_X + SHELF.w + 14, y: SHELF.y + 72, ...SANS, fill: COLOR.faint }, `первые ${rub(ZOOM)}`);
  }
  pages.forEach((p, i) => {
    const x = PASS.x + (deep && p === e.page ? i + 1 : i) * PASS.step + PASS.w / 2;
    const thrown = (p - 1) * BATCH * scale;
    const sent = Math.max(BATCH * scale, 6);
    const last = p === e.page;
    const draw = last ? DRAW : {};
    const [k] = once(`pass:${p}`, w.frame, null);
    pen.group(k, 0, 0, () => {
      if (thrown >= 1) pen.line(`${k}:thrown`, { x1: x, y1: SHELF.y, x2: x, y2: SHELF.y + thrown, stroke: COLOR.error, "stroke-width": PASS.w, ...draw });
      pen.line(`${k}:sent`, { x1: x, y1: SHELF.y + thrown, x2: x, y2: SHELF.y + thrown + sent, stroke: COLOR.ok, "stroke-width": PASS.w, ...draw });
    }, { opacity: last ? 1 : DIM });
  });
  if (deep) pen.text("pass:all", { x: INDEX_X + SHELF.w + 14, y: SHELF.y + 60, ...SANS, fill: COLOR.muted, class: "fx-pop d2" }, "весь индекс");
  if (deep) pen.text("pass:more", { x: PASS.x + 2 * PASS.step + PASS.w / 2, y: SHELF.y + 40, ...SANS, "text-anchor": "middle", fill: COLOR.muted }, "…");
}

/**
 * Часть SQL, о которой говорит голос, — из состояния кадра: первая страница — порядок; OFFSET — отсчитать (амбер, как
 * скобка) и взять (зелёный, как рамка); закладка — условие. INSERT/DELETE/UPDATE — целиком.
 */
function sqlMark(w: World): SqlMark[] {
  const q = w.sql.join("\n");
  if (!q.startsWith("SELECT")) return [];
  const where = /WHERE .*/.exec(q);
  if (where) return [{ text: where[0].replace(/^WHERE /, "") }];
  const offset = / OFFSET \d+/.exec(q);
  if (w.export) return offset ? [{ text: offset[0].trim(), color: COLOR.warn }] : [];
  if (offset) return [{ text: offset[0].trim(), color: COLOR.warn }, { text: /LIMIT \d+/.exec(q)![0], color: COLOR.ok }];
  return [{ text: "ORDER BY price, id" }];
}

/** Цена закладки: на страницу 812 не прыгнуть. */
function drawJump(pen: Pen, w: World): void {
  pen.group("jump", 0, 0, () => {
    ["1", "2", "3", "…", "812"].forEach((p, i) => {
      const x = SQL_X + i * 60;
      pen.rect(`jump:p${i}`, { x, y: 560, width: 50, height: 40, rx: 8, fill: COLOR.surface2, stroke: p === "812" ? COLOR.error : COLOR.line, "stroke-width": 2 });
      pen.text(`jump:p${i}:t`, { x: x + 25, y: 587, ...SANS, "text-anchor": "middle", fill: p === "812" ? COLOR.error : COLOR.ink }, p);
    });
    pen.line("jump:cross", { x1: SQL_X + 236, y1: 554, x2: SQL_X + 294, y2: 606, stroke: COLOR.error, "stroke-width": 3, ...DRAW });
  }, fade(w, "pages"));
}

/** Итог: OFFSET и закладка по трём лампам; цена закладки — серой подписью. */
function drawMatrix(pen: Pen): void {
  const x = DB.x + 40;
  const lampX = [800, 940, 1080];
  pen.group("matrix", 0, 0, () => {
    CRITERIA.forEach((c, i) => pen.text(`matrix:h${i}`, { x: lampX[i], y: 190, ...SANS, "text-anchor": "middle", fill: COLOR.muted }, c));
    const rows: [string, "red" | "green"][] = [["OFFSET", "red"], ["закладка", "green"]];
    rows.forEach(([name, state], r) => {
      const y = 250 + r * 80;
      pen.text(`matrix:n${r}`, { x, y: y + 8, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.ink }, name);
      lampX.forEach((lx, i) => lamp(pen, `matrix:l${r}:${i}`, lx, y, state, 16));
    });
    pen.text("matrix:cost", { x, y: 370, ...SANS, fill: COLOR.muted }, "нет перехода на страницу N");
  });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  if (w.term) pill(pen, "term", w.term, { ...TERM, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.export) drawPartner(pen, w);
  else drawGuest(pen, w);
  drawService(pen, w);
  pen.group("db", 0, 0, () => panel(pen, "db:box", { ...DB, stroke: COLOR.postgres }));
  if (w.teaser) {
    // Тизер: только беда гостя, механику покажем потом.
    pen.text("teaser:q", { x: DB.x + DB.w / 2, y: DB.y + DB.h / 2 + 40, ...SANS, "font-size": 120, "font-weight": 700, "text-anchor": "middle", fill: COLOR.line }, "?");
  } else if (w.matrix) drawMatrix(pen);
  else if (w.export) drawBookings(pen, w);
  else if (w.order === "query") drawResult(pen, w);
  else drawTable(pen, w);
  if (!w.matrix && !w.teaser) drawArrows(pen, w);
  if (w.jump) drawJump(pen, w);
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: SQL_X, bottom: BOTTOM, mark: sqlMark(w), attrs: fade(w, "sql") });
  if (w.board) board(pen, w.board, { ...BOARD, lampX: LAMP_X, lampR: 13, dimIdle: true, attrs: fade(w, "board") });
  pen.layer("top", () => {
    if (w.guest.say && !w.export) bubble(pen, "guest:say", w.guest.say, { x: GUEST.x + 36, y: GUEST.y + 8, tail: "down", attrs: { class: "fx-pop", ...fade(w, "guest") } });
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + 60, right: TERM.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + 60, y: 40, tail: "left", attrs: { class: "fx-pop" } });
  });
}
