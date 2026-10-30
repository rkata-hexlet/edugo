import { STAGE, type Pen, type Span } from "../../engine/contract";
import { bob, elephant } from "../../kit/characters";
import { highlightGo } from "../../kit/code";
import { icon } from "../../kit/icons";
import { buyButton, mug, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, panel, pill, plate, stamp } from "../../kit/widgets";
import {
  FLAG, GUESTS, OTHER, PODS, allows, boxOf, bucket, tag, untilRefresh, type Booking, type Box, type Focus, type PodId, type SimEvent, type World,
} from "./sim";

// MVP эпизода 14: серые фигуры. Слева гость (телефон с кнопками оплаты и шагами брони; очередь гостей с бакетами; стойка отеля),
// дальше рамка с подами (копия правил, лог, «читает at_hotel»), в центре пульт дежурного и сервис флагов, справа Postgres с
// бронями. Низ — строка кода, ящики старой ветки, «код / данные», contract.

const GUEST = { x: 30, y: 104, w: 250, h: 370 };
const SERVICE = { x: 296, y: 104, w: 304, h: 370 };
const POD_X = 312;
const POD_Y: Record<PodId, number> = { A: 124, B: 236, C: 348 };
const CARD_X = 392;
const CONSOLE = { x: 620, y: 104, w: 300, h: 170 };
const TWIN = { x: 620, y: 296, w: 300, h: 170 };
const BOOTH = { x: 620, y: 300, w: 300, h: 174 };
const DB = { x: 940, y: 104, w: 300, h: 370 };
const SLIDER = { x: 644, w: 252, y: 214 };
const BOTTOM = { x: 30, y: 490, w: 1210, h: 150 };
const TERM = { x: 620, y: 62 };
const CHAPTER_X = 1100;

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: PodId) => w.events.some((e) => e.kind === kind && (!by || e.by === by));

const PAYMENT: Record<Booking["payment"], string> = { paid: "paid", pending: "pending", at_hotel: "at_hotel" };

function drawHeader(pen: Pen, w: World): void {
  elephant(pen, "db:face", { x: DB.x + 10, y: 8, talking: !!w.db, scale: 1.08 });
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER_X, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

/** Гость: телефон с кнопками оплаты последнего шага и список шагов брони. */
function drawGuest(pen: Pen, w: World): void {
  const last = w.visits.at(-1);
  pen.group("guest", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    person(pen, "guest:p", { x: GUEST.x + 14, y: GUEST.y + 14, shirt: COLOR.browser, mood: w.guestSay ? "sad" : "idle" });
    pen.text("guest:tag", { x: GUEST.x + 70, y: GUEST.y + 44, ...MONO, fill: COLOR.muted }, `бакет ${tag(bucket(GUESTS[0]))}`);
    const phone = { x: GUEST.x + 14, y: GUEST.y + 76, w: GUEST.w - 28, h: 150 };
    pen.rect("guest:phone", { x: phone.x, y: phone.y, width: phone.w, height: phone.h, rx: 14, fill: COLOR.bg2, stroke: COLOR.line, "stroke-width": 2 });
    if (last?.fresh === "hang") {
      pen.text("guest:wait", { x: phone.x + 16, y: phone.y + 44, ...SANS, fill: COLOR.warn }, "оплата… ждём");
      icon(pen, "guest:hg", "hourglass", phone.x + 160, phone.y + 22, 30, COLOR.warn);
    } else {
      buyButton(pen, "guest:now", { x: phone.x + 12, y: phone.y + 18, pressed: false, label: "Оплатить сейчас", w: phone.w - 24 });
      if (last?.fresh === true) {
        buyButton(pen, "guest:hotel", { x: phone.x + 12, y: phone.y + 70, pressed: false, label: "При заселении", w: phone.w - 24, attrs: { class: "fx-pop" } });
      }
    }
    if (w.visits.length > 1 || lit(w, "steps") && w.visits.length) drawSteps(pen, w);
  }, fade(w, "guest", "steps"));
}

