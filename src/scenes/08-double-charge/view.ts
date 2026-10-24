import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, mailFace, type Look, type Mood } from "../../kit/characters";
import { codeWindow } from "../../kit/code";
import { icon } from "../../kit/icons";
import { buyButton, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { render as render01 } from "../01-skip-locked/view";
import { recallWorld } from "./script";
import { ACTORS, AMOUNT, ORDER, type Actor, type ActorId, type Focus, type KeyRow, type SimEvent, type World } from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра.
// Сетка (1280×720): шапка (ярлык, кейс, штамп); слева телефон Иры; в центре поды; справа сверху банк — внешний
// сервис (пунктир; таблица его не видит), под ним наш Postgres — рамка со слоном вокруг payments и idempotency_keys,
// стрелки подов входят в неё; внизу справа табло, внизу слева SQL. Ниже SAFE_BOTTOM — пусто.

const PHONE = { x: 40, y: 120, w: 220, h: 330 };
const POD = { x: 360 };
const POD_Y: Record<ActorId, number> = { A: 150, B: 340 };
const POD_SCALE = 1.2;
const PB = { w: BOB.w * POD_SCALE, h: BOB.h * POD_SCALE };
const BANK = { x: 750, y: 104, w: 490, h: 128 };
/** Наш Postgres: рамка вокруг таблиц, слон — в её шапке. */
export const PG = { x: 750, y: 246, w: 490, h: 260 };
const TABLE = { x: 758, w: 474, rowH: 38, gap: 4 };
const PAY_Y = 330;
const KEYS_Y = 462;
const BOARD = { x: 750, y: 516, w: 490, rowH: 26 };
const BOTTOM = 650;
/** Значок кейса и ярлык акта: в шапке им тесно с репликой Postgres. */
export const CHAPTER = { x: 1150, y: 22 };
const TERM = { x: 750, y: 62 };
/** Правый край шапки для реплики Postgres и штампа перемотки. */
export const HEADER_RIGHT = CHAPTER.x - 12;
/** Колонки idempotency_keys; с locked_until ответ сжат до кода — текст ответа виден на телефоне. */
const COL = { key: 10, status: 84, response: 214, lease: 0 };
const COL_LEASE = { key: 10, status: 84, response: 206, lease: 330 };
/** Строка payments ниже строки ключа: две строки платежей не упираются в заголовок idempotency_keys. */
const PAY_ROW = 32;
/** Балансировщик: узел между телефоном и подами — только в кадрах, где о нём говорит голос. */
const LB = { x: 312, y: 290, r: 16 };

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };
/** Стрелки пода — по порядку действий: запрос, банк, база, ответ. */
const drawIn = (n: number) => ({ pathLength: 1, class: `fx-draw${n ? ` d${Math.min(n, 3)}` : ""}` });
const cols = (w: World) => (w.keyCols?.includes("lease") ? COL_LEASE : COL);

