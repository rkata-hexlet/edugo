import { STAGE, type Attrs, type Pen, type Span } from "../../engine/contract";
import { BOB, bob, elephant, type Hands, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { buyButton, lock, person, PERSON, type PersonMood } from "../../kit/props";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { drawCode, render as render05 } from "../05-isolation/view";
import { CODE_ROWS, recallWorld } from "./script";
import {
  ACTORS, deadlocked, held, holder, product,
  type Actor, type ActorId, type Aside, type Focus, type Product, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки и замки — только из состояния кадра.
// Сетка (1280×720): шапка (слон, секундомер deadlock_timeout); слева products и orders, под ними SQL; в центре поды
// с порядком обхода корзины; справа магазин с корзинами покупателей, ниже табло. Ниже SAFE_BOTTOM — пусто.
// Замок на строке — цвета пода, держится до COMMIT; ожидание — сплошная стрелка пода к чужому замку.

const POD_Y: Record<ActorId, number> = { A: 150, B: 330 };
const POD = { x: 556 };
const POD_SCALE = 1.4;
const PB = { w: BOB.w * POD_SCALE, h: BOB.h * POD_SCALE };
const TABLE = { x: 40, y: 124, w: 400, rowH: 44, gap: 6 };
const ORDERS = { y: 264 };
const SHOP = { x: 996, y: 118, w: 248, h: 330 };
const CARD_TOP: Record<ActorId, number> = { A: 176, B: 300 };
const BOARD = { x: 750, y: 512, w: 490, rowH: 26 };
const OVERLAY = { y: 124 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };
const WATCH = { x: 300, y: 78 };
/** Значок кейса и ярлык акта — в правой колонке над магазином: в шапке им тесно с репликой Postgres. */
export const CHAPTER = { x: 1150, y: 22 };
const TERM = { x: 996, y: 76 };
/** Правый край шапки для реплики Postgres и штампа перемотки. */
export const HEADER_RIGHT = CHAPTER.x - 12;

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const rowY = (i: number) => TABLE.y + i * (TABLE.rowH + TABLE.gap);
const orderY = (i: number) => ORDERS.y + i * (TABLE.rowH + TABLE.gap);
const rowOf = (w: World, id: number) => w.products.findIndex((p) => p.id === id);
const podMid = (id: ActorId) => POD_Y[id] + PB.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));

/** Строки products: остаток, под замком — «10 → 9» и замок цвета пода. */
function drawProducts(pen: Pen, w: World): void {
  pen.text("prod:hdr", { x: TABLE.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "products") }, "products");
  w.products.forEach((p, i) => drawProduct(pen, w, p, i));
}

function drawProduct(pen: Pen, w: World, p: Product, i: number): void {
  const by = p.draft?.by ?? null;
  const fresh = !!by && w.actors[by].acts.some((a) => a.kind === "write" && a.id === p.id);
  const ring = deadlocked(w);
  const [k, fx] = once(`prod:${p.id}`, w.frame, fresh ? "fx-pop" : null);
  pen.group(k, TABLE.x, rowY(i), () => {
    pen.rect(`${k}:bg`, {
      width: TABLE.w, height: TABLE.rowH, rx: 6, fill: by ? COLOR.draftBg : COLOR.surface,
      stroke: ring ? COLOR.error : by ? ACTOR[by].color : COLOR.line, "stroke-width": by ? 2 : 1.5,
      ...(ring ? { "stroke-dasharray": "7 5", class: "fx-march" } : {}),
    });
    if (ring && happened(w, "ring")) {
      pen.rect(`${k}:halo:${w.frame}`, { x: TABLE.w - 43, y: 3, width: 36, height: 36, rx: 18, fill: COLOR.error, opacity: 0.25, class: "fx-pulse" });
    }
    pen.text(`${k}:t`, { x: 14, y: 28, ...MONO, fill: COLOR.ink }, [
      { text: `id ${p.id} · `, attrs: { fill: COLOR.muted } },
      { text: p.name },
      { text: " · stock ", attrs: { fill: COLOR.muted } },
      { text: `${p.stock}`, attrs: { "font-weight": 700 } },
      ...(p.draft ? [{ text: ` → ${p.draft.stock}`, attrs: { "font-weight": 700, fill: COLOR.warn } }] : []),
    ]);
    if (by) {
      const [lk, sh] = once(`${k}:lock`, w.frame, fresh ? "fx-lock" : null);
      lock(pen, lk, { x: TABLE.w - 36, y: 9, color: ACTOR[by].color, shackle: sh });
    }
    // Откат: списание пода, которого прервали, вернулось на склад — пунктирный чип его цвета уходит от строки.
    const undone = ACTORS.find((id) => w.actors[id].acts.some((a) => a.kind === "fail" && a.undone.includes(p.id)));
    if (undone) {
      pen.group(`${k}:undo:${w.frame}`, TABLE.w + 14, 6, () => {
        pen.rect(`${k}:undo:bg`, { width: 92, height: 32, rx: 16, fill: COLOR.bg, stroke: ACTOR[undone].color, "stroke-width": 2, "stroke-dasharray": "5 4" });
        pen.text(`${k}:undo:t`, { x: 46, y: 22, ...SANS, "font-weight": 700, fill: ACTOR[undone].color, "text-anchor": "middle" }, "откат");
      }, { class: "fx-rise d1" });
    }
  }, { ...fade(w, "products"), ...fx });
}

