import { STAGE, type Pen } from "../../engine/contract";
import { bob, elephant } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { buyButton, mug, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
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
const SIDE_X = 920;
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
const BOARD = { x: 700, y: 490, w: 540, rowH: 26 };
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
      }
      const key = `guest:c${p}:${id}`;
      pen.rect(key, { x: phone.x + 8, y, width: phone.w - 16, height: 24, rx: 5, fill: dup ? COLOR.alarmBg : COLOR.surface2, stroke: dup ? COLOR.error : "none", "stroke-width": 2, class: p === last && p ? "fx-slide" : "" });
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

/** Строка с полями id, отель, цена — одинаково в таблице и в результате запроса. */
function drawRow(pen: Pen, key: string, o: Offer, y: number, look: { fill?: string; stroke?: string; ink?: string; dash?: boolean } = {}): void {
  pen.rect(`${key}:bg`, {
    x: RESULT.x, y, width: RESULT.w, height: ROW.h, rx: 5, fill: look.fill ?? COLOR.surface2, stroke: look.stroke ?? "none", "stroke-width": 2,
    ...(look.dash ? { "stroke-dasharray": "6 4" } : {}),
  });
  const ink = look.ink ?? COLOR.ink;
  const strike: Record<string, string> = o.deleted ? { "text-decoration": "line-through" } : {};
  pen.text(`${key}:id`, { x: RESULT.x + 8, y: y + 20, ...MONO, fill: o.deleted ? COLOR.faint : COLOR.muted, ...strike }, String(o.id));
  pen.text(`${key}:t`, { x: RESULT.x + 70, y: y + 20, ...SANS, fill: o.deleted ? COLOR.faint : ink, ...strike }, o.hotel);
  pen.text(`${key}:p`, { x: RESULT.x + RESULT.w - 10, y: y + 20, ...SANS, "text-anchor": "end", fill: o.deleted ? COLOR.faint : ink, ...strike }, `${rub(o.price)} ₽`);
}

/** Таблица `offers` как лежит: по id, новые — в конец, удалённые зачёркнуты на месте, у сменивших цену — прежняя. Показана, пока запрос не выполнился. */
function drawTable(pen: Pen, w: World): void {
  pen.group("table", 0, 0, () => {
    pen.text("table:t", { x: RESULT.x, y: TITLE_Y, ...SANS, "font-weight": 700, fill: COLOR.muted }, "таблица offers, как лежит");
    w.offers.forEach((o, i) => {
      const changed = o.moved || o.deleted;
      const fresh = (o.moved && happened(w, "insert")) || (o.was !== null && happened(w, "update")) || (o.deleted && happened(w, "delete"));
      const [k, fx] = once(`table:${o.id}`, w.frame, fresh ? "fx-pop" : null);
      pen.group(k, 0, 0, () => drawRow(pen, k, o, rowY(i), { stroke: changed ? COLOR.warn : undefined }), fx);
      const note = o.deleted ? "удалена" : o.was !== null ? `было ${rub(o.was)} ₽` : o.moved ? "новая строка" : null;
      if (note) pen.text(`${k}:new`, { x: SIDE_X, y: rowY(i) + 20, ...SANS, "font-weight": 700, fill: COLOR.warn }, note);
    });
  }, fade(w, "db"));
}

/**
 * Результат запроса `ORDER BY price, id` — только в кадре, где запрос выполнился. Ярко — страница, которую он отдал (в рамке),
 * остальное приглушено; отсчитанные OFFSET — номером, закладка — флажком у значения, пропущенная — «Я здесь!».
 */