const podMid = (id: ActorId) => POD_Y[id] + PB.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const rub = (n: number) => `${n.toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
const time = (t: number) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600) % 24)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
};

/** Телефон Иры: сеть, экран оплаты, ключ попытки, баланс карты. */
function drawPhone(pen: Pen, w: World): void {
  const p = w.phone;
  const { x, y, w: pw, h } = PHONE;
  pen.group("phone", 0, 0, () => {
    panel(pen, "phone:box", { x, y, w: pw, h, rx: 24, fill: COLOR.bg2, stroke: COLOR.browser });
    person(pen, "phone:ira", { x: x + 16, y: y + 16, shirt: COLOR.browser, mood: p.screen === "paid" ? "happy" : p.screen === "error" || p.screen === "used" ? "sad" : "idle", look: { x: 1, y: 0 } });
    pen.text("phone:name", { x: x + 72, y: y + 46, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Ира");
    // Сеть: четыре палочки; в туннеле — серые и крестик.
    [0, 1, 2, 3].forEach((i) => pen.rect(`phone:bar${i}`, {
      x: x + pw - 64 + i * 10, y: y + 44 - (i + 1) * 6, width: 6, height: (i + 1) * 6, rx: 1, fill: p.tunnel ? COLOR.faint : COLOR.ok,
    }));
    if (p.tunnel) icon(pen, "phone:nosig", "cross", x + pw - 30, y + 22, 22, COLOR.error);
    // Экран оплаты.
    const sx = x + 16;
    const sy = y + 84;
    pen.rect("phone:screen", { x: sx, y: sy, width: pw - 32, height: 170, rx: 12, fill: COLOR.surface, stroke: COLOR.line, "stroke-width": 1.5 });
    pen.text("phone:item", { x: sx + 14, y: sy + 32, ...SANS, fill: COLOR.muted }, `Кроссовки · ${rub(AMOUNT)}`);
    const [k, fx] = once("phone:state", w.frame, happened(w, "reply") || happened(w, "busy") || happened(w, "press") ? "fx-pop" : null);
    pen.group(k, 0, 0, () => {
      const by = sy + 100;
      const bold = { ...SANS, "font-weight": 700 };
      if (p.screen === "buy") buyButton(pen, `${k}:btn`, { x: sx + 14, y: by - 30, pressed: false, label: "Оплатить", w: 160 });
      if (p.screen === "spin") {
        buyButton(pen, `${k}:btn`, { x: sx + 14, y: by - 30, pressed: true, label: "Оплата…", w: 160 });
        pen.group(`${k}:spin`, sx + 80, by + 18, () => icon(pen, `${k}:spin:i`, "replay", 0, 0, 26, COLOR.muted), { class: "fx-spin" });
      }
      if (p.screen === "error") {
        pen.text(`${k}:t`, { x: sx + 14, y: by - 14, ...bold, fill: COLOR.error }, "Ошибка сети");
        buyButton(pen, `${k}:btn`, { x: sx + 14, y: by + 4, pressed: false, label: "Повторить", w: 160 });
      }
      if (p.screen === "paid") iconText(pen, `${k}:t`, "check", sx + 14, by, "Оплачено", COLOR.ok, bold);
      if (p.screen === "used") {
        iconText(pen, `${k}:t`, "cross", sx + 14, by - 10, "Ключ уже", COLOR.error, bold);
        pen.text(`${k}:t2`, { x: sx + 39, y: by + 14, ...bold, fill: COLOR.error }, "использован");
      }
      if (p.screen === "busy") iconText(pen, `${k}:t`, "hourglass", sx + 14, by, "Ещё в работе…", COLOR.warn, bold);
    }, fx);
    if (p.key) iconText(pen, "phone:key", "key", x + 16, y + 280, p.key, COLOR.warn, { ...MONO, "font-weight": 700 });
    pen.text("phone:bal", { x: x + 16, y: y + h - 22, ...SANS, fill: p.balance < 5000 - AMOUNT ? COLOR.error : COLOR.ink, "font-weight": 600 }, `Карта · ${rub(p.balance)}`);
    if (w.doubt) pen.text("phone:doubt", { x: x + pw - 6, y: y + 10, "font-family": FONT.sans, "font-size": SIZE.plate, "font-weight": 800, fill: COLOR.warn, "text-anchor": "middle", class: "fx-pop" }, "?");
  }, fade(w, "phone"));
  if (p.thought) bubble(pen, "phone:think", p.thought, { x: x + 110, y: y + h + 4, tail: "up", thought: true, attrs: fade(w, "phone") });
}

/** Стрелки пода: запрос от телефона (с ключом), ответ телефону (потерян — обрыв), вызов банка, запись в таблицу. */
function drawArrows(pen: Pen, w: World): void {
  const phoneEdge = PHONE.x + PHONE.w + 6;
  for (const id of ACTORS) {
    const a = w.actors[id];
    const color = ACTOR[id].color;
    const left = POD.x - 8;
    const right = POD.x + PB.w + 8;
    const mid = podMid(id);
    // Стрелки упавшего пода — следы уже случившегося: бледнее и без ключа.
    const op = fade(w, id).opacity * (a.dead ? 0.35 : 1);
    a.acts.forEach((x, n) => {
      const k = `arr:${id}:${n}`;
      const draw = drawIn(n);
      // В кадрах балансировщика запрос идёт через его узел — ветку рисует drawBalancer.
      if (x.kind === "req" && !w.focus?.includes("lb")) {
        pen.line(k, { x1: phoneEdge, y1: mid - 14, x2: left, y2: mid - 14, stroke: color, "stroke-width": 3, marker: "arrow", opacity: op, ...draw });
        if (x.key && !a.dead) icon(pen, `${k}:key`, "key", (phoneEdge + left) / 2 - 13, mid - 46, 26, COLOR.warn, { opacity: op });
      }
      if (x.kind === "reply") {
        const tone = x.tone === "ok" ? COLOR.ok : x.tone === "warn" ? COLOR.warn : COLOR.error;
        const x2 = x.lost ? (phoneEdge + left) / 2 + 4 : phoneEdge;
        pen.line(k, { x1: left, y1: mid + 14, x2, y2: mid + 14, stroke: tone, "stroke-width": 3, opacity: op, ...(x.lost ? { "stroke-dasharray": "6 5" } : { marker: "arrow" }), ...draw });
        if (x.lost) icon(pen, `${k}:x`, "cross", x2 - 26, mid + 3, 22, COLOR.error, { opacity: op, class: "fx-pop d3" });
      }
      if (x.kind === "bank") {
        const y2 = BANK.y + 50 + (id === "A" ? 0 : 30);
        pen.line(k, { x1: right, y1: mid - 6, x2: BANK.x - 8, y2, stroke: x.replayed ? COLOR.ok : color, "stroke-width": 4, marker: "arrow", opacity: op, ...draw });
        if (x.key && !a.dead) icon(pen, `${k}:key`, "key", (right + BANK.x) / 2 - 13, (mid + y2) / 2 - 32, 26, COLOR.warn, { opacity: op });
      }
      if (x.kind === "db") {
        const y2 = x.table === "payments" ? PAY_Y + PAY_ROW / 2 : KEYS_Y + TABLE.rowH / 2;
        pen.line(k, { x1: right, y1: mid + 10, x2: TABLE.x - 8, y2, stroke: color, "stroke-width": 2, "stroke-dasharray": "4 4", marker: "arrow", opacity: op, ...draw });
      }
    });
    if (a.atBank) {
      pen.line(`wait:${id}`, { x1: right, y1: mid - 6, x2: BANK.x - 8, y2: BANK.y + 50, stroke: color, "stroke-width": 3, "stroke-dasharray": "7 6", opacity: op });
    }
  }
}

function podMood(a: Actor): Mood {
  if (a.atBank) return "wait";
  if (a.acts.some((x) => x.kind === "reply" && x.tone === "ok" && !x.lost)) return "won";
  if (a.acts.length) return "work";
  return "idle";
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(a);
  const look: Look = a.atBank || a.acts.some((x) => x.kind === "bank") ? { x: 1, y: -0.3 } : a.acts.length ? { x: -1, y: 0 } : { x: 0, y: 0 };
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxOnce] = once(`pod:${a.id}:fx`, w.frame, happened(w, "crash", a.id) ? "fx-jolt" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood, look, ghost: a.dead, dashed: mood === "wait" }),
    a.dead ? fxOnce : mood === "wait" ? { class: "fx-breathe" } : {}, { scale: POD_SCALE });
    const nx = PB.w + 16;
    // Подпись и «OOM Killer» — под телом пода: справа идут стрелки в банк и базу.
    pen.text(`pod:${a.id}:label`, { x: PB.w / 2, y: PB.h + 22, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: a.dead ? COLOR.faint : color, "text-anchor": "middle" }, a.label);
    if (a.dead) {
      const [dk, dfx] = once(`pod:${a.id}:dead`, w.frame, happened(w, "crash", a.id) ? "fx-pop" : null);
      pen.group(dk, PB.w / 2 - 56, PB.h + 32, () => pill(pen, `${dk}:p`, "OOM Killer", { x: 0, y: 0, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error }), dfx);
    } else if (a.atBank) iconText(pen, `pod:${a.id}:bank`, "hourglass", nx, 20, "ждёт банк", COLOR.warn, { ...SANS, "font-weight": 600 });
    if (a.thought) bubble(pen, `pod:${a.id}:think`, a.thought, { x: nx - 4, y: 64, tail: "left", thought: true });
    if (a.crossed) {
      const ty = 64;
      const b = bubble(pen, `pod:${a.id}:crossed`, a.crossed, { x: nx - 4, y: ty, tail: "left", thought: true, attrs: { opacity: 0.4 } });
      pen.line(`pod:${a.id}:strike`, { x1: nx + 8, y1: ty, x2: nx + 8 + b.w, y2: ty, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", ...DRAW });
    }
  }, fade(w, a.id));
}

/** Балансировщик: узел с вилкой, ветки к подам; в кадре повтора — только ветка на под запроса. */
function drawBalancer(pen: Pen, w: World): void {
  if (!w.focus?.includes("lb")) return;
  const to = ACTORS.filter((id) => !w.actors[id].acts.length || w.actors[id].acts.some((x) => x.kind === "req"));
  const all = to.length === ACTORS.length;
  pen.group("lb", 0, 0, () => {
    const one = all ? null : ACTOR[to[0]].color;
    pen.line("lb:in", { x1: PHONE.x + PHONE.w + 6, y1: LB.y, x2: LB.x - LB.r - 4, y2: LB.y, stroke: one ?? COLOR.muted, "stroke-width": one ? 3 : 2, marker: "arrow", ...drawIn(0) });
    to.forEach((id) => pen.line(`lb:to${id}`, {
      x1: LB.x + LB.r, y1: LB.y, x2: POD.x - 10, y2: podMid(id), stroke: ACTOR[id].color,
      ...(all ? { "stroke-width": 2, "stroke-dasharray": "4 4", opacity: 0.6 } : { "stroke-width": 3 }), marker: "arrow", ...drawIn(1),
    }));
    pen.rect("lb:node", { x: LB.x - LB.r, y: LB.y - LB.r, width: LB.r * 2, height: LB.r * 2, rx: LB.r, fill: COLOR.bg2, stroke: COLOR.muted, "stroke-width": 2, class: "fx-pop" });
    pen.path("lb:fork", { d: `M${LB.x - 8} ${LB.y}H${LB.x}M${LB.x} ${LB.y}L${LB.x + 7} ${LB.y - 7}M${LB.x} ${LB.y}L${LB.x + 7} ${LB.y + 7}`, stroke: COLOR.muted, "stroke-width": 2, fill: "none" });
    // Подпись — в просвете между подами, правее веток: слева телефон.
    pen.text("lb:name", { x: POD.x - 4, y: LB.y + 6, ...SANS, fill: COLOR.muted }, "балансировщик");
  }, fade(w, "lb"));
}

/** Банк: окошко и журнал списаний с карты; второе списание той же попытки — красным. */
function drawBank(pen: Pen, w: World): void {
  const { x, y, w: bw, h } = BANK;
  const alarm = happened(w, "double");
  pen.group("bank", 0, 0, () => {
    panel(pen, "bank:box", { x, y, w: bw, h, stroke: alarm ? COLOR.error : COLOR.mail, attrs: { "stroke-dasharray": "8 6" } });
    mailFace(pen, "bank:face", { x: x + 26, y: y + 12, mood: alarm ? "alarm" : happened(w, "replayed") ? "relieved" : w.ledger.length ? "calm" : "asleep" });
    pen.text("bank:title", { x: x + 76, y: y + 26, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.mail }, "Банк");
    pen.text("bank:ext", { x: x + bw - 4, y: y - 12, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, "внешний сервис");
    w.ledger.forEach((c, i) => {
      // Второе списание за те же кроссовки — красным, даже если сервер считал его новой попыткой.
      const dup = i > 0;
      const fresh = happened(w, i === w.ledger.length - 1 ? (dup ? "double" : "charge") : "page");
      const [k, fx] = once(`bank:row${i}`, w.frame, fresh ? "fx-slide" : null);
      pen.group(k, x + 16, y + 52 + i * 36, () => {
        pen.rect(`${k}:bg`, { width: bw - 32, height: 32, rx: 6, fill: dup ? COLOR.alarmBg : COLOR.surface2, stroke: dup ? COLOR.error : COLOR.line, "stroke-width": 1.5 });
        pen.text(`${k}:t`, { x: 12, y: 22, ...MONO, fill: dup ? COLOR.error : COLOR.ink, "font-weight": 700 }, `−${rub(c.amount)} · заказ ${c.order}`);
        if (c.key) iconText(pen, `${k}:key`, "key", bw - 32 - 110, 22, c.key, COLOR.warn, MONO);
      }, fx);
    });
  }, fade(w, "bank"));
  if (w.bank) bubble(pen, "bank:say", w.bank, { x: x + 130, y: y + 20, tail: "left", attrs: { class: "fx-pop" } });
}

/** Наш Postgres: рамка со слоном и таблицами payments и idempotency_keys (колонки — по `keyCols`); часы БД — только в кейсе 2. */
function drawTables(pen: Pen, w: World): void {
  const rows = w.keys.length;
  const h = Math.max(PG.h, KEYS_Y + rows * (TABLE.rowH + TABLE.gap) + 2 - PG.y);
  panel(pen, "pg:box", { x: PG.x, y: PG.y, w: PG.w, h, fill: COLOR.bg2, stroke: COLOR.postgres, attrs: fade(w, "payments", "keys", "db") });
  // Хмурится только на отказ вставки, когда повтор ещё не получил ответа; сохранённый ответ и 409 — не беда.
  const answered = ACTORS.some((id) => w.actors[id].acts.some((x) => x.kind === "reply" && x.tone !== "error"));
  const bad = happened(w, "conflict") && !answered;
  const [dbKey, dbFx] = once("db:nod", w.frame, bad ? "fx-nod" : null);
  const busy = ["insert", "done", "takeover"].some((k) => happened(w, k as SimEvent["kind"]));
  const look = w.db ? { x: 1, y: 0.2 } : busy ? { x: 0.3, y: 1 } : { x: 0, y: 0 };
  pen.group("pg:head", 0, 0, () => {
    pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: PG.x + 22, y: PG.y + 6, talking: !!w.db, scale: 0.8, look, frown: bad }), dbFx);
    pen.text("db:name", { x: PG.x + 70, y: PG.y + 32, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  }, fade(w, "payments", "keys", "db"));
  pen.text("pay:hdr", { x: TABLE.x + 10, y: PAY_Y - 10, ...MONO, fill: COLOR.muted, ...fade(w, "payments") }, "payments");
  w.payments.forEach((p, i) => {
    const k = `pay:${i}`;
    const [gk, fx] = once(k, w.frame, happened(w, "insert", p.by) && i === w.payments.length - 1 ? "fx-pop" : null);
    pen.group(gk, TABLE.x, PAY_Y + i * (PAY_ROW + TABLE.gap), () => {
      pen.rect(`${k}:bg`, { width: TABLE.w, height: PAY_ROW, rx: 6, fill: COLOR.surface, stroke: i > 0 ? COLOR.error : COLOR.line, "stroke-width": 1.5 });
      pen.rect(`${k}:dot`, { x: 12, y: 10, width: 12, height: 12, rx: 6, fill: ACTOR[p.by].color });
      pen.text(`${k}:t`, { x: 36, y: 22, ...MONO, fill: COLOR.ink }, `order_id ${p.order} · ${p.amount}`);
    }, { ...fade(w, "payments"), ...fx });
  });
  if (!w.keyCols) return;
  const shown = w.keyCols;
  const col = cols(w);
  const leased = leaseSet(w);
  pen.group("keys:hdr", 0, 0, () => {
    pen.text("keys:name", { x: TABLE.x + 10, y: KEYS_Y - 34, ...MONO, fill: COLOR.muted }, "idempotency_keys");
    const names: [keyof typeof COL, string][] = [["key", "key"], ["status", "status"], ["response", "response"], ["lease", "locked_until"]];
    names.filter(([c]) => c === "key" || (c === "lease" ? shown.includes("lease") : shown.includes("status")))
      .forEach(([c, label]) => pen.text(`keys:h:${c}`, { x: TABLE.x + col[c], y: KEYS_Y - 10, ...MONO, fill: c === "lease" && leased ? COLOR.warn : COLOR.faint }, label));
  }, fade(w, "keys"));
  w.keys.forEach((r, i) => drawKey(pen, w, r, i));
  if (w.clockShown) {
    pen.group("clock", 0, 0, () => {
      icon(pen, "clock:i", "clock", TABLE.x + TABLE.w - 130, KEYS_Y - 52, 22, COLOR.muted);
      pen.text("clock:t", { x: TABLE.x + TABLE.w, y: KEYS_Y - 34, "font-family": FONT.mono, "font-size": SIZE.body, "font-weight": 700, fill: COLOR.ink, "text-anchor": "end" }, time(w.clock));
    }, { ...fade(w, "keys"), ...(happened(w, "tick") || leased ? { class: "fx-pulse" } : {}) });
  }
}

/** Ключ только что занят со сроком: срок получает при захвате — подсветить заголовок и ячейку. */
function leaseSet(w: World): boolean {
  return !!w.keyCols?.includes("lease") && w.keys.some((r) => r.lockedUntil !== null && happened(w, "insert", r.by));
}

function drawKey(pen: Pen, w: World, r: KeyRow, i: number): void {
  const shown = w.keyCols!;
  const col = cols(w);
  const k = `keys:${i}`;
  const owner = w.actors[r.by];
  const done = r.status === "done";
  const fresh = happened(w, "insert", r.by) || happened(w, "done", r.by) || happened(w, "takeover", r.by);
  const [gk, fx] = once(k, w.frame, fresh ? "fx-pop" : null);
  pen.group(gk, TABLE.x, KEYS_Y + i * (TABLE.rowH + TABLE.gap), () => {
    pen.rect(`${k}:bg`, {
      width: TABLE.w, height: TABLE.rowH, rx: 6, fill: done ? COLOR.doneBg : COLOR.surface,
      stroke: owner.dead && !done ? COLOR.faint : ACTOR[r.by].color, "stroke-width": 2, ...(owner.dead && !done ? { "stroke-dasharray": "6 4" } : {}),
    });
    pen.text(`${k}:key`, { x: col.key, y: 25, ...MONO, fill: COLOR.warn, "font-weight": 700 }, r.key);
    if (shown.includes("status")) {
      pen.text(`${k}:st`, { x: col.status, y: 25, ...MONO, fill: done ? COLOR.ok : COLOR.warn }, r.status);
      const resp = r.response && shown.includes("lease") ? r.response.split(" ")[0] : r.response;
      pen.text(`${k}:resp`, { x: col.response, y: 25, ...MONO, fill: r.response ? COLOR.ink : COLOR.faint }, resp ?? "—");
    }
    if (shown.includes("lease")) {
      const expired = r.lockedUntil !== null && r.lockedUntil < w.clock;
      if (leaseSet(w) && r.lockedUntil !== null) {
        pen.rect(`${k}:leasebg`, { x: col.lease - 8, y: 6, width: 104, height: TABLE.rowH - 12, rx: 6, fill: COLOR.draftBg, stroke: COLOR.warn, "stroke-width": 1.5, class: "fx-pop" });
      }
      pen.text(`${k}:lease`, { x: col.lease, y: 25, ...MONO, fill: expired ? COLOR.error : leaseSet(w) ? COLOR.warn : COLOR.muted }, r.lockedUntil === null ? "—" : time(r.lockedUntil));
    }
  }, { ...fade(w, "keys"), ...fx });
}

function drawHeader(pen: Pen, w: World): void {
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER.x - 20, y: CHAPTER.y, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

/** Почему ключ — не номер заказа: две законные попытки одного заказа. */
function drawAttempts(pen: Pen): void {
  pen.rect("scrim", { x: 0, y: 0, width: STAGE.w, height: SAFE_BOTTOM, fill: COLOR.bg, opacity: 0.94, class: "fx-fade" });
  panel(pen, "att:box", { x: 300, y: 200, w: 680, h: 230 });
  pen.text("att:title", { x: 336, y: 250, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, `Заказ ${ORDER} · ${rub(AMOUNT)}`);
  const rows: [string, string, boolean][] = [["карта ··1234", "банк отказал", false], ["карта ··5678", "оплачено", true]];
  rows.forEach(([card, result, ok], i) => {
    const y = 310 + i * 70;
    pen.group(`att:r${i}`, 0, 0, () => {
      pen.text(`att:c${i}`, { x: 336, y, ...SANS, "font-size": SIZE.accent, fill: COLOR.ink }, `Попытка ${i + 1} · ${card}`);
      iconText(pen, `att:s${i}`, ok ? "check" : "cross", 700, y, result, ok ? COLOR.ok : COLOR.error, { ...SANS, "font-size": SIZE.accent, "font-weight": 700 });
    }, { class: `fx-rise d${i + 1}` });
  });
}

export function render(pen: Pen, w: World): void {
  // Вспомним Почту: кадр 01 его же отрисовкой; поверх — только штамп перемотки.
  if (w.flashback !== null) {
    render01(pen, recallWorld(w.flashback));
    pen.layer("top", () => {
      // Говорим о Почте и ключе: таблица очереди, слон и часы БД — фоном.
      pen.rect("recall:dim1", { x: 0, y: 0, width: 610, height: 400, fill: COLOR.bg, opacity: 0.6 });
      pen.rect("recall:dim2", { x: 1050, y: 0, width: 230, height: 110, fill: COLOR.bg, opacity: 0.6 });
      if (w.stamp) stamp(pen, w.stamp, { left: PHONE.x, right: HEADER_RIGHT });
    });
    return;
  }
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  if (w.term) pill(pen, "term", w.term, { x: TERM.x, y: TERM.y, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  drawTables(pen, w);
  drawBank(pen, w);
  if (w.board && lit(w, "board")) board(pen, w.board, { ...BOARD, lampX: [262, 412], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: PHONE.x, bottom: BOTTOM, attrs: fade(w, "sql") });
  drawArrows(pen, w);
  drawBalancer(pen, w);
  drawPhone(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    if (w.code) pen.rect("scrim", { x: 0, y: 0, width: STAGE.w, height: SAFE_BOTTOM, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
    codeWindow(pen, w.code, { rows: w.code?.lines.length ?? 1 });
    if (w.aside === "attempts") drawAttempts(pen);
    // Значок кейса — поверх затемнения кода и вставки, под плашкой кейса.
    drawHeader(pen, w);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: PHONE.x, right: HEADER_RIGHT });
    if (w.db) bubble(pen, "db:say", w.db, { x: PG.x + 172, y: PG.y + 25, tail: "left", attrs: { class: "fx-pop" } });
  });
}