/** Шаги брони: какой под, какая оплата; разные соседние — трещина. */
function drawSteps(pen: Pen, w: World): void {
  const y0 = GUEST.y + 254;
  w.visits.forEach((v, i) => {
    const y = y0 + i * 32;
    const word = v.fresh === "hang" ? "ждёт…" : v.fresh ? "новая" : "старая";
    const color = v.fresh === "hang" ? COLOR.warn : v.fresh ? COLOR.ok : COLOR.muted;
    pen.text(`steps:${i}`, { x: GUEST.x + 18, y, ...SANS, fill: COLOR.ink }, `шаг ${i + 1} · под ${v.by}`);
    pen.text(`steps:${i}:v`, { x: GUEST.x + GUEST.w - 18, y, ...SANS, "text-anchor": "end", "font-weight": 700, fill: color }, word);
    const prev = w.visits[i - 1];
    if (prev && prev.fresh !== v.fresh && v.fresh !== "hang" && prev.fresh !== "hang") {
      icon(pen, `steps:${i}:crack`, "bang", GUEST.x + 128, y - 26, 22, COLOR.error, { class: "fx-pop d2" });
    }
  });
}

/** Очередь гостей с бакетами: у кого бакет ниже черты, тот подсвечен; второй столбец — бакет того же гостя у второго флага. */
function drawQueue(pen: Pen, w: World): void {
  pen.group("queue", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    pen.text("queue:h", { x: GUEST.x + 16, y: GUEST.y + 30, ...SANS, fill: COLOR.muted }, w.twin ? "оплата   поиск" : "бакет гостя");
    GUESTS.forEach((g, i) => {
      const y = GUEST.y + 50 + i * 78;
      const inPay = allows(w.console, g);
      person(pen, `queue:p${i}`, { x: GUEST.x + 16, y, shirt: COLOR.browser, mood: "idle", attrs: { opacity: inPay ? 1 : DIM } });
      pill(pen, `queue:t${i}`, tag(bucket(g, FLAG, w.console.salted)), {
        x: GUEST.x + 76, y: y + 6, fill: inPay ? COLOR.doneBg : COLOR.surface2, color: inPay ? COLOR.ok : COLOR.muted, stroke: inPay ? COLOR.ok : undefined, mono: true,
      });
      if (w.twin) {
        const inSearch = allows({ on: true, percent: 10, salted: w.console.salted }, g, OTHER);
        pill(pen, `queue:s${i}`, tag(bucket(g, OTHER, w.console.salted)), {
          x: GUEST.x + 158, y: y + 6, fill: inSearch ? COLOR.doneBg : COLOR.surface2, color: inSearch ? COLOR.ok : COLOR.muted, stroke: inSearch ? COLOR.ok : undefined, mono: true,
        });
      }
    });
  }, fade(w, "queue", "guest"));
}

/** Стойка отеля: гость с чемоданом, на экране бронь отменена. */
function drawDesk(pen: Pen, w: World): void {
  pen.group("desk", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    person(pen, "desk:p", { x: GUEST.x + 30, y: GUEST.y + 150, shirt: COLOR.browser, mood: "sad" });
    pen.rect("desk:case", { x: GUEST.x + 84, y: GUEST.y + 170, width: 40, height: 50, rx: 6, fill: COLOR.surface2, stroke: COLOR.muted, "stroke-width": 2 });
    pen.rect("desk:case:h", { x: GUEST.x + 96, y: GUEST.y + 160, width: 16, height: 12, rx: 4, fill: "none", stroke: COLOR.muted, "stroke-width": 2 });
    pen.rect("desk:top", { x: GUEST.x + 14, y: GUEST.y + 230, width: GUEST.w - 28, height: 22, rx: 4, fill: COLOR.surface2 });
    pen.text("desk:t", { x: GUEST.x + 16, y: GUEST.y + 284, ...SANS, fill: COLOR.muted }, "стойка отеля");
    pen.rect("desk:screen", { x: GUEST.x + 14, y: GUEST.y + 40, width: GUEST.w - 28, height: 80, rx: 8, fill: COLOR.alarmBg, stroke: COLOR.error, "stroke-width": 2 });
    pen.text("desk:s1", { x: GUEST.x + 28, y: GUEST.y + 72, ...MONO, fill: COLOR.ink }, "Бронь H-8120");
    pen.text("desk:s2", { x: GUEST.x + 28, y: GUEST.y + 102, ...SANS, "font-weight": 700, fill: COLOR.error }, "отменена");
  }, fade(w, "guest"));
}

