import { STAGE, type Pen, type Span } from "../../engine/contract";
import { bob, elephant } from "../../kit/characters";
import { highlightGo } from "../../kit/code";
import { icon } from "../../kit/icons";
import { buyButton, mug, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, panel, pill, plate, stamp } from "../../kit/widgets";
import {
  FLAG, GUESTS, OTHER, PODS, allows, boxOf, bucket, tag, untilRefresh, type Booking, type Box, type Focus, type Pod, type PodId, type SimEvent, type World,
} from "./sim";

// Эпизод 14. Слева гость (телефон с кнопками оплаты и шагами брони; очередь гостей с бакетами; стойка отеля),
// дальше рамка с подами (копия правил, лог, «читает at_hotel»), в центре пульт дежурного и сервис флагов, справа Postgres с
// бронями. Низ — строка кода, полоса бакетов, ящики старой ветки, «код / данные», contract; когда низ свободен, панели
// вытягиваются до него (высота — транзишеном `.tw`, поды разъезжаются).

const GUEST = { x: 30, y: 104, w: 250, h: 370 };
const SERVICE = { x: 296, y: 104, w: 324, h: 370 };
const POD_X = 312;
const POD_Y: Record<PodId, number> = { A: 124, B: 236, C: 348 };
const POD_Y_TALL: Record<PodId, number> = { A: 140, B: 300, C: 460 };
/** Прибавка высоты панелей, когда низ кадра ничем не занят. */
const TALL = 130;
const CARD_X = 392;
const CONSOLE = { x: 636, y: 104, w: 288, h: 170 };
const TWIN = { x: 636, y: 296, w: 288, h: 170 };
const BOOTH = { x: 636, y: 300, w: 288, h: 174 };
const DB = { x: 940, y: 104, w: 300, h: 370 };
const SLIDER = { x: 660, w: 240, y: 214 };
const BOTTOM = { x: 30, y: 490, w: 1210, h: 150 };
const LANE = { x: 200, w: 1010 };
const TERM = { x: 636, y: 62 };
const CHAPTER_X = 1100;
/** Рубашки гостей очереди: первый — наш гость, как на телефоне. */
const SHIRTS = [COLOR.browser, COLOR.mail, COLOR.redis, COLOR.mug];

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

/** Низ кадра занят: код, ящики, «код / данные», contract или полоса бакетов. */
const bottomUsed = (w: World) => w.code.length > 0 || w.boxes || w.split || w.contracted || w.queue;
const grow = (w: World) => (bottomUsed(w) ? 0 : TALL);
/** Панель столбца: при свободном низе — до него; высота меняется транзишеном. */
const tall = <B extends { h: number }>(w: World, box: B) => ({ ...box, h: box.h + grow(w), attrs: { class: "tw" } });
const podY = (w: World, id: PodId) => (bottomUsed(w) ? POD_Y : POD_Y_TALL)[id];
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: PodId) => w.events.some((e) => e.kind === kind && (!by || e.by === by));
/** Копия правил пода отстала от пульта. */
const stale = (w: World, p: Pod) => !!p.copy && (p.copy.on !== w.console.on || (p.copy.on && p.copy.percent !== w.console.percent));

const PAYMENT: Record<Booking["payment"], string> = { paid: "paid", pending: "pending", at_hotel: "at_hotel" };

