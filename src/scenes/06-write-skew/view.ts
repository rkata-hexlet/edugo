import { STAGE, type Pen } from "../../engine/contract";
import type { Board } from "../../kit/director";
import { BOB, bob, elephant, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { awning, buyButton, lock, person, PERSON, type PersonMood } from "../../kit/props";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { drawCode, render as render05 } from "../05-isolation/view";
import { recallWorld } from "./script";
import {
  ACTORS, CAP, boxes, overloaded, sees, slotTop,
  type Act, type Actor, type ActorId, type Focus, type Order, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра (Actor.acts).
// Сетка (1280×720): шапка; слева строка слота и заказы слота 7, под ними SQL; в центре поды; справа магазин с
// покупателями, под ним фургон курьера, ниже табло. Ниже SAFE_BOTTOM — пусто.
// Снимок пода — заказы, которых он не видит, бледные; метка чтения SERIALIZABLE — пунктирная рамка цвета пода вокруг
// заказов слота и места под новым (не замок: никого не держит); зависимость — дуга от чужой вставки.

const POD_Y: Record<ActorId, number> = { A: 150, B: 310 };
const POD = { x: 620 };
const POD_SCALE = 1.4;
const PB = { w: BOB.w * POD_SCALE, h: BOB.h * POD_SCALE };
const TABLE = { x: 40, y: 124, w: 400, rowH: 38, gap: 5 };
/** Заказы слота: под строкой слота (и её черновиком в 2.3). */
const ORDERS = { y: 240 };
const SHOP = { x: 996, y: 118, w: 248, h: 270 };
const CARD_TOP: Record<ActorId, number> = { A: 186, B: 278 };
const VAN = { x: 996, y: 398, w: 248 };
const BOARD = { x: 750, y: 512, w: 490, rowH: 26 };
const OVERLAY = { y: 124 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };
const HALO = { "paint-order": "stroke", stroke: COLOR.bg, "stroke-width": 6, "stroke-linejoin": "round" };
const BOX = { w: 30, h: 26 };

const rowY = (i: number) => ORDERS.y + i * (TABLE.rowH + TABLE.gap);
const slotY = (i: number) => TABLE.y + i * (TABLE.rowH + TABLE.gap);
const podMid = (id: ActorId) => POD_Y[id] + PB.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const did = (a: Actor, kind: Act["kind"]) => a.acts.some((x) => x.kind === kind);

/** Строка слота: последняя закоммиченная версия внизу, незакоммиченная (под замком) — над ней. */
function drawSlot(pen: Pen, w: World): void {
  pen.text("slot:hdr", { x: TABLE.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "slot") }, "slots · id 7");
  const top = slotTop(w);
  const draft = w.slot.length - 1 > top ? w.slot.length - 1 : null;
  const rows = draft !== null ? [draft, top] : [top];
  rows.forEach((i, n) => {
    const v = w.slot[i];
    const isDraft = v.at === null;
    const fresh = isDraft && happened(w, "write", v.by!);
    const [k, fx] = once(`slot:v${i}`, w.frame, fresh || (happened(w, "commit") && i === top && v.by) ? "fx-pop" : null);
    pen.group(k, TABLE.x, slotY(n), () => {
      pen.rect(`${k}:bg`, {
        width: TABLE.w, height: TABLE.rowH, rx: 6, fill: isDraft ? COLOR.draftBg : COLOR.surface,
        stroke: isDraft ? COLOR.warn : COLOR.line, "stroke-width": 1.5, ...(isDraft ? { "stroke-dasharray": "6 4" } : {}),
      });
      pen.text(`${k}:t`, { x: 14, y: 25, ...MONO, fill: COLOR.ink }, [
        { text: "18–20 · ", attrs: { fill: COLOR.muted } },
        { text: "cap ", attrs: { fill: COLOR.muted } },
        { text: `${CAP}`, attrs: { "font-weight": 700 } },
        ...(w.counter ? [{ text: " · booked ", attrs: { fill: COLOR.muted } }, { text: `${v.booked}`, attrs: { "font-weight": 700, fill: COLOR.warn } }] : []),
      ]);
      if (v.by) pen.rect(`${k}:who`, { x: 0, y: 0, width: 6, height: TABLE.rowH, rx: 3, fill: ACTOR[v.by].color });
      if (isDraft) {
        const [lockKey, shFx] = once(`${k}:lock`, w.frame, fresh ? "fx-lock" : null);
        lock(pen, lockKey, { x: TABLE.w - 32, y: 6, color: ACTOR[v.by!].color, shackle: shFx });
      }
    }, { ...fade(w, "slot"), ...(draft !== null && i === top ? { opacity: lit(w, "slot") ? 0.45 : DIM * 0.45 } : {}), ...fx });
  });
}

/** Заказы слота 7; не видные снимку пода `horizon` — бледные; метки чтения и дуги зависимостей SERIALIZABLE. */
function drawOrders(pen: Pen, w: World): void {
  pen.text("ord:hdr", { x: TABLE.x + 12, y: ORDERS.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "orders") }, "orders · slot_id 7");
  const id = w.horizon;
  if (id) pill(pen, `ord:eye:${id}`, `снимок ${id}`, { x: 330, y: ORDERS.y - 40, fill: COLOR.bg, color: ACTOR[id].color, stroke: ACTOR[id].color, attrs: { class: "fx-fade" } });
  let n = 0;
  w.orders.forEach((o, i) => {
    if (o.at !== null) n++;
    const extra = o.at !== null && n > CAP;
    const hidden = id !== null && w.actors[id].tx !== null && !sees(w, id, o);
    const fresh = happened(w, "insert", o.by ?? undefined) && o.by !== null && o.at === null;
    const [k, fx] = once(`ord:${i}`, w.frame, fresh ? "fx-slide" : extra && happened(w, "commit", o.by ?? undefined) ? "fx-shake" : null);
    pen.group(k, TABLE.x, rowY(i), () => drawOrder(pen, k, o, extra), { ...fade(w, "orders"), ...(hidden ? { opacity: 0.22 } : {}), ...fx });
  });
  drawMarks(pen, w);
  drawDeps(pen, w);
}