/** Поды в рамке: копия правил с кольцом обновления, лог, метка «читает at_hotel»; упавший — серый с крестом. */
function drawService(pen: Pen, w: World): void {
  pen.group("svc", 0, 0, () => {
    panel(pen, "svc:box", { ...SERVICE, fill: "none", stroke: COLOR.line, shadow: false });
    pen.text("svc:title", { x: SERVICE.x + 16, y: SERVICE.y + SERVICE.h - 14, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Сервис бронирования");
  }, fade(w, ...PODS));
  for (const id of PODS) {
    const p = w.pods[id];
    const { color, tint } = ACTOR[id];
    const busy = w.visits.some((v) => v.by === id);
    const mood = p.crashed ? "lost" : p.hanging ? "wait" : busy ? "work" : "idle";
    pen.group(`pod:${id}`, POD_X, POD_Y[id], () => {
      bob(pen, `pod:${id}:bob`, { x: 0, y: 0, color, tint, letter: id, mood, look: { x: 0, y: 0 } });
      if (p.crashed) icon(pen, `pod:${id}:x`, "cross", 16, 10, 32, COLOR.error, { class: "fx-pop" });
      if (w.mode === "local" && !w.contracted) {
        const fresh = happened(w, "copy", id) || happened(w, "refresh", id);
        pen.rect(`pod:${id}:card`, { x: CARD_X - POD_X, y: 2, width: 190, height: 30, rx: 6, fill: p.copy ? COLOR.surface2 : "none", stroke: p.copy ? COLOR.ink : COLOR.faint, "stroke-width": 2, "stroke-dasharray": p.copy ? "none" : "5 4", ...(fresh ? { class: "fx-pop" } : {}) });
        const rule = p.copy ? (p.copy.on ? `правила: вкл ${p.copy.percent} %` : "правила: выкл") : "правил нет";
        pen.text(`pod:${id}:rule`, { x: CARD_X - POD_X + 10, y: 24, ...SANS, fill: p.copy ? COLOR.ink : COLOR.faint }, rule);
        if (p.log) pen.text(`pod:${id}:log`, { x: CARD_X - POD_X, y: 60, ...MONO, fill: COLOR.warn, class: "fx-fade d2" }, p.log === "flags: refresh failed" ? "refresh failed" : "лог: дефолт");
        else if (p.copy) {
          icon(pen, `pod:${id}:ring`, "replay", CARD_X - POD_X, 40, 24, COLOR.muted);
          pen.text(`pod:${id}:in`, { x: CARD_X - POD_X + 30, y: 60, ...SANS, fill: COLOR.muted }, `обновит через ${untilRefresh(w, id)} с`);
        }
      }
      if (p.reads) pill(pen, `pod:${id}:reads`, "читает at_hotel", { x: CARD_X - POD_X, y: w.mode === "local" ? 70 : 14, fill: COLOR.doneBg, color: COLOR.ok, stroke: COLOR.ok, mono: true, attrs: happened(w, "expand") ? { class: "fx-pop" } : {} });
    }, fade(w, id));
  }
}

/** Стрелки: гость → под на каждом шаге; под → сервис флагов, когда спрашивает; пульт → поды, когда читают его напрямую. */
function drawArrows(pen: Pen, w: World): void {
  for (const id of new Set(w.visits.map((v) => v.by))) {
    pen.line(`arr:${id}:in`, { x1: GUEST.x + GUEST.w, y1: GUEST.y + 140, x2: POD_X - 4, y2: POD_Y[id] + 32, stroke: COLOR.browser, "stroke-width": 2.5, marker: "arrow", ...fade(w, id, "guest"), ...DRAW });
  }
  if (w.mode === "remote") {
    for (const id of PODS) {
      if (!happened(w, "ask", id)) continue;
      pen.line(`arr:${id}:ask`, { x1: POD_X + 68, y1: POD_Y[id] + 32, x2: BOOTH.x - 6, y2: BOOTH.y + 60, stroke: ACTOR[id].color, "stroke-width": 2.5, marker: "arrow", ...fade(w, id), ...DRAW });
    }
  }
  if (w.mode === "direct" && !w.contracted && lit(w, "console") && !w.desk && !w.queue) {
    for (const id of PODS) {
      if (w.pods[id].crashed) {
        pen.line(`arr:${id}:flag`, { x1: CONSOLE.x - 4, y1: CONSOLE.y + 80, x2: SERVICE.x + SERVICE.w - 60, y2: POD_Y[id] + 30, stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "6 5" });
        continue;
      }
      pen.line(`arr:${id}:flag`, { x1: CONSOLE.x - 4, y1: CONSOLE.y + 80, x2: POD_X + 72, y2: POD_Y[id] + 30, stroke: w.console.on ? COLOR.ok : COLOR.faint, "stroke-width": 2, "stroke-dasharray": "6 5", marker: "arrow" });
    }
  }
}

/** Пульт дежурного: кнопка вкл/выкл и ползунок процентов 0…99 с чертой порога; бакеты гостей — засечки. */
function drawConsole(pen: Pen, w: World, box = CONSOLE, flag = FLAG): void {
  const k = `console:${flag}`;
  const r = w.console;
  const percent = flag === FLAG ? r.percent : 10;
  pen.group(k, 0, 0, () => {
    panel(pen, `${k}:box`, { ...box });
    pen.text(`${k}:t`, { x: box.x + 16, y: box.y + 32, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Пульт");
    pen.text(`${k}:f`, { x: box.x + 84, y: box.y + 32, ...MONO, fill: COLOR.ink }, flag);
    const fresh = happened(w, "toggle");
    pill(pen, `${k}:on`, r.on ? "ВКЛ" : "ВЫКЛ", {
      x: box.x + 16, y: box.y + 50, fill: r.on ? COLOR.doneBg : COLOR.surface2, color: r.on ? COLOR.ok : COLOR.muted, stroke: r.on ? COLOR.ok : COLOR.line, attrs: fresh && flag === FLAG ? { class: "fx-pop" } : {},
    });
    pen.text(`${k}:pct`, { x: box.x + box.w - 16, y: box.y + 76, ...SANS, "font-size": SIZE.accent, "font-weight": 700, "text-anchor": "end", fill: r.on ? COLOR.ink : COLOR.faint }, `${percent} %`);
    const y = box.y + (SLIDER.y - CONSOLE.y);
    pen.rect(`${k}:bar`, { x: SLIDER.x, y: y - 4, width: SLIDER.w, height: 8, rx: 4, fill: COLOR.surface2 });
    const cut = SLIDER.x + (SLIDER.w * Math.min(percent, 100)) / 100;
    pen.rect(`${k}:fill`, { x: SLIDER.x, y: y - 4, width: cut - SLIDER.x, height: 8, rx: 4, fill: r.on ? COLOR.ok : COLOR.faint });
    pen.line(`${k}:cut`, { x1: cut, y1: y - 18, x2: cut, y2: y + 18, stroke: COLOR.ink, "stroke-width": 3 });
    if (w.queue) {
      GUESTS.forEach((g, i) => {
        const b = bucket(g, flag, r.salted);
        const x = SLIDER.x + (SLIDER.w * b) / 100;
        pen.rect(`${k}:g${i}`, { x: x - 5, y: y + 22, width: 10, height: 10, rx: 5, fill: r.on && b < percent ? COLOR.ok : COLOR.muted });
      });
    }
    if (w.contracted && flag === FLAG) {
      pen.line(`${k}:x1`, { x1: box.x + 10, y1: box.y + 10, x2: box.x + box.w - 10, y2: box.y + box.h - 10, stroke: COLOR.error, "stroke-width": 3, ...DRAW });
      pen.text(`${k}:gone`, { x: box.x + box.w / 2, y: box.y + box.h + 30, ...SANS, "text-anchor": "middle", "font-weight": 700, fill: COLOR.muted }, "флаг и старая ветка убраны");
    }
  }, fade(w, "console", "queue"));
  if (flag === FLAG && !w.twin && w.service === null && !w.contracted) mug(pen, "duty:mug", { x: box.x + box.w - 70, y: box.y + box.h + 16, steam: !w.desk });
}

/** Сервис флагов: работает или не отвечает. */
function drawBooth(pen: Pen, w: World): void {
  const down = w.service === "down";
  pen.group("booth", 0, 0, () => {
    panel(pen, "booth:box", { ...BOOTH, stroke: down ? COLOR.error : COLOR.line, fill: down ? COLOR.bg2 : COLOR.surface });
    pen.text("booth:t", { x: BOOTH.x + 16, y: BOOTH.y + 34, ...SANS, "font-weight": 700, fill: down ? COLOR.faint : COLOR.ink }, "Сервис флагов");
    pen.text("booth:s", { x: BOOTH.x + 16, y: BOOTH.y + 72, ...SANS, fill: down ? COLOR.error : COLOR.ok, ...(happened(w, "down") ? { class: "fx-fade" } : {}) }, down ? "не отвечает" : "отвечает");
    if (down) icon(pen, "booth:x", "cross", BOOTH.x + BOOTH.w - 56, BOOTH.y + 14, 36, COLOR.error);
    pen.text("booth:r", { x: BOOTH.x + 16, y: BOOTH.y + 120, ...MONO, fill: COLOR.muted }, `${FLAG}: вкл`);
  }, fade(w, "service"));
}

/** Postgres: брони; отменённые зачёркнуты, у брони с записанным решением — метка. */
function drawDb(pen: Pen, w: World): void {
  pen.group("db", 0, 0, () => {
    panel(pen, "db:box", { ...DB, stroke: COLOR.postgres });
    pen.text("db:t", { x: DB.x + 16, y: DB.y + 32, ...MONO, "font-weight": 700, fill: COLOR.muted }, "bookings");
    w.bookings.forEach((b, i) => {
      const y = DB.y + 50 + i * 40;
      const key = `bk:${b.id}`;
      const fresh = happened(w, "write") && i >= w.bookings.length - w.events.filter((e) => e.kind === "write").length;
      pen.group(key, 0, y, () => {
        pen.rect(`${key}:bg`, { x: DB.x + 12, y: 0, width: DB.w - 24, height: 32, rx: 6, fill: b.payment === "at_hotel" ? COLOR.draftBg : COLOR.surface2, ...(fresh ? { class: "fx-rise" } : {}) });
        pen.text(`${key}:id`, { x: DB.x + 22, y: 23, ...MONO, fill: b.cancelled ? COLOR.faint : COLOR.ink }, b.id);
        pen.text(`${key}:p`, { x: DB.x + 112, y: 23, ...MONO, fill: b.cancelled ? COLOR.faint : b.payment === "at_hotel" ? COLOR.warn : COLOR.muted }, PAYMENT[b.payment]);
        if (b.flow) pen.text(`${key}:flow`, { x: DB.x + DB.w - 22, y: 23, ...SANS, "text-anchor": "end", "font-weight": 700, fill: b.flow === "new" ? COLOR.ok : COLOR.muted }, b.flow === "new" ? "новая" : "старая");
        if (b.cancelled) {
          pen.line(`${key}:strike`, { x1: DB.x + 16, y1: 16, x2: DB.x + DB.w - 16, y2: 16, stroke: COLOR.error, "stroke-width": 3, ...(happened(w, "cancel") ? DRAW : {}) });
        }
      });
    });
    if (w.bookings.some((b) => b.cancelled)) {
      pen.text("db:cancelled", { x: DB.x + 16, y: DB.y + DB.h - 18, ...SANS, "font-weight": 700, fill: COLOR.error }, "отменены");
    }
  }, fade(w, "db"));
}

/** Строка кода пода; подсвеченный кусок (дефолт) — рамкой. */
function drawCode(pen: Pen, w: World): void {
  const h = 40 + w.code.length * 30;
  pen.group("code", 0, 0, () => {
    panel(pen, "code:box", { x: BOTTOM.x, y: BOTTOM.y, w: BOTTOM.w, h, fill: "#11172e", stroke: COLOR.muted });
    highlightGo(w.code).forEach((spans, i) => {
      const y = BOTTOM.y + 36 + i * 30;
      pen.text(`code:l${i}`, { x: BOTTOM.x + 20, y, ...MONO, "font-size": SIZE.say }, spans);
      if (!w.codeMark) return;
      const at = spans.findIndex((s) => s.text === w.codeMark);
      if (at < 0) return;
      const before = spans.slice(0, at).map((s: Span) => s.text).join("");
      const x = BOTTOM.x + 20 + pen.measure(before, { ...MONO, "font-size": SIZE.say }).width;
      const wd = pen.measure(w.codeMark, { ...MONO, "font-size": SIZE.say }).width;
      pen.rect(`code:mark${i}`, { x: x - 4, y: y - 22, width: wd + 8, height: 30, rx: 5, fill: "none", stroke: COLOR.warn, "stroke-width": 2.5, class: "fx-pop d2", ...fade(w, "default") });
    });
  }, fade(w, "code", "default"));
}

const BOXES: { box: Box; label: string }[] = [
  { box: "paid", label: "оплачено: ок" },
  { box: "wait", label: "ждём 30 мин" },
  { box: "cancel", label: "иначе: отменить" },
];

/** Ящики старой ветки: куда ляжет каждая бронь; после expand `at_hotel` — в своём ящике «знаю». */
function drawBoxes(pen: Pen, w: World): void {
  const reads = w.pods.A.reads;
  const list = reads ? [...BOXES.slice(0, 2), { box: "known" as Box, label: "при заселении: ок" }] : BOXES;
  const bw = (BOTTOM.w - 2 * 16) / 3;
  pen.group("boxes", 0, 0, () => {
    list.forEach(({ box, label }, i) => {
      const x = BOTTOM.x + i * (bw + 16);
      const bad = box === "cancel";
      panel(pen, `boxes:${box}`, { x, y: BOTTOM.y, w: bw, h: BOTTOM.h, fill: bad ? COLOR.alarmBg : COLOR.surface, stroke: bad ? COLOR.error : box === "known" ? COLOR.ok : COLOR.line, shadow: false });
      pen.text(`boxes:${box}:t`, { x: x + 14, y: BOTTOM.y + 30, ...SANS, "font-weight": 700, fill: bad ? COLOR.error : box === "known" ? COLOR.ok : COLOR.ink }, label);
      w.bookings.filter((b) => boxOf(b, reads) === box).forEach((b, j) => {
        const y = BOTTOM.y + 54 + j * 30;
        if (y > BOTTOM.y + BOTTOM.h - 26) return;
        pen.text(`boxes:${b.id}`, { x: x + 14, y: y + 18, ...MONO, fill: b.cancelled ? COLOR.error : COLOR.muted }, `${b.id} ${PAYMENT[b.payment]}`);
      });
    });
  }, fade(w, "boxes"));
}

/** «Флаг откатывает код, а не данные»: две колонки. */
function drawSplit(pen: Pen, w: World): void {
  const half = (BOTTOM.w - 16) / 2;
  pen.group("split", 0, 0, () => {
    panel(pen, "split:code", { x: BOTTOM.x, y: BOTTOM.y, w: half, h: BOTTOM.h, shadow: false });
    pen.text("split:code:t", { x: BOTTOM.x + 20, y: BOTTOM.y + 36, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.ok }, "код: откатился");
    pen.text("split:code:s", { x: BOTTOM.x + 20, y: BOTTOM.y + 76, ...SANS, fill: COLOR.muted }, "все запросы снова идут старой веткой");
    const x = BOTTOM.x + half + 16;
    panel(pen, "split:data", { x, y: BOTTOM.y, w: half, h: BOTTOM.h, shadow: false, stroke: COLOR.error });
    pen.text("split:data:t", { x: x + 20, y: BOTTOM.y + 36, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.error }, "данные: остались");
    pen.text("split:data:s", { x: x + 20, y: BOTTOM.y + 76, ...SANS, fill: COLOR.muted }, "брони в базе, письма, деньги, события");
  }, fade(w, "split"));
}

/** Contract: чего теперь нельзя. */
function drawContract(pen: Pen): void {
  pen.group("contract", 0, 0, () => {
    panel(pen, "contract:box", { x: BOTTOM.x, y: BOTTOM.y, w: BOTTOM.w, h: 100, shadow: false });
    pen.text("contract:t", { x: BOTTOM.x + 20, y: BOTTOM.y + 40, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.ink }, "три деплоя: научить читать → включить запись → убрать старое");
    pen.text("contract:s", { x: BOTTOM.x + 20, y: BOTTOM.y + 78, ...SANS, fill: COLOR.warn }, "откатить бинарник ниже «читает at_hotel» — нельзя");
  });
}

/** Итог: Knight Capital — зеркальная рифма. */
function drawKnight(pen: Pen, w: World): void {
  const box = { x: 30, y: 104, w: 1210, h: 370 };
  const half = (box.w - 16) / 2;
  pen.group("knight", 0, 0, () => {
    panel(pen, "knight:box", { ...box });
    pen.text("knight:t", { x: box.x + 24, y: box.y + 44, ...SANS, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.ink }, "Knight Capital, 2012");
    pen.text("knight:s1", { x: box.x + 24, y: box.y + 90, ...SANS, fill: COLOR.muted }, "новый код на 7 серверах из 8, на восьмом — старый");
    pen.text("knight:s2", { x: box.x + 24, y: box.y + 122, ...SANS, fill: COLOR.muted }, "флаг получил новый смысл и разбудил мёртвый код");
    pen.text("knight:s3", { x: box.x + 24, y: box.y + 154, ...SANS, fill: COLOR.error }, "45 минут — около 460 млн долларов");
    [["У нас", "выключили флаг — данные остались"], ["У них", "откатили код — флаг остался"]].forEach(([who, what], i) => {
      const x = box.x + 16 + i * (half + 16) - (i ? 16 : 0);
      panel(pen, `knight:c${i}`, { x, y: box.y + 200, w: half - 16, h: 140, fill: COLOR.surface2, shadow: false });
      pen.text(`knight:c${i}:w`, { x: x + 20, y: box.y + 244, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.ink }, who);
      pen.text(`knight:c${i}:t`, { x: x + 20, y: box.y + 290, ...SANS, fill: COLOR.ink }, what);
    });
  }, fade(w, "knight"));
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  if (w.term) pill(pen, "term", w.term, { ...TERM, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.knight) drawKnight(pen, w);
  else {
    if (w.desk) drawDesk(pen, w);
    else if (w.queue) drawQueue(pen, w);
    else drawGuest(pen, w);
    drawService(pen, w);
    drawConsole(pen, w);
    if (w.twin) drawConsole(pen, w, TWIN, OTHER);
    if (w.service) drawBooth(pen, w);
    drawDb(pen, w);
    drawArrows(pen, w);
    if (w.code.length) drawCode(pen, w);
    else if (w.boxes) drawBoxes(pen, w);
    else if (w.split) drawSplit(pen, w);
    else if (w.contracted) drawContract(pen);
  }
  pen.layer("top", () => {
    if (w.guestSay) bubble(pen, "guest:say", w.guestSay, { x: GUEST.x + 36, y: GUEST.y + 8, tail: "down", attrs: { class: "fx-pop", ...fade(w, "guest", "queue") } });
    if (w.podSay) bubble(pen, "pod:say", w.podSay.text, { x: POD_X - 2, y: POD_Y[w.podSay.by] + 30, tail: "right", attrs: { class: "fx-pop" } });
    if (w.dutySay) bubble(pen, "duty:say", w.dutySay, { x: CONSOLE.x + 4, y: CONSOLE.y + CONSOLE.h + 4, tail: "up", attrs: { class: "fx-pop" } });
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: 300, right: DB.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + 4, y: 44, tail: "right", attrs: { class: "fx-pop" } });
  });
}