function drawHeader(pen: Pen, w: World): void {
  elephant(pen, "db:face", { x: DB.x + 10, y: 8, talking: !!w.db, scale: 1.08 });
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER_X, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

/** Гость: телефон с кнопками оплаты последнего шага и список шагов брони; бирка бакета — после кейса 1, где бакет ввели. */
function drawGuest(pen: Pen, w: World): void {
  const last = w.visits.at(-1);
  pen.group("guest", 0, 0, () => {
    panel(pen, "guest:box", tall(w, GUEST));
    person(pen, "guest:p", { x: GUEST.x + 14, y: GUEST.y + 14, shirt: SHIRTS[0], mood: w.guestSay ? "sad" : "idle" });
    if ((w.chapter ?? 0) >= 2 || w.replay) pen.text("guest:tag", { x: GUEST.x + 70, y: GUEST.y + 44, ...MONO, fill: COLOR.muted }, `бакет ${tag(bucket(GUESTS[0]))}`);
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
    if (w.mode === "coin" && w.visits.length) drawCoin(pen);
  }, fade(w, "guest", "steps"));
}

/** Шаги брони: какой под, какая оплата; разные соседние — трещина. В кадре монетки «шага» ещё нет — обновления страницы. */
function drawSteps(pen: Pen, w: World): void {
  const y0 = GUEST.y + 254;
  const reloads = w.mode === "coin" && !w.focus?.includes("steps");
  w.visits.forEach((v, i) => {
    const y = y0 + i * 32;
    const word = v.fresh === "hang" ? "ждёт…" : v.fresh ? "новая" : "старая";
    const color = v.fresh === "hang" ? COLOR.warn : v.fresh ? COLOR.ok : COLOR.muted;
    pen.text(`steps:${i}`, { x: GUEST.x + 18, y, ...SANS, fill: COLOR.ink }, reloads ? `обновление ${i + 1}` : `шаг ${i + 1} · под ${v.by}`);
    pen.text(`steps:${i}:v`, { x: GUEST.x + GUEST.w - 18, y, ...SANS, "text-anchor": "end", "font-weight": 700, fill: color }, word);
    const prev = w.visits[i - 1];
    if (prev && prev.fresh !== v.fresh && v.fresh !== "hang" && prev.fresh !== "hang") {
      icon(pen, `steps:${i}:crack`, "bang", GUEST.x + 128, y - 26, 22, COLOR.error, { class: "fx-pop d2" });
    }
  });
}

/** Очередь гостей с бакетами первого флага: кто попал в процент — в кольце. Без соли — подпись над очередью. */
function drawQueue(pen: Pen, w: World): void {
  pen.group("queue", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    pen.text("queue:h", { x: GUEST.x + 16, y: GUEST.y + 30, ...SANS, fill: COLOR.muted }, w.console.salted ? "бакет гостя" : "хэш без имени флага");
    GUESTS.forEach((g, i) => {
      const y = GUEST.y + 54 + i * 78;
      const inPay = allows(w.console, g);
      if (inPay) pen.rect(`queue:ring${i}`, { x: GUEST.x + 10, y: y - 6, width: 56, height: 58, rx: 16, fill: "none", stroke: COLOR.ok, "stroke-width": 2.5 });
      person(pen, `queue:p${i}`, { x: GUEST.x + 16, y, shirt: SHIRTS[i], mood: "idle", attrs: { opacity: inPay ? 1 : 0.7 } });
      pill(pen, `queue:t${i}`, tag(bucket(g, FLAG, w.console.salted)), {
        x: GUEST.x + 82, y: y + 6, fill: inPay ? COLOR.doneBg : COLOR.surface2, color: inPay ? COLOR.ok : COLOR.muted, stroke: inPay ? COLOR.ok : undefined, mono: true,
      });
    });
  }, fade(w, "queue", "guest"));
}