/** Заказы: строка на каждый оформленный заказ; незакоммиченный — пунктиром. */
function drawOrders(pen: Pen, w: World): void {
  if (!w.orders.length) return;
  pen.text("ord:hdr", { x: TABLE.x + 12, y: ORDERS.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "orders") }, "orders");
  w.orders.forEach((o, i) => {
    const k = `ord:${i}`;
    const draft = o.at === null;
    pen.group(k, TABLE.x, orderY(i), () => {
      pen.rect(`${k}:bg`, {
        width: TABLE.w, height: TABLE.rowH, rx: 6, fill: draft ? COLOR.draftBg : COLOR.surface,
        stroke: draft ? COLOR.warn : COLOR.line, "stroke-width": 1.5, ...(draft ? { "stroke-dasharray": "6 4" } : {}),
      });
      pen.rect(`${k}:dot`, { x: 12, y: 16, width: 12, height: 12, rx: 6, fill: ACTOR[o.by].color });
      pen.text(`${k}:t`, { x: 36, y: 28, ...MONO, fill: COLOR.ink }, `заказ · ${o.who}`);
    }, { ...fade(w, "orders"), ...(happened(w, "commit", o.by) ? { class: "fx-slide" } : {}) });
  });
}

/** Стрелки пода: запись — толстая к строке; ожидание — сплошная к чужому замку, пока ждёт; цикл — пилюля между ними. */
function drawArrows(pen: Pen, w: World): void {
  const edge = TABLE.x + TABLE.w + 8;
  for (const id of ACTORS) {
    const a = w.actors[id];
    const color = ACTOR[id].color;
    const op = fade(w, id).opacity;
    const from = { x: POD.x - 8, y: podMid(id) };
    a.acts.forEach((x, n) => {
      if (x.kind !== "write") return;
      const r = rowOf(w, x.id);
      pen.line(`arr:${id}:${n}`, {
        x1: from.x, y1: from.y - 10 + n * 10, x2: edge, y2: rowY(r) + TABLE.rowH / 2 - 6 + n * 6,
        stroke: color, "stroke-width": 4, "stroke-linecap": "round", marker: "arrow", opacity: op, ...DRAW,
      });
    });
    const waiting = a.tx?.waiting ?? null;
    if (waiting !== null) {
      const r = rowOf(w, waiting);
      pen.line(`wait:${id}`, {
        x1: from.x, y1: from.y + 10, x2: TABLE.x + TABLE.w - 12, y2: rowY(r) + TABLE.rowH / 2 + 8,
        stroke: color, "stroke-width": 4, "stroke-linecap": "round", marker: "arrow", opacity: op,
        ...(happened(w, "wait", id) ? DRAW : {}),
      });
    }
  }
  if (deadlocked(w)) {
    // Кольцо между подами: A ждёт B и B ждёт A — две красные дуги навстречу.
    const cx = POD.x + PB.w / 2;
    const top = POD_Y.A + PB.h + 4;
    const bottom = POD_Y.B - 22;
    const drawn = happened(w, "ring") ? DRAW : {};
    const arc = { fill: "none", stroke: COLOR.error, "stroke-width": 4, "stroke-linecap": "round", marker: "arrow", ...fade(w, "A", "B") };
    pen.path("ring:down", { d: `M ${cx - 22} ${top} Q ${cx - 70} ${(top + bottom) / 2} ${cx - 22} ${bottom}`, ...arc, ...drawn });
    pen.path("ring:up", { d: `M ${cx + 22} ${bottom} Q ${cx + 70} ${(top + bottom) / 2} ${cx + 22} ${top}`, ...arc, ...drawn });
    pill(pen, "ring", "цикл", {
      x: cx - 32, y: (top + bottom) / 2 - 16, fill: COLOR.bg, color: COLOR.error, stroke: COLOR.error,
      attrs: { ...(happened(w, "ring") ? { class: "fx-pop d1" } : {}), ...fade(w, "A", "B") },
    });
  }
}

