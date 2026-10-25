import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, mailFace, type Look, type Mood } from "../../kit/characters";
import { codeWindow } from "../../kit/code";
import { icon } from "../../kit/icons";
import { lock, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { render as render08 } from "../08-double-charge/view";
import { recallWorld } from "./script";
import {
  ACTORS, AMOUNT, BALANCE, IRA, LEASE, SUBS, leaders, times, type Actor, type ActorId, type Focus, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра.
// Сетка (1280×720): шапка (ярлык, кейс, штамп); слева Ира; в центре три пода, от каждого — провод соединения в базу
// (на нём висит advisory lock); справа сверху банк — внешний сервис (пунктир), под ним наш Postgres — рамка со слоном
// вокруг subscriptions, charges и leader; внизу справа табло, внизу слева SQL. Ниже SAFE_BOTTOM — пусто.

const IRA_BOX = { x: 40, y: 120, w: 220, h: 300 };
const POD = { x: 360 };
const POD_Y: Record<ActorId, number> = { A: 130, B: 270, C: 410 };
const BANK = { x: 750, y: 104, w: 490, h: 150 };
/** Наш Postgres: рамка вокруг таблиц, слон — в её шапке. */
export const PG = { x: 750, y: 268, w: 490, h: 238 };
const TABLE = { x: 758, w: 474 };
const SUBS_Y = PG.y + 78;
const CHARGES_Y = PG.y + 138;
const LEADER_Y = PG.y + 202;
const BOARD = { x: 750, y: 516, w: 490, rowH: 26 };
/** Табло помещается над SAFE_BOTTOM только с тремя попытками: прошлые уходят за край. */
const BOARD_ROWS = 3;
const BOTTOM = 650;
/** Значок кейса и ярлык акта: в шапке им тесно с репликой Postgres. */
export const CHAPTER = { x: 1150, y: 22 };
const TERM = { x: 750, y: 62 };
/** Правый край шапки для реплики Postgres и штампа перемотки. */
export const HEADER_RIGHT = CHAPTER.x - 12;

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const drawIn = (n: number) => ({ pathLength: 1, class: `fx-draw${n ? ` d${Math.min(n, 3)}` : ""}` });

const podMid = (id: ActorId) => POD_Y[id] + BOB.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const rub = (n: number) => `${n.toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (t: number) => `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}`;
const hhmmss = (t: number) => `${hhmm(t)}:${pad(t % 60)}`;
const visible = (w: World) => ACTORS.filter((id) => !w.actors[id].hidden);
/** Job из CronJob — посторонний исполнитель, а не ожививший под A: серый, буква J. */
const isJob = (a: Actor) => a.label === "Job";
const colorOf = (a: Actor) => (isJob(a) ? { color: COLOR.muted, tint: COLOR.surface2 } : ACTOR[a.id]);
/** Строка журнала банка, в которую приходит списание подписки: стрелка упирается в неё. */
function rowY(w: World, sub: number): number {
  const i = SUBS.filter((s) => times(w, s.id) > 0).findIndex((s) => s.id === sub);
  return BANK.y + 52 + Math.max(i, 0) * 32 + 14;
}

/** Скачок часов в этом кадре, если он больше секунд «между делом»: «+1 мин», «+2 ч», «+20 с». */
function jump(w: World): string | null {
  const n = w.events.find((e) => e.kind === "tick")?.n ?? 0;
  if (n < 20) return null;
  return n >= 3600 ? `+${Math.round(n / 3600)} ч` : n >= 60 ? `+${Math.round(n / 60)} мин` : `+${n} с`;
}

/** Ира: время ночи, спит или нет, уведомления о списаниях, баланс карты. */
function drawIra(pen: Pen, w: World): void {
  const { x, y, w: bw, h } = IRA_BOX;
  const ira = w.ira;
  pen.group("ira", 0, 0, () => {
    panel(pen, "ira:box", { x, y, w: bw, h, rx: 24, fill: COLOR.bg2, stroke: COLOR.browser });
    person(pen, "ira:p", { x: x + 16, y: y + 16, shirt: COLOR.browser, mood: ira.asleep ? "idle" : ira.notes > 1 ? "sad" : "happy" });
    pen.text("ira:name", { x: x + 72, y: y + 46, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Ира");
    pen.text("ira:time", { x: x + bw - 16, y: y + 46, ...MONO, fill: COLOR.muted, "text-anchor": "end" }, hhmm(w.clock));
    const j = w.shown.clock ? null : jump(w);
    if (j) pill(pen, "ira:jump", j, { x: x + bw - 16 - 90, y: y - 34, fill: COLOR.surface2, color: COLOR.warn, stroke: COLOR.warn, mono: true, attrs: { class: "fx-pop" } });
    if (ira.asleep) icon(pen, "ira:zz", "sleep", x + 130, y + 60, 26, COLOR.muted);
    pen.text("ira:plan", { x: x + 16, y: y + 100, ...SANS, fill: COLOR.muted }, `Плюс · ${rub(AMOUNT)}/мес`);
    // Лишнее уведомление красное, только если и денег ушло лишнее: при ключе у банка три письма — про одно списание.
    const low = ira.balance < BALANCE - AMOUNT;
    for (let i = 0; i < Math.min(ira.notes, 3); i++) {
      const bad = i > 0 && low;
      const [k, fx] = once(`ira:note${i}`, w.frame, happened(w, "note") ? `fx-slide d${Math.min(i + 1, 3)}` : null);
      pen.group(k, x + 16, y + 120 + i * 40, () => {
        pen.rect(`${k}:bg`, { width: bw - 32, height: 32, rx: 8, fill: bad ? COLOR.alarmBg : COLOR.surface2, stroke: bad ? COLOR.error : COLOR.line, "stroke-width": 1.5 });
        iconText(pen, `${k}:t`, "mail", 10, 22, `Списано ${rub(AMOUNT)}`, bad ? COLOR.error : COLOR.ink, SANS);
      }, fx);
    }
    pen.text("ira:bal", { x: x + 16, y: y + h - 22, ...SANS, fill: low ? COLOR.error : COLOR.ink, "font-weight": 600 }, `Карта · ${rub(ira.balance)}`);
  }, fade(w, "ira"));
}

/** Провода соединений под → база; advisory lock висит на проводе своего пода. Молчащее соединение — пунктир. */
function drawConns(pen: Pen, w: World): void {
  if (!w.shown.conns) return;
  const x1 = POD.x + BOB.w + 10;
  const x2 = PG.x - 6;
  for (const id of visible(w)) {
    const a = w.actors[id];
    const y1 = podMid(id) + 12;
    const y2 = PG.y + 40 + ACTORS.indexOf(id) * 18;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // Соединение закрыто: провода нет; в кадре закрытия замок открывается и гаснет на месте.
    if (a.conn === "closed") {
      if (happened(w, "unlock", id)) lockTag(pen, `unlock:${id}:${w.frame}`, mx, my, ACTOR[id].color, true);
      continue;
    }
    // Молчащее соединение — цветом пода, но бледным пунктиром: провод умер, а замок на нём жив.
    const silent = a.conn === "silent";
    pen.line(`conn:${id}`, {
      x1, y1, x2, y2, stroke: ACTOR[id].color, "stroke-width": 2.5, opacity: silent ? 0.5 : 0.8,
      ...(silent ? { "stroke-dasharray": "10 8" } : {}),
    });
    // Связь пропала у живого пода — разрыв на проводе.
    if (silent) {
      const [ck, cfx] = once(`conn:${id}:cut`, w.frame, happened(w, "cut", id) || happened(w, "silent", id) ? "fx-pop" : null);
      pen.group(ck, mx - 60, my - (my - y1) * 0.4, () => [0, 10].forEach((dx, i) =>
        pen.line(`${ck}:${i}`, { x1: dx, y1: -8, x2: dx + 6, y2: 8, stroke: COLOR.error, "stroke-width": 3, "stroke-linecap": "round" })), cfx);
    }
    if (w.lockBy === id) {
      const [lk] = once(`lock:${id}`, w.frame, happened(w, "lock", id) ? "fx-pop" : null);
      lockTag(pen, lk, mx, my, ACTOR[id].color, false, happened(w, "lock", id));
      // Носитель «замок у соединения»: провод с замком назван в кейсе 1.
      if (w.chapter === 1) pen.text(`lock:${id}:conn`, { x: mx + 6, y: my + 46, ...SANS, fill: COLOR.muted, "text-anchor": "middle" }, "соединение");
    }
  }
}

/** Замок 9001 на проводе: бирка-подложка, чтобы провод не резал корпус; `open` — отпущен и гаснет. */
function lockTag(pen: Pen, key: string, mx: number, my: number, color: string, open: boolean, fresh = false): void {
  pen.group(key, mx - 40, my - 22, () => {
    pen.rect(`${key}:bg`, { width: 92, height: 44, rx: 10, fill: COLOR.bg2, stroke: color, "stroke-width": 2 });
    pen.group(`${key}:l`, 8, 6, () => lock(pen, `${key}:lk`, {
      x: 0, y: 0, color, open, shackle: open ? { class: "fx-unlock" } : fresh ? { class: "fx-lock" } : {},
    }), {}, { scale: 1.4 });
    pen.text(`${key}:n`, { x: 44, y: 29, ...MONO, fill: COLOR.ink, "font-weight": 700 }, "9001");
  }, open ? { class: "fx-fade", opacity: 0.5 } : fresh ? { class: "fx-pop" } : {});
}

/** Стрелки пода в банк: ключ на стрелке, пустое место ключа, повтор, узнанный банком, — зелёным. */
function drawArrows(pen: Pen, w: World): void {
  const right = POD.x + BOB.w + 8;
  for (const id of visible(w)) {
    const a = w.actors[id];
    const op = fade(w, id).opacity * (a.dead ? 0.35 : 1);
    const mid = podMid(id) - 8;
    const color = colorOf(a).color;
    const banks = a.acts.filter((x) => x.kind === "bank");
    banks.forEach((x, n) => {
      if (x.kind !== "bank") return;
      const k = `arr:${id}:${n}`;
      pen.line(k, { x1: right, y1: mid, x2: BANK.x - 8, y2: rowY(w, x.sub), stroke: x.replayed ? COLOR.ok : color, "stroke-width": 3, marker: "arrow", opacity: op, ...drawIn(n) });
      if (n > 0) return;
      // Метка ключа — у пода, где стрелки разведены; у нижнего пода C — под линией (его стрелка идёт вверх).
      const ky = id === "C" ? mid + 6 : mid - 40;
      if (x.key) {
        const label = x.key.split("·")[0];
        const tw = pen.measure(label, { ...MONO, "font-weight": 700 }).width + 40;
        pen.group(`${k}:key`, right + 6, ky, () => {
          pen.rect(`${k}:key:bg`, { width: tw, height: 32, rx: 8, fill: COLOR.bg, opacity: 0.9, stroke: COLOR.warn, "stroke-width": 1.5 });
          iconText(pen, `${k}:key:t`, "key", 8, 23, label, COLOR.warn, { ...MONO, "font-weight": 700 });
        }, { opacity: op, class: "fx-pop d1" });
      } else if (w.slot) {
        pen.group(`${k}:slot`, right + 40, ky, () => {
          pen.rect(`${k}:slot:bg`, { width: 38, height: 32, rx: 8, fill: COLOR.bg, stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "4 4" });
          icon(pen, `${k}:slot:i`, "question", 8, 5, 22, COLOR.warn);
        }, { class: "fx-pop" });
      }
    });
    if (a.atBank) {
      pen.line(`wait:${id}`, { x1: right, y1: mid, x2: BANK.x - 8, y2: rowY(w, 42), stroke: color, "stroke-width": 3, "stroke-dasharray": "7 6", opacity: op });
    }
  }
}

function podMood(a: Actor): Mood {
  if (a.dead && a.conn === "silent") return "frozen";
  if (a.atBank) return "wait";
  if (a.acts.some((x) => x.kind === "bank")) return "work";
  if (a.acts.some((x) => x.kind === "knock")) return "lost";
  if (a.alarm) return "talk";
  return "idle";
}

/** Корона лидера 48×26 (под уверен, что он лидер): три зубца с жемчужинами и обод. */
function crown(pen: Pen, key: string, color: string): void {
  pen.path(`${key}:b`, { d: "M2 26 L0 6 L12 14 L24 2 L36 14 L48 6 L46 26 Z", fill: color, stroke: COLOR.bg, "stroke-width": 2 });
  [[0, 6], [24, 2], [48, 6]].forEach(([cx, cy], i) => pen.rect(`${key}:p${i}`, { x: cx - 4, y: cy - 4, width: 8, height: 8, rx: 4, fill: color, stroke: COLOR.bg, "stroke-width": 1.5 }));
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = colorOf(a);
  const mood = podMood(a);
  const look: Look = a.atBank || a.acts.some((x) => x.kind === "bank") ? { x: 1, y: -0.3 } : { x: 0, y: 0 };
  const ghost = a.dead && a.conn === "closed";
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxOnce] = once(`pod:${a.id}:fx`, w.frame, happened(w, "crash", a.id) ? "fx-jolt" : happened(w, "restart", a.id) ? "fx-pop" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: isJob(a) ? "J" : a.id, mood, look, ghost, dashed: mood === "wait" || isJob(a) }), fxOnce);
    pen.text(`pod:${a.id}:label`, { x: BOB.w / 2, y: BOB.h + 22, ...SANS, "font-weight": 700, fill: ghost ? COLOR.faint : color, "text-anchor": "middle" }, a.label);
    if (isJob(a)) icon(pen, `pod:${a.id}:job`, "clock", BOB.w - 8, BOB.h - 20, 20, COLOR.ink);
    if (a.leader && !a.dead) {
      const [ck, cfx] = once(`pod:${a.id}:crown`, w.frame, happened(w, "lock", a.id) || happened(w, "takeover", a.id) ? "fx-pop" : null);
      // Корона — над головой, поверх антенны: в просвете между подписью соседа сверху и подом.
      // Сменённый лидер (кадр номера срока): корона бледнеет и зачёркнута — база доверяет другому.
      const stale = w.shown.epoch && w.leader?.holder !== a.id;
      pen.group(ck, BOB.w / 2 - 24, -32, () => {
        if (happened(w, "double") && leaders(w).length > 1) pen.rect(`${ck}:halo`, { x: -8, y: -8, width: 64, height: 42, rx: 16, fill: "none", stroke: COLOR.error, "stroke-width": 3, class: "fx-pop" });
        crown(pen, `${ck}:c`, COLOR.warn);
        if (stale) pen.line(`${ck}:x`, { x1: -4, y1: 28, x2: 52, y2: 0, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", pathLength: 1, class: "fx-draw" });
      }, { ...cfx, ...(stale ? { opacity: 0.5 } : {}) });
    }
    if (a.alarm) {
      // Будильники звенят каскадом: A, B, C друг за другом.
      pen.group(`pod:${a.id}:alarm`, -46, 2, () => {
        icon(pen, `pod:${a.id}:alarm:i`, "clock", 0, 0, 30, COLOR.warn);
      }, happened(w, "cron", a.id) ? { class: `fx-shake d${ACTORS.indexOf(a.id) + 1}` } : {});
    }
    if (a.asleep) icon(pen, `pod:${a.id}:zz`, "sleep", BOB.w - 4, -18, 22, COLOR.muted);
    if (a.dead && a.conn === "closed") {
      const [dk, dfx] = once(`pod:${a.id}:dead`, w.frame, happened(w, "crash", a.id) ? "fx-pop" : null);
      if (happened(w, "crash", a.id)) pen.rect(`${dk}:halo`, { x: -10, y: -10, width: BOB.w + 20, height: BOB.h + 16, rx: 30, fill: "none", stroke: COLOR.error, "stroke-width": 3, class: "fx-fade" });
      // Плашка — справа от упавшего пода: под ним она попадала под корону соседа снизу.
      pen.group(dk, BOB.w + 12, 14, () => pill(pen, `${dk}:p`, "OOM Killer", { x: 0, y: 0, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error }), dfx);
    }
    if (w.doubt === a.id) pen.text(`pod:${a.id}:doubt`, { x: BOB.w + 14, y: 8, "font-family": FONT.sans, "font-size": SIZE.plate, "font-weight": 800, fill: COLOR.warn, class: "fx-pop" }, "?");
    if (a.acts.some((x) => x.kind === "knock")) pill(pen, `pod:${a.id}:busy`, "занято", { x: BOB.w + 12, y: 6, fill: COLOR.surface2, color: COLOR.muted, attrs: { class: "fx-pop" } });
    // Мысль — над подом справа от короны: справа от тела она лежала бы на стрелке в банк.
    if (a.thought) bubble(pen, `pod:${a.id}:think`, a.thought, { x: BOB.w + 4, y: -30, tail: "down", thought: true });
    if (a.crossed) {
      const b = bubble(pen, `pod:${a.id}:crossed`, a.crossed, { x: BOB.w + 4, y: -30, tail: "down", thought: true, attrs: { opacity: 0.4 } });
      // Геометрия пузыря с хвостом вниз: левый край — на 28 левее хвоста, низ — на 12 выше.
      const bx = BOB.w + 4 - 28;
      const ty = -30 - 12 - b.h / 2;
      pen.line(`pod:${a.id}:strike`, { x1: bx + 8, y1: ty, x2: bx + b.w - 8, y2: ty, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", pathLength: 1, class: "fx-draw" });
    }
  }, fade(w, a.id));
}

/** Банк: журнал списаний по подпискам; вторая и третья за тот же месяц — красным «×N». */
function drawBank(pen: Pen, w: World): void {
  const { x, y, w: bw, h } = BANK;
  const alarm = happened(w, "double");
  pen.group("bank", 0, 0, () => {
    panel(pen, "bank:box", { x, y, w: bw, h, stroke: alarm ? COLOR.error : COLOR.mail, attrs: { "stroke-dasharray": "8 6" } });
    mailFace(pen, "bank:face", { x: x + 26, y: y + 12, mood: alarm ? "alarm" : happened(w, "replayed") ? "relieved" : w.ledger.length ? "calm" : "asleep" });
    pen.text("bank:title", { x: x + 76, y: y + 26, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.mail }, "Банк");
    pen.text("bank:ext", { x: x + bw - 4, y: y - 12, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, "внешний сервис");
    SUBS.filter((s) => times(w, s.id) > 0).forEach((s, i) => {
      const n = times(w, s.id);
      const dup = n > 1;
      const [k, fx] = once(`bank:row${s.id}`, w.frame, happened(w, "charge") || happened(w, "double") ? "fx-slide" : null);
      const key = w.ledger.find((c) => c.sub === s.id)?.key;
      const known = Object.values(w.actors).some((a) => a.acts.some((x) => x.kind === "bank" && x.replayed && x.sub === s.id));
      pen.group(k, x + 16, y + 52 + i * 32, () => {
        pen.rect(`${k}:bg`, { width: bw - 32, height: 28, rx: 6, fill: dup ? COLOR.alarmBg : COLOR.surface2, stroke: dup ? COLOR.error : known ? COLOR.ok : COLOR.line, "stroke-width": 1.5 });
        pen.text(`${k}:t`, { x: 12, y: 20, ...MONO, fill: dup ? COLOR.error : COLOR.ink, "font-weight": 700 }, `−${rub(AMOUNT)} · подписка ${s.id}`);
        if (dup) {
          pen.rect(`${k}:nb`, { x: 262, y: 3, width: 42, height: 22, rx: 6, fill: COLOR.error });
          pen.text(`${k}:n`, { x: 283, y: 20, ...MONO, fill: COLOR.bg, "font-weight": 800, "text-anchor": "middle" }, `×${n}`);
        }
        if (known) icon(pen, `${k}:ok`, "check", 236, 4, 20, COLOR.ok, { class: "fx-pop" });
        if (key && !key.includes("·")) iconText(pen, `${k}:key`, "key", bw - 32 - 180, 20, key, COLOR.warn, MONO);
      }, fx);
    });
  }, fade(w, "bank"));
  if (w.bank) bubble(pen, "bank:say", w.bank, { x: x + 130, y: y + 20, tail: "left", attrs: { class: "fx-pop" } });
}

/** Наш Postgres: подписки, charges, строка leader и часы БД (с кейса 2). */
function drawDb(pen: Pen, w: World): void {
  panel(pen, "pg:box", { x: PG.x, y: PG.y, w: PG.w, h: PG.h, fill: COLOR.bg2, stroke: COLOR.postgres, attrs: fade(w, "subs", "charges", "leader", "db", "conn") });
  const busy = ["insert", "takeover", "renew", "lock"].some((k) => happened(w, k as SimEvent["kind"]));
  const look = w.db ? { x: 1, y: 0.2 } : busy ? { x: 0.3, y: 1 } : { x: 0, y: 0 };
  pen.group("pg:head", 0, 0, () => {
    elephant(pen, "db:face", { x: PG.x + 22, y: PG.y + 6, talking: !!w.db, scale: 0.8, look });
    pen.text("db:name", { x: PG.x + 70, y: PG.y + 32, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  }, fade(w, "subs", "charges", "leader", "db", "conn"));
  // Часы БД — над строкой leader, с которой их сверяют: в шапке их закрывала реплика слона.
  if (w.shown.clock) {
    pen.group("clock", 0, 0, () => {
      icon(pen, "clock:i", "clock", PG.x + PG.w - 138, LEADER_Y - 28, 20, COLOR.muted);
      pen.text("clock:t", { x: PG.x + PG.w - 14, y: LEADER_Y - 10, ...MONO, "font-weight": 700, fill: COLOR.ink, "text-anchor": "end" }, hhmmss(w.clock));
      const j = jump(w);
      if (j) pill(pen, "clock:jump", j, { x: PG.x + PG.w - 230, y: LEADER_Y - 32, fill: COLOR.surface2, color: COLOR.warn, stroke: COLOR.warn, mono: true, attrs: { class: "fx-pop" } });
    }, { ...fade(w, "leader"), ...(happened(w, "tick") ? { class: "fx-pulse" } : {}) });
  }
  if (w.shown.subs) {
    pen.group("subs", 0, 0, () => {
      pen.text("subs:hdr", { x: TABLE.x + 10, y: SUBS_Y - 10, ...MONO, fill: COLOR.muted }, "subscriptions");
      SUBS.forEach((s, i) => {
        pen.group(`subs:${s.id}`, TABLE.x + i * 158, SUBS_Y, () => {
          pen.rect(`subs:${s.id}:bg`, { width: 150, height: 30, rx: 6, fill: COLOR.surface, stroke: s.id === IRA ? COLOR.browser : COLOR.line, "stroke-width": 1.5 });
          pen.text(`subs:${s.id}:t`, { x: 10, y: 21, ...MONO, fill: COLOR.ink }, `${s.id} ${s.user}`);
        });
      });
    }, fade(w, "subs"));
  }
  if (w.shown.charges) {
    pen.group("charges", 0, 0, () => {
      pen.text("charges:hdr", { x: TABLE.x + 10, y: CHARGES_Y - 10, ...MONO, fill: COLOR.muted }, "charges");
      w.charges.slice(0, 3).forEach((c, i) => {
        const [k, fx] = once(`charges:${i}`, w.frame, happened(w, "insert", c.by) && i === w.charges.length - 1 ? "fx-pop" : null);
        pen.group(k, TABLE.x + i * 158, CHARGES_Y, () => {
          pen.rect(`${k}:bg`, { width: 150, height: 30, rx: 6, fill: COLOR.surface, stroke: COLOR.line, "stroke-width": 1.5 });
          pen.rect(`${k}:dot`, { x: 10, y: 9, width: 12, height: 12, rx: 6, fill: ACTOR[c.by].color });
          pen.text(`${k}:t`, { x: 30, y: 21, ...MONO, fill: COLOR.ink }, `${c.sub}·${c.period.slice(2)}`);
        }, fx);
      });
    }, fade(w, "charges"));
  }
  if (w.leader) {
    const l = w.leader;
    const expired = l.leaseUntil < w.clock;
    pen.group("leader", 0, 0, () => {
      pen.text("leader:hdr", { x: TABLE.x + 10, y: LEADER_Y - 10, ...MONO, fill: COLOR.muted }, "leader");
      const [k, fx] = once("leader:row", w.frame, happened(w, "takeover") || happened(w, "renew") ? "fx-pop" : null);
      pen.group(k, TABLE.x, LEADER_Y, () => {
        const holder = l.holder;
        pen.rect(`${k}:bg`, { width: TABLE.w, height: 32, rx: 6, fill: holder ? ACTOR[holder].tint : COLOR.surface, stroke: holder ? ACTOR[holder].color : COLOR.line, "stroke-width": 2 });
        pen.text(`${k}:h`, { x: 12, y: 22, ...MONO, fill: COLOR.ink }, `holder ${holder ?? "—"}`);
        if (w.shown.epoch) pen.text(`${k}:e`, { x: 140, y: 22, ...MONO, fill: COLOR.warn, "font-weight": 700 }, `epoch ${l.epoch}`);
        if (holder) pen.text(`${k}:t`, { x: TABLE.w - 12, y: 22, ...MONO, fill: expired ? COLOR.error : COLOR.ink, "text-anchor": "end" }, `до ${hhmmss(l.leaseUntil)}`);
        // Остаток аренды полосой: истекает на глазах, а не сверкой чисел.
        const left = holder ? Math.max(0, Math.min(1, (l.leaseUntil - w.clock) / LEASE)) : 0;
        if (left > 0) pen.rect(`${k}:bar`, { x: 6, y: 26, width: (TABLE.w - 12) * left, height: 4, rx: 2, fill: ACTOR[holder!].color });
      }, fx);
    }, fade(w, "leader"));
    const by = w.events.find((e) => e.kind === "takeover")?.by;
    if (by && w.shown.clock) pen.line(`leader:by:${w.frame}`, { x1: POD.x + BOB.w + 10, y1: podMid(by) + 4, x2: TABLE.x - 6, y2: LEADER_Y + 16, stroke: ACTOR[by].color, "stroke-width": 2, marker: "arrow", pathLength: 1, class: "fx-draw d1" });
  }
}

/** Врезка: объект Lease в Kubernetes — та же аренда: кто держит и сколько секунд. */
function drawLease(pen: Pen): void {
  pen.rect("scrim", { x: 0, y: 0, width: STAGE.w, height: SAFE_BOTTOM, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
  panel(pen, "lease:box", { x: 300, y: 190, w: 680, h: 250, fill: "#11172e", stroke: COLOR.mail });
  pen.text("lease:title", { x: 336, y: 240, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.mail }, "Kubernetes · kind: Lease");
  const rows: [string, string, string][] = [
    // Та же минута, что в сцене за врезкой: роль только что перешла к B.
    ["holderIdentity", "pod-b", ACTOR.B.color], ["leaseDurationSeconds", "15", COLOR.warn],
    ["renewTime", "03:00:21", COLOR.ink], ["leaseTransitions", "9", COLOR.ink],
  ];
  rows.forEach(([name, value, color], i) => pen.group(`lease:l${i}`, 336, 290 + i * 36, () => {
    pen.text(`lease:l${i}:n`, { x: 0, y: 0, ...MONO, "font-size": SIZE.say, fill: COLOR.muted }, `${name}:`);
    pen.text(`lease:l${i}:v`, { x: 300, y: 0, ...MONO, "font-size": SIZE.say, fill: color, "font-weight": 700 }, value);
  }, { class: `fx-rise d${Math.min(i + 1, 3)}` }));
}

function drawHeader(pen: Pen, w: World): void {
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER.x - 20, y: CHAPTER.y, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

export function render(pen: Pen, w: World): void {
  // Вспомним оплату: кадр 08 его же отрисовкой; поверх — только штамп перемотки.
  if (w.flashback !== null) {
    render08(pen, recallWorld(w.flashback));
    pen.layer("top", () => {
      if (w.stamp) stamp(pen, w.stamp, { left: IRA_BOX.x, right: HEADER_RIGHT });
    });
    return;
  }
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  if (w.term) pill(pen, "term", w.term, { x: TERM.x, y: TERM.y, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  drawDb(pen, w);
  drawBank(pen, w);
  if (w.board && lit(w, "board")) {
    const skip = Math.max(0, w.board.attempts.length - BOARD_ROWS);
    const b = { ...w.board, attempts: w.board.attempts.slice(skip), focus: w.board.focus === undefined ? undefined : w.board.focus - skip };
    board(pen, b, { ...BOARD, lampX: [262, 412], attrs: fade(w, "board") });
  }
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: IRA_BOX.x, bottom: BOTTOM, attrs: fade(w, "sql") });
  drawConns(pen, w);
  drawArrows(pen, w);
  drawIra(pen, w);
  for (const id of visible(w)) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    if (w.code) pen.rect("scrim", { x: 0, y: 0, width: STAGE.w, height: SAFE_BOTTOM, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
    codeWindow(pen, w.code, { rows: w.code?.lines.length ?? 1 });
    if (w.aside === "lease") drawLease(pen);
    drawHeader(pen, w);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: IRA_BOX.x, right: HEADER_RIGHT });
    if (w.db) bubble(pen, "db:say", w.db, { x: PG.x + 172, y: PG.y + 25, tail: "left", attrs: { class: "fx-pop" } });
  });
}
