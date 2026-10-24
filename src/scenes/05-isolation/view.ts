import { STAGE, type Pen, type Span } from "../../engine/contract";
import type { Board } from "../../kit/director";
import { BOB, bob, elephant, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SAFE_BOTTOM, SIZE, SQL_COLOR } from "../../kit/theme";
import { awning, buyButton, lock, MUG, mug, person, PERSON, type PersonMood } from "../../kit/props";
import { highlightSql } from "../../kit/sql";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { clock } from "./script";
import { ACTORS, STOCK, latest, type Act, type Actor, type ActorId, type Focus, type SimEvent, type World } from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра (Actor.acts).
// Сетка (1280×720): шапка; слева строка товара стопкой версий (новая сверху) и таблица orders, под ними SQL;
// в центре поды; справа магазин с покупателями и табло. Ниже SAFE_BOTTOM — пусто.
// Снимок REPEATABLE READ — пунктирная линия цвета пода над версиями, которых транзакция не видит.

const POD_Y: Record<ActorId, number> = { A: 150, B: 310 };
const POD = { x: 620 };
/** Поды крупнее «боба» серии: середина кадра не пустует (motion-designer). */
const POD_SCALE = 1.4;
const PB = { w: BOB.w * POD_SCALE, h: BOB.h * POD_SCALE };
const TABLE = { x: 40, y: 124, w: 400, rowH: 38, gap: 5 };
const ORDERS = { y: 312 };
/** Витрина: навес, вывеска, полка (пока о ней говорят) и карточки покупателей напротив своих подов. */
const SHOP = { x: 996, y: 118, w: 248, h: 350 };
const CARD_TOP: Record<ActorId, number> = { A: 250, B: 360 };
const CARD_Y: Record<ActorId, number> = { A: CARD_TOP.A + 30, B: CARD_TOP.B + 30 };
const BOARD = { x: 750, y: 486, w: 490, rowH: 26 };
/** Оверлеи (код, вставка 01, лесенка): под ярлыком акта, на скриме поверх сцены. */
const OVERLAY = { y: 124 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };
/** Ореол фона вокруг подписи на линии. */
const HALO = { "paint-order": "stroke", stroke: COLOR.bg, "stroke-width": 6, "stroke-linejoin": "round" };

const rowY = (p: number) => TABLE.y + p * (TABLE.rowH + TABLE.gap);
const orderY = (i: number) => ORDERS.y + i * (TABLE.rowH + TABLE.gap);
const podMid = (id: ActorId) => POD_Y[id] + PB.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const did = (a: Actor, kind: Act["kind"]) => a.acts.some((x) => x.kind === kind);
const name = (w: World, id: ActorId) => w.customers.find((c) => c.pod === id)!.name;

/** Какие версии строки на экране: стопкой — все, новая сверху; без стопки — одна строка таблицы. */
function shown(w: World): number[] {
  const all = w.versions.map((_, i) => i).reverse();
  return w.stack ? all : [all[0]];
}

/** Строка экрана, где нарисована версия i (без стопки — всё в одной строке). */
function slot(w: World, i: number): number {
  return w.stack ? w.versions.length - 1 - i : 0;
}