function podMood(w: World, a: Actor): Mood {
  if (a.tx?.waiting !== null && a.tx?.waiting !== undefined) return "wait";
  if (a.failed) return "lost";
  if (happened(w, "ok", a.id)) return "won";
  if (a.acts.length || a.tx) return "work";
  return "idle";
}

function podLook(w: World, a: Actor): Look {
  if (happened(w, "ok", a.id)) return { x: 1, y: 0 };
  if (a.acts.length || a.tx) return { x: -1, y: -0.2 };
  return { x: 0, y: 0 };
}

/** Руки пода, пока идёт транзакция: замки, которые он держит; в кольце — скрещены. Пустые руки ждущего — «держать нечего». */
function podHands(w: World, a: Actor): Hands | undefined {
  if (!a.tx) return undefined;
  return { pose: deadlocked(w) ? "crossed" : "open", locks: held(w, a.id).length, lockColor: ACTOR[a.id].color };
}

/** Порядок обхода корзины: строки под замком пода — его цветом, ждёт — жёлтым, остальное — серым. */
function planSpans(w: World, a: Actor): Span[] {
  return a.plan.flatMap((id, i) => {
    const mine = holder(w, id) === a.id;
    const waits = a.tx?.waiting === id;
    const name = product(w, id).name;
    const attrs: Attrs = mine
      ? { fill: ACTOR[a.id].color, "font-weight": 700 }
      : waits ? { fill: COLOR.warn, "font-weight": 700 } : { fill: COLOR.muted };
    return [...(i ? [{ text: " → ", attrs: { fill: COLOR.faint } }] : []), { text: name, attrs }];
  });
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(w, a);
  const failedNow = a.acts.some((x) => x.kind === "fail");
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxOnce] = once(`pod:${a.id}:fx`, w.frame, failedNow ? "fx-jolt" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood, look: podLook(w, a), dashed: mood === "wait", hands: podHands(w, a) }),
    failedNow ? fxOnce : mood === "wait" ? { class: "fx-breathe" } : {}, { scale: POD_SCALE });
    const nx = PB.w + 36;
    pen.text(`pod:${a.id}:label`, { x: nx, y: 20, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: color }, a.label);
    pen.text(`pod:${a.id}:plan`, { x: nx, y: 48, ...SANS }, planSpans(w, a));
    if (a.failed) {
      pill(pen, `pod:${a.id}:err`, "40P01 · откат", { x: nx, y: 62, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, attrs: failedNow ? { class: "fx-pop" } : {} });
    } else if (a.retried && happened(w, "retry", a.id)) {
      pen.group(`pod:${a.id}:retry`, nx, 62, () => {
        pen.group(`pod:${a.id}:retry:spin`, 0, 0, () => icon(pen, `pod:${a.id}:retry:i`, "replay", 0, 2, 24, COLOR.warn), { class: "fx-spin" });
        pen.text(`pod:${a.id}:retry:t`, { x: 30, y: 20, ...SANS, fill: COLOR.warn, "font-weight": 700 }, "заново");
      }, { class: "fx-pop" });
    } else if (a.thought) {
      bubble(pen, `pod:${a.id}:think`, a.thought, { x: nx - 4, y: 84, tail: "left", thought: true });
    }
    if (a.crossed) {
      const ty = 118;
      const b = bubble(pen, `pod:${a.id}:crossed`, a.crossed, { x: nx - 4, y: ty, tail: "left", thought: true, attrs: { opacity: 0.4 } });
      pen.line(`pod:${a.id}:strike`, { x1: nx + 8, y1: ty, x2: nx + 8 + b.w, y2: ty, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", ...DRAW });
    }
  }, fade(w, a.id));
}