function drawOrder(pen: Pen, k: string, o: Order, extra: boolean): void {
  const draft = o.at === null;
  pen.rect(`${k}:bg`, {
    width: TABLE.w, height: TABLE.rowH, rx: 6, fill: extra ? COLOR.alarmBg : draft ? COLOR.draftBg : COLOR.surface,
    stroke: extra ? COLOR.error : draft ? COLOR.warn : COLOR.line, "stroke-width": 1.5, ...(draft ? { "stroke-dasharray": "6 4" } : {}),
  });
  pen.rect(`${k}:dot`, { x: 12, y: 13, width: 12, height: 12, rx: 6, fill: o.by ? ACTOR[o.by].color : COLOR.faint });
  pen.line(`${k}:perf`, { x1: 34, y1: 4, x2: 34, y2: TABLE.rowH - 4, stroke: COLOR.line, "stroke-width": 2, "stroke-dasharray": "3 4" });
  pen.text(`${k}:t`, { x: 46, y: 25, ...MONO, fill: COLOR.ink }, `заказ · ${o.who}`);
  if (extra) pen.group(`${k}:x`, TABLE.w - 96, 4, () => {
    pen.rect(`${k}:x:bg`, { x: 0, y: 0, width: 84, height: 30, rx: 5, fill: COLOR.alarmBg, stroke: COLOR.error, "stroke-width": 2 });
    pen.text(`${k}:x:t`, { x: 42, y: 21, ...SANS, "font-weight": 800, fill: COLOR.error, "text-anchor": "middle" }, "ЛИШНИЙ");
  }, { class: "fx-stamp" }, { rotate: -6, origin: [42, 15] });
}

/** Кто держит метку чтения: живая SERIALIZABLE-транзакция с прочитанным или закоммиченная, чья метка ещё жива. */
function marked(w: World, id: ActorId): boolean {
  const t = w.actors[id].tx;
  return (!!t && t.level === "SER" && t.mark) || !!w.marks[id];
}