function drawRow(pen: Pen, w: World): void {
  pen.text("row:hdr", { x: TABLE.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "row") }, "products · id 7 · Кружка");
  const top = latest(w);
  pen.group(`rows:${w.scene}`, 0, 0, () => {
    for (const i of shown(w)) {
      const v = w.versions[i];
      const draft = v.at === null;
      const old = w.stack && !draft && i !== top;
      const created = w.actors.A.acts.concat(w.actors.B.acts).some((x) => x.kind === "write" && x.version === i) || happened(w, "commit");
      const [k, fx] = once(`row:v${i}`, w.frame, created && (draft || i === top) ? "fx-pop" : null);
      pen.group(k, TABLE.x, rowY(slot(w, i)), () => {
        pen.rect(`${k}:bg`, {
          width: TABLE.w, height: TABLE.rowH, rx: 6, fill: draft ? COLOR.draftBg : COLOR.surface,
          stroke: draft ? COLOR.warn : COLOR.line, "stroke-width": 1.5, ...(draft ? { "stroke-dasharray": "6 4" } : {}),
        });
        // Без стопки — одна строка: незакоммиченный 0 под замком, без «1 → 0» (строку не правят на месте, tech-expert).
        const value = `${v.stock}`;
        pen.text(`${k}:t`, { x: 14, y: 25, ...MONO, fill: COLOR.ink }, [
          { text: "stock ", attrs: { fill: COLOR.muted } },
          { text: value, attrs: { "font-weight": 700 } },
        ]);
        // Полоска слева — цвет автора версии (цвет = кто).
        if (v.by) pen.rect(`${k}:who`, { x: 0, y: 0, width: 6, height: TABLE.rowH, rx: 3, fill: ACTOR[v.by].color });
        if (draft) {
          // Замок своей отрисовкой: дужка защёлкивается в кадре записи.
          const [lockKey, shFx] = once(`${k}:lock`, w.frame, happened(w, "write", v.by!) ? "fx-lock" : null);
          lock(pen, lockKey, { x: TABLE.w - 32, y: 6, color: ACTOR[v.by!].color, shackle: shFx });
          if (w.stack) pen.text(`${k}:note`, { x: TABLE.w - 44, y: 25, ...SANS, fill: COLOR.warn, "text-anchor": "end" }, "не закоммичено");
        } else if (w.stack && v.by) {
          // Автор — значком пода, время коммита — рядом, если часы на экране.
          pen.rect(`${k}:badge`, { x: TABLE.w - 36, y: 6, width: 26, height: 26, rx: 13, fill: ACTOR[v.by].color });
          pen.text(`${k}:badge:t`, { x: TABLE.w - 23, y: 25, ...SANS, "font-weight": 700, fill: COLOR.bg, "text-anchor": "middle" }, v.by);
          if (w.clockShown) pen.text(`${k}:note`, { x: TABLE.w - 46, y: 25, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, clock(v.at!));
        } else if (w.stack && w.clockShown) {
          pen.text(`${k}:note`, { x: TABLE.w - 14, y: 25, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, clock(v.at!));
        }
      }, { ...fade(w, "row"), ...(old ? { opacity: lit(w, "row") ? 0.45 : DIM * 0.45 } : {}), ...fx });
    }
  }, happened(w, "page") ? { class: "fx-cascade" } : {});
  drawSnapshots(pen, w);
  drawCheck(pen, w);
}

/** Что база перепроверила в условии UPDATE после ожидания: прошло (зелёным) или нет (красным). */
function drawCheck(pen: Pen, w: World): void {
  const c = w.check;
  if (!c) return;
  const color = c.ok ? COLOR.ok : COLOR.error;
  // Под подом B, а не на стрелках: это его условие перепроверила база (motion-designer).
  const width = pen.measure(c.text, MONO).width + 52;
  pen.group("check", POD.x - 10, POD_Y.B + PB.h + 22, () => {
    pen.rect("check:bg", { x: 0, y: 0, width, height: 34, rx: 8, fill: c.ok ? COLOR.doneBg : COLOR.alarmBg, stroke: color, "stroke-width": 1.5 });
    pen.text("check:t", { x: 10, y: 23, ...MONO, fill: COLOR.ink }, c.text);
    icon(pen, "check:i", c.ok ? "check" : "cross", width - 30, 6, 22, color);
  }, { class: c.ok ? "fx-pop" : "fx-shake" }); // условие не прошло — плашка вздрагивает
}

/** Снимок транзакции на REPEATABLE READ: линия над версиями, которых она не видит. */
function drawSnapshots(pen: Pen, w: World): void {
  const id = w.horizon;
  if (!w.stack || !id) return;
  // Снимок держится и после 40001 (до нового BEGIN): в кадре отказа видно, что новая версия выше него.
  const snap = w.actors[id].seen;
  if (snap === null) return;
  let seen = w.versions.length - 1;
  while (seen > 0 && !(w.versions[seen].at !== null && w.versions[seen].at! <= snap)) seen--;
  const y = rowY(slot(w, seen)) - TABLE.gap / 2 - 1;
  const color = ACTOR[id].color;
  const top = rowY(0) - 4;
  // Ключ — момент снимка: новый снимок проявляется заново, прежний держится без движения.
  pen.group(`snap:${id}:${snap}`, 0, 0, () => {
    // Вуаль над линией — версии, которых транзакция не видит; подпись — чипом в шапке таблицы, не на стрелках.
    if (y > top) pen.rect(`snap:${id}:veil`, { x: TABLE.x - 10, y: top, width: TABLE.w + 20, height: y - top, rx: 4, fill: color, opacity: 0.1 });
    pen.line(`snap:${id}:l`, { x1: TABLE.x - 10, y1: y, x2: TABLE.x + TABLE.w + 10, y2: y, stroke: color, "stroke-width": 3, "stroke-dasharray": "10 6" });
    pill(pen, `snap:${id}:chip`, `снимок ${id} · ${clock(snap)}`, { x: 330, y: TABLE.y - 40, fill: COLOR.bg, color, stroke: color, mono: true });
  }, { ...fade(w, id, "row"), class: "fx-fade" });
}

function drawOrders(pen: Pen, w: World): void {
  pen.text("ord:hdr", { x: TABLE.x + 12, y: ORDERS.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "orders") }, "orders");
  if (!w.orders.length) {
    pen.text("ord:empty", { x: TABLE.x + 14, y: ORDERS.y + 25, ...SANS, fill: COLOR.faint, ...fade(w, "orders") }, "пусто");
    return;
  }
  let sold = 0;
  w.orders.forEach((o, i) => {
    if (o.committed) sold++;
    const extra = o.committed && sold > STOCK;
    const fresh = happened(w, "insert", o.by) && i === w.orders.length - 1;
    const [k, fx] = once(`ord:${i}`, w.frame, fresh ? "fx-slide" : extra && happened(w, "commit", o.by) ? "fx-shake" : null);
    pen.group(k, TABLE.x, orderY(i), () => {
      pen.rect(`${k}:bg`, {
        width: TABLE.w, height: TABLE.rowH, rx: 6, fill: extra ? COLOR.alarmBg : o.committed ? COLOR.surface : COLOR.draftBg,
        stroke: extra ? COLOR.error : o.committed ? COLOR.line : COLOR.warn, "stroke-width": 1.5, ...(o.committed ? {} : { "stroke-dasharray": "6 4" }),
      });
      // Билетик: кружок цвета пода, вставившего заказ, и перфорация.
      pen.rect(`${k}:dot`, { x: 12, y: 13, width: 12, height: 12, rx: 6, fill: ACTOR[o.by].color });
      pen.line(`${k}:perf`, { x1: 34, y1: 4, x2: 34, y2: TABLE.rowH - 4, stroke: COLOR.line, "stroke-width": 2, "stroke-dasharray": "3 4" });
      pen.text(`${k}:t`, { x: 46, y: 25, ...MONO, fill: COLOR.ink }, `заказ ${i + 1} · ${name(w, o.by)}`);
      // «Лишний» — красный штамп наискось.
      if (extra) pen.group(`${k}:x`, TABLE.w - 96, 4, () => {
        pen.rect(`${k}:x:bg`, { x: 0, y: 0, width: 84, height: 30, rx: 5, fill: COLOR.alarmBg, stroke: COLOR.error, "stroke-width": 2 });
        pen.text(`${k}:x:t`, { x: 42, y: 21, ...SANS, "font-weight": 800, fill: COLOR.error, "text-anchor": "middle" }, "ЛИШНИЙ");
      }, happened(w, "commit", o.by) ? { class: "fx-stamp" } : {}, { rotate: -6, origin: [42, 15] });
    }, { ...fade(w, "orders"), ...fx });
  });
}