/** Полоса бакетов 0…99 под кадром: зона процента, черта порога и точки гостей (рубашки — как в очереди). */
function drawLane(pen: Pen, w: World): void {
  const flags = w.twin ? [FLAG, OTHER] : [FLAG];
  const rows = w.twin ? [530, 592] : [568];
  const at = (b: number) => LANE.x + (LANE.w * b) / 100;
  pen.group("lane", 0, 0, () => {
    flags.forEach((flag, r) => {
      const y = rows[r];
      const rules = flag === FLAG ? w.console : { on: true, percent: 10, salted: w.console.salted };
      const k = `lane:${flag}`;
      pen.text(`${k}:name`, { x: BOTTOM.x, y: y + 6, ...MONO, fill: COLOR.muted }, flag);
      pen.rect(`${k}:zone`, { x: LANE.x, y: y - 26, width: at(rules.percent) - LANE.x, height: 52, rx: 8, fill: COLOR.doneBg });
      pen.line(`${k}:track`, { x1: LANE.x, y1: y, x2: LANE.x + LANE.w, y2: y, stroke: COLOR.line, "stroke-width": 2 });
      pen.group(`${k}:cut`, at(rules.percent), 0, () => {
        pen.line(`${k}:cut:l`, { x1: 0, y1: y - 32, x2: 0, y2: y + 32, stroke: COLOR.ink, "stroke-width": 3 });
      });
      GUESTS.forEach((g, i) => {
        const b = bucket(g, flag, rules.salted);
        const inside = allows(rules, g, flag);
        const joined = inside && happened(w, "slide") && b >= 10;
        pen.rect(`${k}:g${i}`, { x: at(b) - 11, y: y - 11, width: 22, height: 22, rx: 11, fill: SHIRTS[i], stroke: inside ? COLOR.ok : COLOR.bg, "stroke-width": 3, ...(joined ? { class: "fx-pulse d3" } : {}) });
        if (!w.twin) pen.text(`${k}:b${i}`, { x: at(b), y: y + 50, ...MONO, "text-anchor": "middle", fill: inside ? COLOR.ok : COLOR.muted }, tag(b));
      });
    });
    if (w.formula) {
      const g = GUESTS[0];
      const spans: Span[] = [
        { text: `${FLAG} + ${g} → хэш → % 100 → ` },
        { text: tag(bucket(g)), attrs: { fill: COLOR.ok, "font-weight": 700 } },
      ];
      pen.text("lane:formula", { x: BOTTOM.x, y: 516, ...MONO, fill: COLOR.ink, class: "fx-fade d1" }, spans);
    }
    const y = rows.at(-1)! + 50;
    pen.text("lane:0", { x: LANE.x, y, ...MONO, "text-anchor": "middle", fill: COLOR.faint }, "0");
    pen.text("lane:99", { x: LANE.x + LANE.w, y, ...MONO, "text-anchor": "end", fill: COLOR.faint }, "99");
  }, fade(w, "queue", "console"));
}

/** Стойка отеля: гость с чемоданом, на экране бронь отменена. */
function drawDesk(pen: Pen, w: World): void {
  pen.group("desk", 0, 0, () => {
    panel(pen, "guest:box", tall(w, GUEST));
    person(pen, "desk:p", { x: GUEST.x + 30, y: GUEST.y + 150, shirt: SHIRTS[0], mood: "sad" });
    pen.rect("desk:case", { x: GUEST.x + 84, y: GUEST.y + 170, width: 40, height: 50, rx: 6, fill: COLOR.surface2, stroke: COLOR.muted, "stroke-width": 2 });
    pen.rect("desk:case:h", { x: GUEST.x + 96, y: GUEST.y + 160, width: 16, height: 12, rx: 4, fill: "none", stroke: COLOR.muted, "stroke-width": 2 });
    pen.rect("desk:top", { x: GUEST.x + 14, y: GUEST.y + 230, width: GUEST.w - 28, height: 22, rx: 4, fill: COLOR.surface2 });
    pen.text("desk:t", { x: GUEST.x + 16, y: GUEST.y + 284, ...SANS, fill: COLOR.muted }, "стойка отеля");
    pen.rect("desk:screen", { x: GUEST.x + 14, y: GUEST.y + 40, width: GUEST.w - 28, height: 80, rx: 8, fill: COLOR.alarmBg, stroke: COLOR.error, "stroke-width": 2 });
    pen.text("desk:s1", { x: GUEST.x + 28, y: GUEST.y + 72, ...MONO, fill: COLOR.ink }, "Бронь H-8120");
    pen.text("desk:s2", { x: GUEST.x + 28, y: GUEST.y + 102, ...SANS, "font-weight": 700, fill: COLOR.error }, "отменена");
  }, fade(w, "guest"));
}