/** Метка чтения: пунктирная рамка цвета пода вокруг прочитанных заказов и места, куда лёг бы новый. */
function drawMarks(pen: Pen, w: World): void {
  const visibleTo = (id: ActorId) => w.orders.filter((o) => o.at !== null || o.by === id).length;
  ACTORS.forEach((id, n) => {
    if (!marked(w, id)) return;
    const pad = 6 + n * 7;
    const rows = Math.max(visibleTo(id), w.orders.length) + (w.orders.length < 4 ? 1 : 0);
    const h = rows * (TABLE.rowH + TABLE.gap) - TABLE.gap;
    const color = ACTOR[id].color;
    pen.group(`mark:${id}`, 0, 0, () => {
      pen.rect(`mark:${id}:r`, {
        x: TABLE.x - pad, y: ORDERS.y - pad, width: TABLE.w + 2 * pad, height: h + 2 * pad, rx: 10,
        fill: "none", stroke: color, "stroke-width": 2.5, "stroke-dasharray": "4 6",
      });
      pill(pen, `mark:${id}:chip`, `прочитал ${id}`, { x: TABLE.x + 8 + n * 130, y: ORDERS.y + h + pad - 2, fill: COLOR.bg, color, stroke: color });
    }, { ...fade(w, "marks", id), ...(happened(w, "mark", id) ? { class: "fx-fade" } : {}) });
  });
  // Место под новый заказ — только пока метки на экране: туда целится предикат.
  if (ACTORS.some((id) => marked(w, id)) && w.orders.length < 4) {
    pen.rect("mark:slot", {
      x: TABLE.x, y: rowY(w.orders.length), width: TABLE.w, height: TABLE.rowH, rx: 6,
      fill: "none", stroke: COLOR.faint, "stroke-width": 1.5, "stroke-dasharray": "3 5", ...fade(w, "marks"),
    });
  }
}

/** Зависимость SSI: дуга от чужой вставки к строке читателя внутри таблицы; две встречные дуги — кольцо. */
function drawDeps(pen: Pen, w: World): void {
  const row = (by: ActorId) => w.orders.findIndex((o) => o.by === by);
  const cx = TABLE.x + TABLE.w - 70;
  for (const d of w.deps) {
    const i = row(d.writer);
    const j = row(d.reader);
    if (i < 0 || j < 0) continue;
    const y1 = rowY(i) + TABLE.rowH / 2;
    const y2 = rowY(j) + TABLE.rowH / 2;
    const r = Math.abs(y2 - y1) / 2;
    // Вставка A уходит к читателю B по правой дуге, вставка B к читателю A — по левой: вместе — круг.
    const sweep = y2 > y1 ? 1 : 0;
    pen.path(`dep:${d.writer}`, {
      d: `M ${cx} ${y1} A ${r + 8} ${r} 0 0 ${sweep} ${cx} ${y2}`,
      fill: "none", stroke: ACTOR[d.reader].color, "stroke-width": 3.5, marker: "arrow", ...DRAW, ...fade(w, "marks", "orders"),
    });
  }
  if (w.deps.length === 2 && ACTORS.every((id) => row(id) >= 0)) {
    const cy = (rowY(row("A")) + rowY(row("B"))) / 2 + TABLE.rowH / 2;
    pill(pen, "dep:ring", "кольцо", { x: cx - 130, y: cy - 15, fill: COLOR.bg, color: COLOR.warn, stroke: COLOR.warn, attrs: { class: "fx-pop", ...fade(w, "marks", "orders") } });
  }
}

/** Сверка у пода B после ожидания или на COMMIT: что проверила база и прошло ли. */
function drawCheck(pen: Pen, w: World): void {
  const c = w.check;
  if (!c) return;
  const color = c.ok ? COLOR.ok : COLOR.error;
  const width = pen.measure(c.text, MONO).width + 52;
  pen.group("check", POD.x - 10, POD_Y.B + PB.h + 22, () => {
    pen.rect("check:bg", { x: 0, y: 0, width, height: 34, rx: 8, fill: c.ok ? COLOR.doneBg : COLOR.alarmBg, stroke: color, "stroke-width": 1.5 });
    pen.text("check:t", { x: 10, y: 23, ...MONO, fill: COLOR.ink }, c.text);
    icon(pen, "check:i", c.ok ? "check" : "cross", width - 30, 6, 22, color);
  }, { class: c.ok ? "fx-pop" : "fx-shake", ...fade(w, "B") });
}