function drawResult(pen: Pen, w: World): void {
  const rows = listing(w);
  const page = new Set(w.guest.pages.at(-1));
  const gone = new Set(w.ghost ? lost(w) : []);
  const late = new Set(behind(w));
  const twins = (o: Offer) => rows.filter((x) => x.price === o.price).length > 1;
  pen.text("result:t", { x: RESULT.x, y: TITLE_Y, ...SANS, "font-weight": 700, fill: COLOR.muted }, "результат запроса, не сама таблица");
  rows.forEach((o, i) => {
    const y = rowY(i);
    const ghost = gone.has(o.id);
    const twin = twins(o);
    pen.group(`r:${o.id}`, 0, 0, () => {
      drawRow(pen, `r:${o.id}`, o, y, {
        fill: ghost ? "none" : undefined, dash: ghost, ink: ghost ? COLOR.error : twin && lit(w, "twins") && w.focus ? COLOR.warn : undefined,
        stroke: ghost || dups(w).includes(o.id) ? COLOR.error : late.has(o.id) ? COLOR.warn : undefined,
      });
    }, { opacity: page.has(o.id) || ghost || late.has(o.id) ? 1 : DIM });
    const counted = w.counted.indexOf(o.id);
    if (counted >= 0) pen.text(`r:${o.id}:n`, { x: RESULT.x - 8, y: y + 20, ...MONO, "text-anchor": "end", "font-weight": 700, fill: COLOR.warn }, String(counted + 1));
    if (ghost) pen.text(`ghost:${o.id}`, { x: w.mark ? GHOST_X : SIDE_X, y: y + 20, ...SANS, "font-weight": 700, fill: COLOR.error, class: "fx-pop", ...fade(w, "ghost") }, "Я здесь!");
    if (late.has(o.id)) pen.text(`behind:${o.id}`, { x: SIDE_X, y: y + 20, ...SANS, fill: COLOR.warn, ...fade(w, "behind") }, "позади закладки");
  });

  // Окно страницы: рамка вокруг того, что отдал запрос; у OFFSET — сколько отсчитал.
  const at = rows.map((o, i) => (page.has(o.id) ? i : -1)).filter((i) => i >= 0);
  if (at.length) {
    const [a, b] = [at[0], at.at(-1)!];
    pen.rect("page", { x: RESULT.x - 4, y: rowY(a) - 3, width: RESULT.w + 8, height: rowY(b) - rowY(a) + ROW.h + 6, rx: 8, fill: "none", stroke: COLOR.ok, "stroke-width": 2.5, ...fade(w, "pages", "db") });
    if (w.guest.pages.length > 1 && !w.mark) pen.text("page:t", { x: SIDE_X, y: rowY((a + b) / 2) + 20, ...SANS, fill: COLOR.ok, ...fade(w, "pages", "db") }, `взял ${at.length}`);
  }
  if (w.counted.length) {
    const mid = (w.counted.length - 1) / 2;
    pen.text("count:t", { x: SIDE_X, y: rowY(mid) + 20, ...SANS, "font-weight": 700, fill: COLOR.warn, ...fade(w, "pages", "db") }, `отсчитал ${w.counted.length}`);
  }
  if (w.mark) {
    const i = rows.findIndex((o) => o.price === w.mark!.price && o.id === w.mark!.id);
    if (i >= 0) {
      const y = rowY(i) + ROW.h / 2;
      const label = w.mode === "pair" ? `${rub(w.mark.price)} | ${w.mark.id}` : rub(w.mark.price);
      pen.group("mark", 0, 0, () => {
        pen.line("mark:pole", { x1: RESULT.x + RESULT.w + 4, y1: y, x2: SIDE_X, y2: y, stroke: COLOR.ok, "stroke-width": 3 });
        pill(pen, "mark:t", label, { x: SIDE_X, y: y - 16, fill: COLOR.doneBg, color: COLOR.ok, stroke: COLOR.ok, mono: true });
      }, fade(w, "mark"));
    }
  }
}

/** Выгрузка: таблица `bookings` как лежит и рядом индекс `(created_at, id)` по порядку; выброшенное — красным, отданное — зелёным. */
function drawBookings(pen: Pen, w: World): void {
  const e = w.export!;
  pen.group("bookings", 0, 0, () => {
    pen.rect("bookings:box", { x: TABLE_X, y: SHELF.y, width: SHELF.w, height: SHELF.h, rx: 6, fill: COLOR.surface2, stroke: COLOR.line, "stroke-width": 2 });
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
    pill(pen, "mark:t", "09:12:05 | 880412", { x: INDEX_X + SHELF.w + 14, y: y - 12, fill: COLOR.doneBg, color: COLOR.ok, stroke: COLOR.ok, mono: true, attrs: fade(w, "mark") });
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
  if (deep) pen.text("pass:more", { x: PASS.x + 2 * PASS.step + PASS.w / 2, y: SHELF.y + 40, ...SANS, "text-anchor": "middle", fill: COLOR.muted }, "…");
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
  } else if (w.matrix) drawMatrix(pen);
  else if (w.export) drawBookings(pen, w);
  else if (w.order === "query") drawResult(pen, w);
  else drawTable(pen, w);
  if (!w.matrix && !w.teaser) drawArrows(pen, w);
  if (w.jump) drawJump(pen, w);
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: SQL_X, bottom: BOTTOM, attrs: fade(w, "sql") });
  if (w.board) board(pen, w.board, { ...BOARD, lampX: LAMP_X, attrs: fade(w, "board") });
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