/** Поды в рамке: копия правил (отставшая — пунктиром), до обновления, лог, метка «читает at_hotel». */
function drawService(pen: Pen, w: World): void {
  pen.group("svc", 0, 0, () => {
    panel(pen, "svc:box", { ...tall(w, SERVICE), fill: "none", stroke: COLOR.line, shadow: false });
    pen.group("svc:foot", 0, grow(w), () => {
      pen.text("svc:title", { x: SERVICE.x + 16, y: SERVICE.y + SERVICE.h - 14, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Сервис бронирования");
    });
  }, fade(w, ...PODS));
  const lagging = PODS.some((id) => stale(w, w.pods[id]));
  PODS.forEach((id, i) => {
    const p = w.pods[id];
    const { color, tint } = ACTOR[id];
    const busy = w.visits.some((v) => v.by === id);
    const mood = p.hanging ? "wait" : busy ? "work" : "idle";
    pen.group(`pod:${id}`, POD_X, podY(w, id), () => {
      bob(pen, `pod:${id}:bob`, { x: 0, y: 0, color, tint, letter: id, mood, look: { x: 0, y: 0 } });
      if (w.mode === "local" && !w.contracted) {
        const fresh = happened(w, "copy", id) || happened(w, "refresh", id);
        const old = stale(w, p);
        const edge = old ? COLOR.warn : p.copy ? COLOR.ink : COLOR.faint;
        pen.rect(`pod:${id}:card`, { x: CARD_X - POD_X, y: 2, width: 190, height: 30, rx: 6, fill: p.copy ? COLOR.surface2 : "none", stroke: edge, "stroke-width": 2, "stroke-dasharray": p.copy && !old ? "none" : "5 4", ...(fresh ? { class: "fx-flash" } : {}) });
        const rule = p.copy ? (p.copy.on ? `правила: вкл ${p.copy.percent} %` : "правила: выкл") : "правил нет";
        pen.text(`pod:${id}:rule`, { x: CARD_X - POD_X + 10, y: 24, ...SANS, fill: old ? COLOR.warn : p.copy ? COLOR.ink : COLOR.faint }, rule);
        if (p.log) pen.text(`pod:${id}:log`, { x: CARD_X - POD_X, y: 60, ...MONO, fill: COLOR.warn, class: "fx-fade d2" }, p.log === "flags: refresh failed" ? "refresh failed" : "лог: дефолт");
        else if (p.copy && (!lagging || old)) {
          icon(pen, `pod:${id}:ring`, "replay", CARD_X - POD_X, 40, 24, COLOR.muted);
          pen.text(`pod:${id}:in`, { x: CARD_X - POD_X + 30, y: 60, ...SANS, fill: COLOR.muted }, `обновит через ${untilRefresh(w, id)} с`);
        }
      }
      if (p.reads) pill(pen, `pod:${id}:reads`, "читает at_hotel", { x: CARD_X - POD_X, y: w.mode === "local" ? 70 : 14, fill: COLOR.doneBg, color: COLOR.ok, stroke: COLOR.ok, mono: true, attrs: happened(w, "expand") ? { class: `fx-pop d${i + 1}` } : {} });
    }, fade(w, id));
  });
}

/** Стрелки: гость → под на каждом шаге; под → сервис флагов, когда спрашивает; пульт → поды — только в кадре, где пульт переключили. */
function drawArrows(pen: Pen, w: World): void {
  for (const id of new Set(w.visits.map((v) => v.by))) {
    pen.line(`arr:${id}:in`, { x1: GUEST.x + GUEST.w, y1: GUEST.y + 140, x2: POD_X - 4, y2: podY(w, id) + 32, stroke: COLOR.browser, "stroke-width": 2.5, marker: "arrow", ...fade(w, id, "guest"), ...DRAW });
  }
  if (w.mode === "remote") {
    for (const id of PODS) {
      if (!happened(w, "ask", id)) continue;
      pen.line(`arr:${id}:ask`, { x1: POD_X + 68, y1: podY(w, id) + 32, x2: BOOTH.x - 6, y2: BOOTH.y + 60, stroke: ACTOR[id].color, "stroke-width": 2.5, marker: "arrow", ...fade(w, id), ...DRAW });
    }
  }
  const pinged = happened(w, "toggle") || happened(w, "slide");
  if (w.mode === "direct" && pinged && !w.contracted && lit(w, "console") && !w.desk && !w.queue) {
    PODS.forEach((id, i) => {
      pen.line(`arr:${id}:flag`, { x1: CONSOLE.x - 4, y1: CONSOLE.y + 63, x2: w.pods[id].reads ? CARD_X + 200 : POD_X + 72, y2: podY(w, id) + 30, stroke: w.console.on ? COLOR.ok : COLOR.muted, "stroke-width": 2, "stroke-dasharray": "6 5", marker: "arrow", pathLength: 1, class: `fx-draw d${i + 1}` });
    });
  }
}

/** Монетка на телефоне гостя: на каждый запрос — «новая» или «старая» заново. */
function drawCoin(pen: Pen): void {
  const x = GUEST.x + GUEST.w / 2;
  const y = GUEST.y + 186;
  pen.group("coin", x, y, () => {
    pen.rect("coin:face", { x: -22, y: -22, width: 44, height: 44, rx: 22, fill: COLOR.warn, stroke: COLOR.bg, "stroke-width": 3 });
    pen.rect("coin:rim", { x: -15, y: -15, width: 30, height: 30, rx: 15, fill: "none", stroke: COLOR.bg, "stroke-width": 2 });
    icon(pen, "coin:q", "question", -11, -11, 22, COLOR.bg);
  }, { class: "fx-pop d1" });
}

/** Пульт дежурного: рычаг вкл/выкл, число процентов (при выключенном — тире), ползунок 0…99 с ручкой. */
function drawConsole(pen: Pen, w: World, box = CONSOLE, flag = FLAG): void {
  const k = `console:${flag}`;
  const r = w.console;
  const percent = flag === FLAG ? r.percent : 10;
  pen.group(k, 0, 0, () => {
    panel(pen, `${k}:box`, { ...box });
    pen.text(`${k}:t`, { x: box.x + 16, y: box.y + 32, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Пульт");
    pen.text(`${k}:f`, { x: box.x + 84, y: box.y + 32, ...MONO, fill: COLOR.ink }, flag);
    const fresh = happened(w, "toggle") && flag === FLAG;
    pen.rect(`${k}:lever`, { x: box.x + 16, y: box.y + 48, width: 64, height: 30, rx: 15, fill: r.on ? COLOR.doneBg : COLOR.surface2, stroke: r.on ? COLOR.ok : COLOR.line, "stroke-width": 2, ...(fresh ? { class: "fx-pop" } : {}) });
    pen.group(`${k}:lever:knob`, box.x + 16 + (r.on ? 38 : 4), box.y + 52, () => {
      pen.rect(`${k}:lever:knob:c`, { x: 0, y: 0, width: 22, height: 22, rx: 11, fill: r.on ? COLOR.ok : COLOR.muted });
    });
    pen.text(`${k}:on`, { x: box.x + 92, y: box.y + 70, ...SANS, "font-weight": 700, fill: r.on ? COLOR.ok : COLOR.muted }, r.on ? "ВКЛ" : "ВЫКЛ");
    pen.text(`${k}:pct`, { x: box.x + box.w - 16, y: box.y + 72, ...SANS, "font-size": SIZE.accent, "font-weight": 700, "text-anchor": "end", fill: r.on ? COLOR.ink : COLOR.faint }, r.on ? `${percent} %` : "—");
    const y = box.y + (SLIDER.y - CONSOLE.y);
    pen.rect(`${k}:bar`, { x: SLIDER.x, y: y - 5, width: SLIDER.w, height: 10, rx: 5, fill: COLOR.surface2 });
    const cut = SLIDER.x + (SLIDER.w * Math.min(percent, 100)) / 100;
    if (r.on) pen.rect(`${k}:fill`, { x: SLIDER.x, y: y - 5, width: cut - SLIDER.x, height: 10, rx: 5, fill: COLOR.ok });
    pen.group(`${k}:knob`, cut, y, () => {
      pen.rect(`${k}:knob:c`, { x: -11, y: -11, width: 22, height: 22, rx: 11, fill: r.on ? COLOR.ink : COLOR.muted, stroke: COLOR.bg, "stroke-width": 3 });
    });
    if (w.formula && flag === FLAG) pen.text(`${k}:cut`, { x: SLIDER.x - 6, y: y + 36, ...MONO, "font-weight": 700, fill: COLOR.ok, class: "fx-fade d2" }, `бакет < ${percent}`);
    else pen.text(`${k}:0`, { x: SLIDER.x, y: y + 36, ...MONO, "text-anchor": "middle", fill: COLOR.faint }, "0");
    pen.text(`${k}:99`, { x: SLIDER.x + SLIDER.w, y: y + 36, ...MONO, "text-anchor": "middle", fill: COLOR.faint }, "99");
    if (w.contracted && flag === FLAG) {
      pen.rect(`${k}:veil`, { x: box.x, y: box.y, width: box.w, height: box.h, rx: 16, fill: COLOR.bg, opacity: 0.6 });
      icon(pen, `${k}:x`, "cross", box.x + box.w / 2 - 28, box.y + box.h / 2 - 28, 56, COLOR.error, { class: "fx-pop" });
      pen.text(`${k}:gone`, { x: box.x + box.w / 2, y: box.y + box.h + 30, ...SANS, "text-anchor": "middle", "font-weight": 700, fill: COLOR.muted }, "флаг и старая ветка убраны");
    }
  }, fade(w, "console", "queue"));
  const duty = !w.replay && (w.chapter ?? 0) <= 1;
  if (flag === FLAG && duty && !w.twin && !w.dutySay && w.service === null && !w.contracted) mug(pen, "duty:mug", { x: box.x + box.w - 70, y: box.y + box.h + 16, steam: !w.desk });
}

/** Сервис флагов: работает или не отвечает; лежит «не страшно» без красного — в итоге и в кадре дефолта (там герой — `false` в коде). */
function drawBooth(pen: Pen, w: World): void {
  const down = w.service === "down";
  const alarm = down && !w.replay && !w.codeMark;
  pen.group("booth", 0, 0, () => {
    panel(pen, "booth:box", { ...tall(w, BOOTH), stroke: alarm ? COLOR.error : COLOR.line, fill: down ? COLOR.bg2 : COLOR.surface });
    pen.text("booth:t", { x: BOOTH.x + 16, y: BOOTH.y + 34, ...SANS, "font-weight": 700, fill: down ? COLOR.faint : COLOR.ink }, "Сервис флагов");
    pen.text("booth:s", { x: BOOTH.x + 16, y: BOOTH.y + 72, ...SANS, fill: alarm ? COLOR.error : down ? COLOR.faint : COLOR.ok, ...(happened(w, "down") ? { class: "fx-fade" } : {}) }, down ? "не отвечает" : "отвечает");
    if (down) icon(pen, "booth:x", "cross", BOOTH.x + BOOTH.w - 48, BOOTH.y + 16, 32, alarm ? COLOR.error : COLOR.faint);
    pen.text("booth:r", { x: BOOTH.x + 16, y: BOOTH.y + 120, ...MONO, fill: COLOR.muted }, `${FLAG}: вкл`);
  }, fade(w, "service"));
}

/** Postgres: брони; отменённые зачёркнуты, у брони с записанным решением — метка. */
function drawDb(pen: Pen, w: World): void {
  pen.group("db", 0, 0, () => {
    panel(pen, "db:box", { ...tall(w, DB), stroke: COLOR.postgres });
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
      pen.text("db:cancelled", { x: DB.x + 16, y: DB.y + DB.h + grow(w) - 18, ...SANS, "font-weight": 700, fill: COLOR.error }, "отменены");
    }
  }, fade(w, "db"));
}

/** Строка кода пода; подсвеченный кусок (дефолт) — рамкой. */
function drawCode(pen: Pen, w: World): void {
  const h = 40 + w.code.length * 30;
  // В кадре дефолта строка — второй по важности акцент: крупнее.
  const font = { ...MONO, "font-size": w.codeMark ? SIZE.accent : SIZE.say };
  pen.group("code", 0, 0, () => {
    panel(pen, "code:box", { x: BOTTOM.x, y: BOTTOM.y, w: BOTTOM.w, h, fill: "#11172e", stroke: COLOR.muted });
    highlightGo(w.code).forEach((spans, i) => {
      const y = BOTTOM.y + 36 + i * 30;
      pen.text(`code:l${i}`, { x: BOTTOM.x + 20, y, ...font }, spans);
      if (!w.codeMark) return;
      const at = spans.findIndex((s) => s.text === w.codeMark);
      if (at < 0) return;
      const before = spans.slice(0, at).map((s: Span) => s.text).join("");
      const x = BOTTOM.x + 20 + pen.measure(before, font).width;
      const wd = pen.measure(w.codeMark, font).width;
      pen.rect(`code:mark${i}`, { x: x - 4, y: y - 24, width: wd + 8, height: 32, rx: 5, fill: "none", stroke: COLOR.warn, "stroke-width": 2.5, class: "fx-pop d2", ...fade(w, "default") });
    });
  }, fade(w, "code", "default"));
}

const BOXES: { box: Box; label: string }[] = [
  { box: "paid", label: "оплачено: ок" },
  { box: "wait", label: "ждём 30 мин" },
  { box: "cancel", label: "иначе: отменить" },
];

/** Ящики старой ветки: куда ляжет каждая бронь (талон, цвет — как строка в таблице); после expand `at_hotel` — в своём ящике «знаю». */
function drawBoxes(pen: Pen, w: World): void {
  const reads = w.pods.A.reads;
  const list = reads ? [...BOXES.slice(0, 2), { box: "known" as Box, label: "при заселении: ок" }] : BOXES;
  const bw = (BOTTOM.w - 2 * 16) / 3;
  const cancelling = happened(w, "cancel");
  // Красный — когда отмена случилась; до неё ящик ровный, чтобы цвет не опережал голос.
  const cancelled = w.bookings.some((b) => b.cancelled);
  pen.group("boxes", 0, 0, () => {
    list.forEach(({ box, label }, i) => {
      const x = BOTTOM.x + i * (bw + 16);
      const bad = box === "cancel" && cancelled;
      const attrs = bad && cancelling ? { class: "fx-shake d2" } : box === "known" && happened(w, "expand") ? { class: "fx-rise" } : undefined;
      pen.group(`boxes:${box}:g`, 0, 0, () => {
        panel(pen, `boxes:${box}`, { x, y: BOTTOM.y, w: bw, h: BOTTOM.h, fill: bad ? COLOR.alarmBg : COLOR.surface, stroke: bad ? COLOR.error : box === "known" ? COLOR.ok : COLOR.line, shadow: false });
        pen.text(`boxes:${box}:t`, { x: x + 14, y: BOTTOM.y + 30, ...SANS, "font-weight": 700, fill: bad ? COLOR.error : box === "known" ? COLOR.ok : COLOR.ink }, label);
      }, attrs);
      w.bookings.filter((b) => boxOf(b, reads) === box).forEach((b, j) => {
        const y = BOTTOM.y + 46 + j * 32;
        if (y + 28 > BOTTOM.y + BOTTOM.h - 8) return;
        const k = `boxes:${b.id}`;
        pen.group(k, x + 14, y, () => {
          pen.group(`${k}:hop`, 0, 0, () => {
            pen.rect(`${k}:bg`, { x: 0, y: 0, width: bw - 28, height: 28, rx: 6, fill: b.payment === "at_hotel" ? COLOR.draftBg : COLOR.surface2, stroke: b.cancelled ? COLOR.error : "none", "stroke-width": 2 });
            pen.text(`${k}:t`, { x: 10, y: 20, ...MONO, fill: b.cancelled ? COLOR.error : b.payment === "at_hotel" ? COLOR.warn : COLOR.muted }, `${b.id} ${PAYMENT[b.payment]}`);
            if (b.cancelled) pen.line(`${k}:strike`, { x1: 4, y1: 14, x2: bw - 32, y2: 14, stroke: COLOR.error, "stroke-width": 2.5, ...(cancelling ? DRAW : {}) });
          }, b.cancelled && cancelling ? { class: "fx-hop" } : undefined);
        });
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

const STEPS = ["1 · научить читать", "2 · включить запись", "3 · убрать старое"];

/** Contract: три шага по порядку и чего теперь нельзя. */
function drawContract(pen: Pen): void {
  pen.group("contract", 0, 0, () => {
    panel(pen, "contract:box", { x: BOTTOM.x, y: BOTTOM.y, w: BOTTOM.w, h: 110, shadow: false });
    const head = { ...SANS, "font-size": SIZE.accent, "font-weight": 700 };
    pen.text("contract:t", { x: BOTTOM.x + 20, y: BOTTOM.y + 40, ...head, fill: COLOR.ink }, "два деплоя и флаг:");
    let x = BOTTOM.x + 36 + pen.measure("два деплоя и флаг:", head).width;
    STEPS.forEach((s, i) => {
      if (i) {
        pen.text(`contract:a${i}`, { x, y: BOTTOM.y + 40, ...head, fill: COLOR.muted, class: `fx-fade d${i + 1}` }, "→");
        x += 36;
      }
      x += pill(pen, `contract:s${i}`, s, { x, y: BOTTOM.y + 14, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.line, attrs: { class: `fx-pop d${i + 1}` } }) + 14;
    });
    pen.text("contract:s", { x: BOTTOM.x + 20, y: BOTTOM.y + 88, ...SANS, fill: COLOR.warn }, "откатить бинарник ниже «читает at_hotel» — нельзя");
  });
}

/** Итог: Knight Capital — восемь серверов, на восьмом старый код и флаг; ниже зеркальная рифма. */
function drawKnight(pen: Pen, w: World): void {
  const box = { x: 30, y: 104, w: 1210, h: 536 };
  const half = (box.w - 48) / 2;
  pen.group("knight", 0, 0, () => {
    panel(pen, "knight:box", { ...box });
    pen.text("knight:t", { x: box.x + 24, y: box.y + 44, ...SANS, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.ink }, "Knight Capital, 2012");
    for (let i = 0; i < 8; i++) {
      const old = i === 7;
      pen.rect(`knight:srv${i}`, { x: box.x + 24 + i * 86, y: box.y + 76, width: 70, height: 44, rx: 8, fill: old ? COLOR.surface2 : ACTOR.A.color, stroke: old ? COLOR.error : "none", "stroke-width": 3, class: `fx-pop d${Math.min(i, 3)}` });
    }
    pen.text("knight:new", { x: box.x + 24, y: box.y + 150, ...SANS, fill: COLOR.muted }, "новый код");
    pen.text("knight:old", { x: box.x + 24 + 7 * 86, y: box.y + 150, ...SANS, fill: COLOR.error }, "старый");
    pill(pen, "knight:flag", "старый флаг → мёртвый код", { x: box.x + 24 + 8 * 86, y: box.y + 82, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, mono: true });
    const big = { ...SANS, "font-size": SIZE.plate, "font-weight": 700 };
    pen.text("knight:m", { x: box.x + 24, y: box.y + 220, ...big, fill: COLOR.error }, "45 минут");
    pen.text("knight:usd", { x: box.x + 48 + pen.measure("45 минут", big).width, y: box.y + 216, ...SANS, "font-size": SIZE.accent, fill: COLOR.muted }, "около 460 млн долларов");
    [["У нас", "выключили флаг —", "данные остались"], ["У них", "откатили код —", "флаг остался"]].forEach(([who, a, b], i) => {
      const x = box.x + 16 + i * (half + 16);
      const y = box.y + 266;
      panel(pen, `knight:c${i}`, { x, y, w: half, h: 250, fill: COLOR.surface2, shadow: false });
      pen.text(`knight:c${i}:w`, { x: x + 24, y: y + 50, ...SANS, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.ink }, who);
      pen.text(`knight:c${i}:a`, { x: x + 24, y: y + 120, ...SANS, "font-size": SIZE.accent, fill: COLOR.ink }, a);
      pen.text(`knight:c${i}:b`, { x: x + 24, y: y + 160, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.error }, b);
    });
  }, fade(w, "knight"));
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  if (w.term) pill(pen, "term", w.term, { ...TERM, y: w.stamp ? 70 : TERM.y, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
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
    else if (w.queue) drawLane(pen, w);
  }
  pen.layer("top", () => {
    if (w.guestSay) bubble(pen, "guest:say", w.guestSay, { x: GUEST.x + 36, y: GUEST.y + 8, tail: "down", attrs: { class: "fx-pop", ...fade(w, "guest", "queue") } });
    if (w.podSay) bubble(pen, "pod:say", w.podSay.text, { x: POD_X + 32, y: podY(w, w.podSay.by) - 8, tail: "down", attrs: { class: "fx-pop" } });
    if (w.dutySay) bubble(pen, "duty:say", w.dutySay, { x: CONSOLE.x + 4, y: CONSOLE.y + CONSOLE.h + 4, tail: "up", attrs: { class: "fx-pop" } });
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: 300, right: DB.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + 4, y: 44, tail: "right", attrs: { class: "fx-pop" } });
  });
}