function podMood(w: World, a: Actor): Mood {
  if (a.tx?.waiting) return "wait";
  if (a.failed || happened(w, "busy", a.id)) return "lost";
  if (happened(w, "ok", a.id)) return "won";
  if (a.acts.length || a.tx) return "work";
  return "idle";
}

function podLook(w: World, a: Actor): Look {
  if (happened(w, "ok", a.id) || happened(w, "busy", a.id)) return { x: 1, y: 0 };
  if (a.acts.length || a.tx) return { x: -1, y: 0.2 };
  return { x: 0, y: 0 };
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(w, a);
  const failedNow = did(a, "fail");
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const oneShot = failedNow ? "fx-jolt" : happened(w, "busy", a.id) ? "fx-droop" : null;
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
    if (a.crossed) {
      const ty = a.failed ? 92 : 52;
      const b = bubble(pen, `pod:${a.id}:crossed`, a.crossed, { x: nx - 4, y: ty, tail: "left", thought: true, attrs: { opacity: 0.4 } });
      pen.line(`pod:${a.id}:strike`, { x1: nx + 8, y1: ty, x2: nx + 8 + b.w, y2: ty, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", pathLength: 1, class: "fx-draw" });
    }
  }, fade(w, a.id));
}

/** Стрелки пода: подсчёт — тонкая серая к заказам; вставка — толстая в цвете пода к своей строке; UPDATE слота — к слоту. */
function drawPodArrows(pen: Pen, w: World): void {
  const edge = TABLE.x + TABLE.w + 8;
  for (const id of ACTORS) {
    const a = w.actors[id];
    const from = { x: POD.x - 8, y: podMid(id) };
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const mine = w.orders.findIndex((o) => o.by === id);
    const slotRow = { x: edge, y: slotY(0) + TABLE.rowH / 2 };
    a.acts.forEach((x, n) => {
      const key = `arr:${id}:${n}`;
      const base = { x1: from.x, y1: from.y - 12 + n * 8, "stroke-linecap": "round", marker: "arrow", opacity: op };
      if (x.kind === "count") {
        const ty = ORDERS.y + 20 + (id === "A" ? 0 : 20);
        pen.line(key, { ...base, x2: edge, y2: ty, stroke: COLOR.muted, "stroke-width": 2, ...DRAW });
        pen.text(`${key}:t`, { x: from.x - 30, y: from.y - 26 + n * 8 + (id === "A" ? 0 : 14), ...SANS, fill: COLOR.muted, "font-weight": 700, "text-anchor": "end", opacity: op, ...HALO }, `count = ${x.seen}`);
      } else if (x.kind === "insert" && mine >= 0) {
        pen.line(key, { ...base, x2: edge, y2: rowY(mine) + TABLE.rowH / 2, stroke: color, "stroke-width": 4, ...DRAW });
      } else if (x.kind === "write") {
        pen.line(key, { ...base, x2: slotRow.x, y2: slotRow.y + 4, stroke: color, "stroke-width": 4, ...DRAW });
      } else if (x.kind === "wait" && a.tx?.waiting) {
        pen.line(key, { ...base, x2: slotRow.x + 6, y2: slotRow.y + 14, stroke: color, "stroke-width": 2.5, "stroke-dasharray": "7 6", class: "fx-march" });
      } else if (x.kind === "zero") {
        pen.line(key, { ...base, x2: slotRow.x, y2: slotRow.y + 8, stroke: COLOR.muted, "stroke-width": 2.5, ...DRAW });
        const lx = from.x + (slotRow.x - from.x) * 0.7;
        const ly = from.y + (slotRow.y - from.y) * 0.7;
        pen.text(`${key}:t`, { x: lx + 14, y: ly + 6, ...SANS, fill: COLOR.muted, "font-weight": 700, opacity: op, ...HALO }, "0 строк");
      } else if (x.kind === "fail") {
        const ty = ORDERS.y + 60;
        pen.line(key, { ...base, x2: edge, y2: ty, stroke: COLOR.error, "stroke-width": 3, ...DRAW });
        const cx = (from.x + edge) / 2;
        const cy = (from.y + ty) / 2;
        pen.rect(`${key}:xb`, { x: cx - 15, y: cy - 15, width: 30, height: 30, rx: 15, fill: COLOR.bg, opacity: op });
        icon(pen, `${key}:x`, "cross", cx - 12, cy - 12, 24, COLOR.error, { opacity: op });
      }
    });
    if (happened(w, "ok", id) || happened(w, "busy", id)) {
      const ok = happened(w, "ok", id);
      pen.line(`arr:${id}:shop`, {
        x1: POD.x + PB.w + 150, y1: podMid(id) + 20, x2: SHOP.x - 8, y2: CARD_TOP[id] + 40,
        stroke: ok ? color : COLOR.muted, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow", ...DRAW, ...fade(w, "shop", id),
      });
    }
  }
}