function podMood(w: World, a: Actor): Mood {
  if (a.tx?.waiting) return "wait";
  if (a.failed || happened(w, "none", a.id)) return "lost";
  if (happened(w, "ok", a.id)) return "won";
  if (a.acts.length || a.tx) return "work";
  return "idle";
}

function podLook(w: World, a: Actor): Look {
  if (happened(w, "ok", a.id) || happened(w, "none", a.id)) return { x: 1, y: 0 };
  if (a.acts.length || a.tx) return { x: -1, y: -0.6 };
  return { x: 0, y: 0 };
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(w, a);
  const failedNow = did(a, "fail");
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    // Отказ — вздрогнул; «нет в наличии» — сник; ждёт — дышит (единственный цикл пода, держит «ждёт»).
    const oneShot = failedNow ? "fx-jolt" : happened(w, "none", a.id) ? "fx-droop" : null;
    const [fxKey, fxOnce] = once(`pod:${a.id}:fx`, w.frame, oneShot);
    const fxAttrs = oneShot ? fxOnce : mood === "wait" ? { class: "fx-breathe" } : {};
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood, look: podLook(w, a), dashed: mood === "wait" }), fxAttrs, { scale: POD_SCALE });
    const nx = PB.w + 14;
    pen.text(`pod:${a.id}:label`, { x: nx, y: 20, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: color }, a.label);
    if (a.failed) {
      pill(pen, `pod:${a.id}:err`, "40001 · откат", { x: nx, y: 34, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, attrs: failedNow ? { class: "fx-pop" } : {} });
    } else if (a.retried && happened(w, "retry", a.id)) {
      pen.group(`pod:${a.id}:retry`, nx, 34, () => {
        pen.group(`pod:${a.id}:retry:spin`, 0, 0, () => icon(pen, `pod:${a.id}:retry:i`, "replay", 0, 2, 24, COLOR.warn), { class: "fx-spin" });
        pen.text(`pod:${a.id}:retry:t`, { x: 30, y: 20, ...SANS, fill: COLOR.warn, "font-weight": 700 }, "заново");
      }, { class: "fx-pop" });
    } else if (a.thought) {
      bubble(pen, `pod:${a.id}:think`, a.thought, { x: nx - 4, y: 52, tail: "left", thought: true });
    }
    // Опровергнутая мысль: зачёркнута красным в кадре отказа.
    if (a.crossed) {
      const ty = a.failed ? 92 : 52;
      const b = bubble(pen, `pod:${a.id}:crossed`, a.crossed, { x: nx - 4, y: ty, tail: "left", thought: true, attrs: { opacity: 0.4 } });
      pen.line(`pod:${a.id}:strike`, { x1: nx + 8, y1: ty, x2: nx + 8 + b.w, y2: ty, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", pathLength: 1, class: "fx-draw" });
    }
  }, fade(w, a.id));
}