/** Сверка у пода B после ожидания: что перепроверила база и прошло ли. */
function drawCheck(pen: Pen, w: World): void {
  const c = w.check;
  if (!c) return;
  const color = c.ok ? COLOR.ok : COLOR.error;
  const width = pen.measure(c.text, MONO).width + 52;
  pen.group("check", POD.x - 10, POD_Y.B + PB.h + 50, () => {
    pen.rect("check:bg", { x: 0, y: 0, width, height: 34, rx: 8, fill: c.ok ? COLOR.doneBg : COLOR.alarmBg, stroke: color, "stroke-width": 1.5 });
    pen.text("check:t", { x: 10, y: 23, ...MONO, fill: COLOR.ink }, c.text);
    icon(pen, "check:i", c.ok ? "check" : "cross", width - 30, 6, 22, color);
  }, { class: "fx-pop d2", ...fade(w, "B") });
}

const MOOD: Record<string, PersonMood> = { idle: "idle", press: "idle", wait: "idle", ok: "happy", fail: "sad" };

/** Магазин: покупатели в цвете своих подов, корзина в порядке покупателя, ответ магазина. */
function drawShop(pen: Pen, w: World): void {
  const x = SHOP.x;
  panel(pen, "shop:box", { x, y: SHOP.y, w: SHOP.w, h: SHOP.h, stroke: COLOR.browser, attrs: fade(w, "shop") });
  pen.group("shop", 0, 0, () => {
    pen.text("shop:title", { x: x + 16, y: SHOP.y + 34, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.browser }, "Магазин");
    for (const c of w.customers) {
      const top = CARD_TOP[c.pod];
      const changed = happened(w, c.status === "ok" ? "ok" : c.status === "fail" ? "refused" : "press", c.pod);
      const [k, fx] = once(`shop:${c.pod}`, w.frame, changed ? "fx-pop" : null);
      const tx = x + 16 + PERSON.w + 12;
      // Принят, пока соседу отказали, — плечи вздрагивают: «а у меня всё хорошо».
      const shrug = happened(w, "ok", c.pod) && happened(w, "refused");
      const [pk, pfx] = once(`shop:${c.pod}:who`, w.frame, shrug ? "fx-jolt d3" : null);
      person(pen, pk, {
        x: x + 16, y: top, shirt: ACTOR[c.pod].color, mood: MOOD[c.status],
        look: c.status === "idle" ? { x: 0, y: -1 } : { x: -1, y: 0 }, attrs: pfx,
      });
      pen.text(`shop:${c.pod}:n`, { x: tx, y: top + 18, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, c.name);
      pen.text(`shop:${c.pod}:cart`, { x: tx, y: top + 44, ...SANS, fill: COLOR.muted }, c.cart.map((id) => product(w, id).name).join(", "));
      pen.group(k, 0, 0, () => {
        const sx = x + 16;
        const sy = top + 80;
        if (c.status === "press") buyButton(pen, `${k}:buy`, { x: sx, y: sy - 24, pressed: true, label: "Оформить", w: 116 });
        if (c.status === "wait") iconText(pen, `${k}:s`, "hourglass", sx, sy, "ждёт…", COLOR.warn, { ...SANS, "font-weight": 600 });
        if (c.status === "ok") iconText(pen, `${k}:s`, "check", sx, sy, "Заказ принят", COLOR.ok, { ...SANS, "font-weight": 600 });
        if (c.status === "fail") {
          iconText(pen, `${k}:s`, "cross", sx, sy, "Не удалось", COLOR.error, { ...SANS, "font-weight": 600 });
          pen.text(`${k}:s2`, { x: sx + 25, y: sy + 22, ...SANS, "font-weight": 600, fill: COLOR.error }, "оформить заказ");
        }
      }, fx);
    }
  }, fade(w, "shop"));
}

/** Секундомер deadlock_timeout у слона: только в кадрах, где голос говорит о секунде. */
function drawWatch(pen: Pen, w: World): void {
  const s = w.stopwatch;
  if (s === null) return;
  const [k, fx] = once("watch", w.frame, happened(w, "tick") ? "fx-pop" : null);
  pen.group(k, WATCH.x, WATCH.y, () => {
    pen.group(`${k}:ic`, 0, 0, () => icon(pen, `${k}:i`, "clock", 0, 0, 26, COLOR.warn), happened(w, "tick") ? { class: "fx-pulse" } : {});
    pen.text(`${k}:t`, { x: 32, y: 22, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.warn }, `${s.toFixed(1).replace(".", ",")} с`);
  }, { ...fade(w, "db"), ...fx });
}

function drawHeader(pen: Pen, w: World): void {
  const bad = happened(w, "detect") || happened(w, "fail");
  // Секунда deadlock_timeout: слон кивает в такт часам.
  const [dbKey, dbFx] = once("db:nod", w.frame, bad || happened(w, "tick") ? "fx-nod" : null);
  const busy = ["write", "wait", "commit"].some((k) => happened(w, k as SimEvent["kind"]));
  const look = w.db ? { x: 1, y: 0.2 } : busy ? { x: 0.3, y: 1 } : { x: 0, y: 0 };
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08, look, frown: bad }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", "КЕЙС", { x: CHAPTER.x, y: CHAPTER.y, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

/** Мини-пара подов в кольце: два боба и встречные стрелки, под ними — секунда ожидания. */
function ringPair(pen: Pen, k: string, x: number, y: number, ids: [keyof typeof ACTOR, keyof typeof ACTOR], o: { clock?: boolean; delay?: string } = {}): void {
  pen.group(k, x, y, () => {
    ids.forEach((id, i) => bob(pen, `${k}:b${i}`, { x: i * 150, y: 0, color: ACTOR[id].color, tint: ACTOR[id].tint, letter: id, mood: "wait", look: { x: i ? -1 : 1, y: 0 } }));
    pen.path(`${k}:top`, { d: "M 70 14 Q 107 -16 144 14", fill: "none", stroke: ACTOR[ids[0]].color, "stroke-width": 3, marker: "arrow" });
    pen.path(`${k}:bot`, { d: "M 144 48 Q 107 78 70 48", fill: "none", stroke: ACTOR[ids[1]].color, "stroke-width": 3, marker: "arrow" });
    if (o.clock === false) return;
    icon(pen, `${k}:clock`, "clock", 70, 92, 26, COLOR.warn);
    pen.text(`${k}:t`, { x: 102, y: 114, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.warn }, "1 с");
  }, { class: `fx-pop ${o.delay ?? ""}`.trim() });
}

/** Вставки «когда что» поверх сцены. */
function drawAside(pen: Pen, a: Aside | null): void {
  if (!a) return;
  if (a !== "any") pen.rect("scrim", { x: 0, y: OVERLAY.y - 8, width: STAGE.w, height: SAFE_BOTTOM - OVERLAY.y + 8, fill: COLOR.bg, opacity: 0.94, class: "fx-fade" });
  if (a === "sale") {
    ([["A", "B"], ["C", "A"], ["B", "C"]] as const).forEach((ids, i) =>
      ringPair(pen, `sale:${i}`, 180 + i * 330, 250 + (i % 2) * 70, [ids[0], ids[1]], { delay: `d${i + 1}` }));
    return;
  }
  if (a === "any") {
    // Одним запросом: порядок замков решает план — кольцо под вопросом.
    ringPair(pen, "any:ring", 530, 420, ["A", "B"], { clock: false });
    pen.text("any:q", { x: 640, y: 470, "font-family": FONT.sans, "font-size": SIZE.plate, "font-weight": 800, fill: COLOR.warn, "text-anchor": "middle", class: "fx-pop d2" }, "?");
    return;
  }
  if (a === "paths") {
    const rows: [string, string, boolean][] = [["оформление", "3 → 7", true], ["правка из админки", "3 → 7", true], ["приёмка на складе", "3 → 7", true], ["отмена", "7 → 3", false]];
    panel(pen, "paths:box", { x: 300, y: 170, w: 680, h: 70 + rows.length * 70 });
    rows.forEach(([name, order, ok], i) => {
      const y = 230 + i * 70;
      pen.text(`paths:n${i}`, { x: 336, y, ...SANS, "font-size": SIZE.accent, fill: ok ? COLOR.ink : COLOR.error, "font-weight": ok ? 400 : 700 }, name);
      pen.text(`paths:o${i}`, { x: 640, y, ...MONO, "font-size": SIZE.accent, "font-weight": 700, fill: ok ? COLOR.ok : COLOR.error }, order);
      if (ok) icon(pen, `paths:i${i}`, "check", 760, y - 20, 26, COLOR.ok);
      else pill(pen, `paths:e${i}`, "40P01", { x: 760, y: y - 26, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, mono: true, attrs: { class: "fx-pop d2" } });
    });
    return;
  }
  // 40P01 — встречные сплошные стрелки к замкам; 40001 — пунктирные дуги зависимостей из истории со слотом курьера.
  const box = (k: string, x: number, code: string, note: string, draw: () => void) => {
    panel(pen, `${k}:box`, { x, y: 170, w: 400, h: 400 });
    pen.text(`${k}:code`, { x: x + 200, y: 226, "font-family": FONT.mono, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.warn, "text-anchor": "middle" }, code);
    draw();
    pen.text(`${k}:note`, { x: x + 200, y: 530, ...SANS, "font-size": SIZE.accent, fill: COLOR.ink, "text-anchor": "middle" }, note);
  };
  box("p01", 220, "40P01", "ждали друг друга", () => {
    lock(pen, "p01:l1", { x: 300, y: 300, color: ACTOR.A.color });
    lock(pen, "p01:l2", { x: 498, y: 300, color: ACTOR.B.color });
    pen.path("p01:a", { d: "M 330 300 Q 410 250 490 300", fill: "none", stroke: ACTOR.B.color, "stroke-width": 4, marker: "arrow" });
    pen.path("p01:b", { d: "M 490 340 Q 410 390 330 340", fill: "none", stroke: ACTOR.A.color, "stroke-width": 4, marker: "arrow" });
  });
  box("p001", 660, "40001", "данные изменились", () => {
    pen.path("p001:a", { d: "M 760 300 Q 860 250 960 300", fill: "none", stroke: ACTOR.B.color, "stroke-width": 4, "stroke-dasharray": "8 6", marker: "arrow" });
    pen.path("p001:b", { d: "M 960 340 Q 860 390 760 340", fill: "none", stroke: ACTOR.A.color, "stroke-width": 4, "stroke-dasharray": "8 6", marker: "arrow" });
  });
}

export function render(pen: Pen, w: World): void {
  // Вспомним кружку: кадр 05 его же отрисовкой; поверх — только штамп перемотки.
  if (w.flashback !== null) {
    render05(pen, recallWorld(w.flashback));
    pen.layer("top", () => {
      if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: HEADER_RIGHT });
    });
    return;
  }
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawWatch(pen, w);
  drawProducts(pen, w);
  drawOrders(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: TERM.x, y: TERM.y, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board && lit(w, "board")) board(pen, w.board, { ...BOARD, lampX: [290, 420], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") });
  drawArrows(pen, w);
  drawShop(pen, w);
  drawCheck(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    if (w.code) pen.rect("scrim", { x: 0, y: OVERLAY.y - 8, width: STAGE.w, height: SAFE_BOTTOM - OVERLAY.y + 8, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
    drawCode(pen, w.code, w.code && w.code.lines.length <= 5 ? w.code.lines.length : CODE_ROWS);
    drawAside(pen, w.aside);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: HEADER_RIGHT });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}