const MOOD: Record<string, PersonMood> = { idle: "idle", press: "idle", wait: "idle", ok: "happy", busy: "sad" };

/** Магазин: навес, покупатели в цвете своих подов, кнопка «Заказать», ответ магазина. */
function drawShop(pen: Pen, w: World): void {
  const x = SHOP.x;
  panel(pen, "shop:box", { x, y: SHOP.y, w: SHOP.w, h: SHOP.h, stroke: COLOR.browser, attrs: fade(w, "shop") });
  pen.group("shop", 0, 0, () => {
    awning(pen, "shop:awning", { x, y: SHOP.y, w: SHOP.w });
    pen.text("shop:title", { x: x + 16, y: SHOP.y + 54, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.browser }, "Магазин");
    for (const c of w.customers) {
      const top = CARD_TOP[c.pod];
      const changed = happened(w, c.status === "ok" ? "ok" : c.status === "busy" ? "busy" : "press", c.pod);
      const [k, fx] = once(`shop:${c.pod}`, w.frame, changed ? "fx-pop" : null);
      const tx = x + 16 + PERSON.w + 12;
      person(pen, `shop:${c.pod}:who`, {
        x: x + 16, y: top + 8, shirt: ACTOR[c.pod].color, mood: MOOD[c.status],
        look: c.status === "idle" ? { x: 0, y: -1 } : c.status === "ok" || c.status === "busy" ? { x: 1, y: 0 } : { x: -1, y: 0 },
      });
      pen.text(`shop:${c.pod}:n`, { x: tx, y: top + 26, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, c.name);
      pen.group(k, 0, 0, () => {
        if (c.status === "press") buyButton(pen, `${k}:buy`, { x: tx, y: top + 38, pressed: true });
        if (c.status === "wait") iconText(pen, `${k}:s`, "hourglass", tx, top + 60, "ждёт…", COLOR.warn, { ...SANS, "font-weight": 600 });
        if (c.status === "ok") iconText(pen, `${k}:s`, "check", tx, top + 60, "Заказ принят", COLOR.ok, { ...SANS, "font-weight": 600 });
        if (c.status === "busy") iconText(pen, `${k}:s`, "cross", tx, top + 60, "Слот занят", COLOR.muted, { ...SANS, "font-weight": 600 });
      }, fx);
    }
  }, fade(w, "shop"));
}

/** Фургон курьера: коробки в кузове по закоммиченным заказам слота; четвёртая — на крыше, кузов просел. */
function drawVan(pen: Pen, w: World): void {
  const n = boxes(w);
  const over = overloaded(w);
  const x = VAN.x;
  const y = VAN.y;
  const bodyY = y + 40;
  const sag = over ? 6 : 0;
  const [k, fx] = once("van", w.frame, happened(w, "overload") ? "fx-shake" : null);
  pen.group(k, 0, 0, () => {
    pill(pen, "van:count", `${n} из ${CAP}`, over
      ? { x, y, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error }
      : { x, y, fill: COLOR.bg, color: COLOR.muted, stroke: COLOR.line });
    // Нить-вопрос: пока исход открыт (транзакции идут, курьер ещё не перегружен) — «?» над фургоном.
    if (!over && (w.courierTalk || ACTORS.some((id) => w.actors[id].tx))) icon(pen, "van:doubt", "question", x + 150, y + 2, 26, COLOR.warn, { class: "fx-pulse" });
    pen.group("van:body", 0, sag, () => {
      pen.rect("van:cargo", { x, y: bodyY, width: 150, height: 52, rx: 6, fill: COLOR.surface2, stroke: over ? COLOR.error : COLOR.line, "stroke-width": 2 });
      pen.rect("van:cab", { x: x + 152, y: bodyY + 12, width: 44, height: 40, rx: 8, fill: COLOR.surface2, stroke: COLOR.line, "stroke-width": 2 });
      pen.rect("van:win", { x: x + 164, y: bodyY + 18, width: 24, height: 14, rx: 3, fill: COLOR.bg2 });
      for (let i = 0; i < CAP; i++) {
        const filled = i < Math.min(n, CAP);
        pen.rect(`van:slot${i}`, {
          x: x + 12 + i * 46, y: bodyY + 14, width: BOX.w, height: BOX.h, rx: 3,
          fill: filled ? COLOR.mugRim : "none", stroke: filled ? COLOR.mug : COLOR.faint, "stroke-width": 1.5,
          ...(filled ? {} : { "stroke-dasharray": "3 4" }),
        });
      }
      // Лишняя коробка — на крыше, с красным контуром: в кузов не влезла.
      if (over) pen.group("van:extra", x + 100, bodyY - BOX.h - 2, () =>
        pen.rect("van:extra:b", { width: BOX.w, height: BOX.h, rx: 3, fill: COLOR.mugRim, stroke: COLOR.error, "stroke-width": 2.5 }),
      { class: "fx-hop" }, { rotate: -10, origin: [15, 13] });
    });
    [x + 34, x + 166].forEach((cx, i) => pen.rect(`van:wheel${i}`, { x: cx - 13, y: bodyY + 40, width: 26, height: 26, rx: 13, fill: COLOR.bg, stroke: COLOR.muted, "stroke-width": 3 }));
    // Курьер у кабины: растерян при перегрузе, доволен, когда слот закрыт честно.
    const mood: PersonMood = over ? "sad" : n === CAP && !ACTORS.some((id) => w.actors[id].tx) ? "happy" : "idle";
    person(pen, "van:courier", { x: x + 204, y: bodyY + 4, shirt: COLOR.warn, mood, look: over ? { x: -1, y: -1 } : { x: -1, y: 0 } });
  }, { ...fade(w, "courier"), ...fx });
}

function firstOnly(b: Board): Board {
  return { ...b, criteria: [b.criteria[0], ""], attempts: b.attempts.map((a) => ({ ...a, lamps: a.lamps && [a.lamps[0], null] })) };
}

function drawHeader(pen: Pen, w: World): void {
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "fail") || happened(w, "zero") ? "fx-nod" : null);
  const busy = ["insert", "write", "commit", "zero", "fail"].some((k) => happened(w, k as SimEvent["kind"]));
  const look = w.db ? { x: 1, y: 0.2 } : busy ? { x: 0.3, y: 1 } : { x: 0, y: 0 };
  const frown = happened(w, "fail") || happened(w, "zero");
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08, look, frown }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", "КЕЙС", { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

export function render(pen: Pen, w: World): void {
  // Вспомним 05: его кадр его же отрисовкой; поверх — только штамп перемотки.
  if (w.flashback !== null) {
    render05(pen, recallWorld(w.flashback));
    pen.layer("top", () => {
      if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: POD.x - 12 });
    });
    return;
  }
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawSlot(pen, w);
  drawOrders(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board) board(pen, w.costShown ? w.board : firstOnly(w.board), { ...BOARD, lampX: [225, 410], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") });
  drawPodArrows(pen, w);
  drawShop(pen, w);
  drawVan(pen, w);
  drawCheck(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    if (w.code) pen.rect("scrim", { x: 0, y: OVERLAY.y - 8, width: STAGE.w, height: SAFE_BOTTOM - OVERLAY.y + 8, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
    drawCode(pen, w.code);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: POD.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}