/** Стрелки пода к строке: прочитал — тонкая серая к версии; записал — толстая в цвете пода; ждёт — пунктир. */
function drawPodArrows(pen: Pen, w: World): void {
  for (const id of ACTORS) {
    const a = w.actors[id];
    const from = { x: POD.x - 8, y: podMid(id) };
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const to = (i: number) => ({ x: TABLE.x + TABLE.w + 8, y: rowY(slot(w, i)) + TABLE.rowH / 2 });
    const top = { x: TABLE.x + TABLE.w + 8, y: rowY(0) + TABLE.rowH / 2 };
    a.acts.forEach((x, n) => {
      const key = `arr:${id}:${n}`;
      // Концы стрелок разнесены по высоте: чтение выше, запись по центру, ожидание ниже — наконечники не сливаются.
      const base = { x1: from.x, y1: from.y - 12 + n * 8, "stroke-linecap": "round", marker: "arrow", opacity: op };
      if (x.kind === "read") {
        const t = to(x.version);
        pen.line(key, { ...base, x2: t.x, y2: t.y - 8, stroke: COLOR.muted, "stroke-width": 2, ...DRAW });
      } else if (x.kind === "write") {
        const t = to(x.version);
        pen.line(key, { ...base, x2: t.x, y2: t.y + 4, stroke: color, "stroke-width": 4, ...DRAW });
      } else if (x.kind === "wait" && a.tx?.waiting) {
        pen.line(key, { ...base, x2: top.x + 6, y2: top.y + 14, stroke: color, "stroke-width": 2.5, "stroke-dasharray": "7 6", class: "fx-march" });
      } else if (x.kind === "zero") {
        pen.line(key, { ...base, x2: top.x, y2: top.y + 8, stroke: COLOR.muted, "stroke-width": 2.5, ...DRAW });
        // Подпись ближе к концу стрелки, с ореолом фона — линия её не режет.
        const lx = from.x + (top.x - from.x) * 0.72;
        const ly = from.y + (top.y - from.y) * 0.72;
        pen.text(`${key}:t`, { x: lx + 14, y: ly + 6, ...SANS, fill: COLOR.muted, "font-weight": 700, opacity: op, ...HALO }, "0 строк");
      } else if (x.kind === "fail") {
        pen.line(key, { ...base, x2: top.x, y2: top.y + 8, stroke: COLOR.error, "stroke-width": 3, ...DRAW });
        const cx = (from.x + top.x) / 2;
        const cy = (from.y + top.y) / 2;
        pen.rect(`${key}:xb`, { x: cx - 15, y: cy - 15, width: 30, height: 30, rx: 15, fill: COLOR.bg, opacity: op });
        icon(pen, `${key}:x`, "cross", cx - 12, cy - 12, 24, COLOR.error, { opacity: op });
      }
    });
    // Итог для покупателя: подтверждение или «нет в наличии».
    if (happened(w, "ok", id) || happened(w, "none", id)) {
      const ok = happened(w, "ok", id);
      pen.line(`arr:${id}:shop`, {
        x1: POD.x + PB.w + 150, y1: podMid(id) + 20, x2: SHOP.x - 8, y2: CARD_Y[id] + 10,
        stroke: ok ? color : COLOR.muted, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow", ...DRAW, ...fade(w, "shop", id),
      });
    }
  }
}

/** Чей заказ лишний: закоммичен сверх того, что было на складе. */
function extraBy(w: World): ActorId | null {
  const committed = w.orders.filter((o) => o.committed);
  return committed.length > STOCK ? committed[STOCK].by : null;
}

const MOOD: Record<string, PersonMood> = { idle: "idle", press: "idle", wait: "idle", ok: "happy", none: "sad" };

/** Магазин: витрина с навесом; покупатель — аватар в цвете своего пода, кнопка «Купить», кружка у того, кому её продали. */
function drawShop(pen: Pen, w: World): void {
  const x = SHOP.x;
  panel(pen, "shop:box", { x, y: SHOP.y, w: SHOP.w, h: SHOP.h, stroke: COLOR.browser, attrs: fade(w, "shop") });
  pen.group("shop", 0, 0, () => {
    awning(pen, "shop:awning", { x, y: SHOP.y, w: SHOP.w });
    pen.text("shop:title", { x: x + 16, y: SHOP.y + 58, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.browser }, "Магазин");
    if (w.showcase) {
      // Полка: последняя кружка — только в кадре, где о ней говорят.
      mug(pen, "shop:shelf:mug", { x: x + 18, y: SHOP.y + 84, attrs: { class: "fx-pop" } });
      pen.rect("shop:shelf", { x: x + 10, y: SHOP.y + 122, width: SHOP.w - 20, height: 4, rx: 2, fill: COLOR.line });
      pill(pen, "shop:left", `осталось ${w.versions[latest(w)].stock}`, { x: x + 88, y: SHOP.y + 88, fill: COLOR.bg, color: COLOR.warn, stroke: COLOR.warn });
    }
    const extra = extraBy(w);
    for (const c of w.customers) {
      const top = CARD_TOP[c.pod];
      const changed = happened(w, c.status === "ok" ? "ok" : c.status === "none" ? "none" : "press", c.pod);
      const [k, fx] = once(`shop:${c.pod}`, w.frame, changed ? "fx-pop" : null);
      const tx = x + 16 + PERSON.w + 12;
      person(pen, `shop:${c.pod}:who`, {
        x: x + 16, y: top + 8, shirt: ACTOR[c.pod].color, mood: MOOD[c.status],
        look: c.status === "idle" ? { x: 0, y: -1 } : c.status === "ok" || c.status === "none" ? { x: 1, y: 0 } : { x: -1, y: 0 },
      });
      pen.text(`shop:${c.pod}:n`, { x: tx, y: top + 26, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, c.name);
      pen.group(k, 0, 0, () => {
        if (c.status === "press") buyButton(pen, `${k}:buy`, { x: tx, y: top + 38, pressed: true });
        if (c.status === "wait") iconText(pen, `${k}:s`, "hourglass", tx, top + 60, "ждёт…", COLOR.warn, { ...SANS, "font-weight": 600 });
        if (c.status === "ok") {
          iconText(pen, `${k}:s`, "check", tx, top + 60, "Заказ принят", COLOR.ok, { ...SANS, "font-weight": 600 });
          // Кружка у покупателя; у лишнего заказа — только контур: подтверждение есть, кружки нет (рифма с хуком).
          mug(pen, `${k}:mug`, { x: x + SHOP.w - MUG.w - 14, y: top + 4, ghost: extra === c.pod, attrs: { class: "fx-slide" } });
        }
        if (c.status === "none") {
          iconText(pen, `${k}:s`, "cross", tx, top + 60, "Нет в наличии", COLOR.muted, { ...SANS, "font-weight": 600 });
          // Сквозной гэг: Борису «нет в наличии» — и стикер «скоро завезём».
          pill(pen, `${k}:sticker`, "скоро завезём", { x: tx, y: top + 72, fill: COLOR.warn, color: COLOR.bg, attrs: { class: "fx-stamp" } });
        }
      }, fx);
    }
  }, fade(w, "shop"));
}

/** Вставка эпизода 01: та же развилка в очереди задач — B и C дождались коммита A, условие перепроверено. */
function drawFlashback(pen: Pen, w: World): void {
  if (!w.flashback) return;
  const x = (STAGE.w - 700) / 2;
  const y = OVERLAY.y;
  pen.group("fb", 0, 0, () => {
    panel(pen, "fb:box", { x, y, w: 700, h: 360, fill: COLOR.bg2, stroke: COLOR.muted });
    pen.text("fb:title", { x: x + 24, y: y + 40, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, "Эпизод 01 · очередь задач");
    const rows = [["#1", "in_progress", "A"], ["#2", "new", null], ["#3", "new", null]] as const;
    rows.forEach(([id, status, by], i) => {
      const ry = y + 64 + i * 44;
      pen.rect(`fb:r${i}`, { x: x + 24, y: ry, width: 330, height: 38, rx: 6, fill: by ? COLOR.doneBg : COLOR.surface, stroke: COLOR.line, "stroke-width": 1.5 });
      pen.text(`fb:r${i}:t`, { x: x + 38, y: ry + 25, ...MONO, fill: COLOR.ink }, `${id}  status ${status}`);
      if (by) pen.text(`fb:r${i}:by`, { x: x + 340, y: ry + 25, ...SANS, fill: ACTOR.A.color, "text-anchor": "end", "font-weight": 700 }, "A");
    });
    (["B", "C"] as const).forEach((id, i) => {
      const bx = x + 410 + i * 150;
      bob(pen, `fb:${id}`, { x: bx, y: y + 84, color: ACTOR[id].color, tint: ACTOR[id].tint, letter: id, mood: "lost", look: { x: -1, y: 0 } });
      pen.text(`fb:${id}:t`, { x: bx + 32, y: y + 180, ...SANS, fill: COLOR.muted, "font-weight": 700, "text-anchor": "middle" }, "0 строк");
    });
    pen.text("fb:sql", { x: x + 24, y: y + 260, ...MONO, fill: COLOR.ink }, [
      { text: "UPDATE tasks SET status = 'in_progress'\n" },
      { text: "  WHERE id = 1 AND status = 'new'" },
    ]);
  }, { class: "fx-fade" });
}

/** Лесенка уровней изоляции Postgres снизу вверх: пройденные — ярко, остальные — с короткой пометкой. */
const LADDER = [
  { name: "READ UNCOMMITTED", note: "в Postgres = READ COMMITTED", seen: false },
  { name: "READ COMMITTED", note: "по умолчанию", seen: true },
  { name: "REPEATABLE READ", note: "снимок на транзакцию", seen: true },
  { name: "SERIALIZABLE", note: "как будто по очереди", seen: false },
];

function drawLadder(pen: Pen, w: World): void {
  if (!w.ladder) return;
  const x = 300;
  const y = OVERLAY.y;
  pen.group("ladder", 0, 0, () => {
    panel(pen, "ladder:box", { x, y, w: 680, h: 380, fill: COLOR.bg2, stroke: COLOR.muted });
    pen.text("ladder:title", { x: x + 24, y: y + 40, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, "Уровни изоляции в Postgres");
    LADDER.forEach((l, i) => {
      const sy = y + 300 - i * 70;
      const sx = x + 24 + i * 40;
      pen.group(`ladder:s${i}`, 0, 0, () => {
        pen.rect(`ladder:s${i}:bg`, {
          x: sx, y: sy, width: 632 - i * 40, height: 56, rx: 10, fill: l.seen ? COLOR.surface2 : COLOR.surface,
          stroke: l.seen ? COLOR.ok : COLOR.line, "stroke-width": l.seen ? 2.5 : 1.5,
        });
        pen.text(`ladder:s${i}:n`, { x: sx + 18, y: sy + 35, ...MONO, "font-size": SIZE.say, "font-weight": 700, fill: l.seen ? COLOR.ink : COLOR.muted }, l.name);
        pen.text(`ladder:s${i}:t`, { x: x + 640, y: sy + 35, ...SANS, fill: l.seen ? COLOR.ok : COLOR.muted, "text-anchor": "end" }, l.note);
      }, { class: "fx-rise" });
    });
    // Наши поды стоят на ступени, до которой дошли, — REPEATABLE READ.
    const rr = { x: x + 22, y: y + 300 - 2 * 70 + 10 };
    ACTORS.forEach((id, i) =>
      pen.group(`ladder:pod:${id}`, rr.x + i * 34, rr.y, () =>
        bob(pen, `ladder:pod:${id}:bob`, { x: 0, y: 0, color: ACTOR[id].color, tint: ACTOR[id].tint, letter: id, mood: "idle", look: { x: 1, y: 0 } }), { class: "fx-hop" }, { scale: 0.5 }));
  }, { class: "fx-fade" });
}

/** Строк в самом длинном фрагменте кода — по нему высота окна. */
const CODE_LINES = 10;

const GO_KEYWORDS = /^(if|var|for|func|return|break|range|else)$/;

/** Строки Go: SQL внутри `…` — подсветкой SQL, снаружи — ключевые слова Go. Строка-литерал может тянуться на несколько строк. */
function highlightGo(lines: string[]): Span[][] {
  let inside = false;
  return lines.map((line) => {
    const spans: Span[] = [];
    line.split("`").forEach((part, i) => {
      if (i > 0) {
        spans.push({ text: "`", attrs: { fill: SQL_COLOR.string } });
        inside = !inside;
      }
      if (!part) return;
      if (inside) spans.push(...highlightSql(part));
      else for (const m of part.matchAll(/([A-Za-z_]\w*)|(\d+)|([^A-Za-z_\d]+)/g)) {
        const fill = m[1] && GO_KEYWORDS.test(m[1]) ? SQL_COLOR.keyword : m[2] ? SQL_COLOR.number : COLOR.ink;
        spans.push({ text: m[0], attrs: { fill } });
      }
    });
    return spans;
  });
}

/** Код пода на Go: окно поверх сцены, подсвеченные строки — где беда (жёлтым) или что поправили (зелёным). */
function drawCode(pen: Pen, w: World): void {
  const c = w.code;
  if (!c) return;
  // Окно одного размера во всех кадрах кода: при смене кадра меняются только подсвеченные строки.
  const lineH = 34;
  const x = 200;
  const y = OVERLAY.y;
  const h = 76 + CODE_LINES * lineH + 8;
  pen.group("code", 0, 0, () => {
    panel(pen, "code:box", { x, y, w: 880, h, fill: "#11172e", stroke: COLOR.muted });
    pen.text("code:title", { x: x + 28, y: y + 40, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, c.title);
    highlightGo(c.lines).forEach((spans, i) => {
      const ly = y + 86 + i * lineH;
      const mark = c.mark.find((m) => m.line === i);
      if (mark) {
        const tone = mark.tone === "warn" ? COLOR.warn : COLOR.ok;
        pen.rect(`code:m${i}`, { x: x + 16, y: ly - 24, width: 848, height: lineH - 2, rx: 4, fill: mark.tone === "warn" ? COLOR.draftBg : COLOR.doneBg, class: "fx-fade" });
        pen.rect(`code:b${i}`, { x: x + 16, y: ly - 24, width: 4, height: lineH - 2, fill: tone });
        if (mark.note) pill(pen, `code:n${i}`, mark.note, { x: x + 856 - pen.measure(mark.note, SANS).width - 28, y: ly - 22, fill: COLOR.bg, color: tone, stroke: tone, attrs: { class: "fx-pop" } });
      }
      pen.text(`code:l${i}`, { x: x + 32, y: ly, ...MONO, "font-size": SIZE.say }, spans);
    });
  }, { class: "fx-fade" });
}

/** Табло до кадра цены: только первый критерий — второй («без повтора») зритель ещё не понимает. */
function firstOnly(b: Board): Board {
  return { ...b, criteria: [b.criteria[0], ""], attempts: b.attempts.map((a) => ({ ...a, lamps: a.lamps && [a.lamps[0], null] })) };
}

function drawHeader(pen: Pen, w: World): void {
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "fail") || happened(w, "zero") ? "fx-nod" : null);
  // Слон смотрит туда, где событие: на таблицу под ним, когда пишут; на поды, когда отвечает. Отказ — хмурится.
  const busy = ["write", "commit", "zero", "fail"].some((k) => happened(w, k as SimEvent["kind"]));
  const look = w.db ? { x: 1, y: 0.2 } : busy ? { x: 0.3, y: 1 } : { x: 0, y: 0 };
  const frown = happened(w, "fail") || happened(w, "zero");
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08, look, frown }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", "КЕЙС", { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!w.clockShown) return;
  pen.group("clock", 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
  }, fade(w, "clock"));
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawRow(pen, w);
  drawOrders(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board) board(pen, w.costShown ? w.board : firstOnly(w.board), { ...BOARD, lampX: [225, 410], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") }); // SQL — только где его надо прочитать
  drawPodArrows(pen, w);
  drawShop(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    // Скрим под оверлеями: сцена не торчит по краям окна; шапку, ярлык и пустой низ кадра не трогает.
    if (w.code || w.flashback || w.ladder) pen.rect("scrim", { x: 0, y: OVERLAY.y - 8, width: STAGE.w, height: SAFE_BOTTOM - OVERLAY.y + 8, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
    drawFlashback(pen, w);
    drawLadder(pen, w);
    drawCode(pen, w);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: POD.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}

