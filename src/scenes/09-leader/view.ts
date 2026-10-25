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
  ACTORS, AMOUNT, BALANCE, IRA, SUBS, times, type Actor, type ActorId, type Focus, type SimEvent, type World,
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

/** Ира: время ночи, спит или нет, уведомления о списаниях, баланс карты. */
function drawIra(pen: Pen, w: World): void {
  const { x, y, w: bw, h } = IRA_BOX;
  const ira = w.ira;
  pen.group("ira", 0, 0, () => {
    panel(pen, "ira:box", { x, y, w: bw, h, rx: 24, fill: COLOR.bg2, stroke: COLOR.browser });
    person(pen, "ira:p", { x: x + 16, y: y + 16, shirt: COLOR.browser, mood: ira.asleep ? "idle" : ira.notes > 1 ? "sad" : "happy" });
    pen.text("ira:name", { x: x + 72, y: y + 46, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Ира");
    pen.text("ira:time", { x: x + bw - 16, y: y + 46, ...MONO, fill: COLOR.muted, "text-anchor": "end" }, hhmm(w.clock));
    if (ira.asleep) icon(pen, "ira:zz", "sleep", x + 130, y + 60, 26, COLOR.muted);
    pen.text("ira:plan", { x: x + 16, y: y + 100, ...SANS, fill: COLOR.muted }, `Плюс · ${rub(AMOUNT)}/мес`);
    for (let i = 0; i < Math.min(ira.notes, 3); i++) {
      const [k, fx] = once(`ira:note${i}`, w.frame, happened(w, "note") ? `fx-slide d${Math.min(i + 1, 3)}` : null);
      pen.group(k, x + 16, y + 120 + i * 40, () => {
        pen.rect(`${k}:bg`, { width: bw - 32, height: 32, rx: 8, fill: i > 0 ? COLOR.alarmBg : COLOR.surface2, stroke: i > 0 ? COLOR.error : COLOR.line, "stroke-width": 1.5 });
        iconText(pen, `${k}:t`, "mail", 10, 22, `Списано ${rub(AMOUNT)}`, i > 0 ? COLOR.error : COLOR.ink, SANS);
      }, fx);
    }
    const low = ira.balance < BALANCE - AMOUNT;
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
    if (a.conn === "closed") continue;
    const y1 = podMid(id) + 12;
    const y2 = PG.y + 40 + ACTORS.indexOf(id) * 18;
    const silent = a.conn === "silent";
    const [k, fx] = once(`conn:${id}`, w.frame, happened(w, "silent", id) || happened(w, "cut", id) ? "fx-fade" : null);
    pen.line(k, {
      x1, y1, x2, y2, stroke: silent ? COLOR.faint : ACTOR[id].color, "stroke-width": 2.5, opacity: 0.8,
      ...(silent ? { "stroke-dasharray": "3 7" } : {}), ...fx,
    });
    if (w.lockBy === id) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const [lk, lfx] = once(`lock:${id}`, w.frame, happened(w, "lock", id) ? "fx-pop" : null);
      lock(pen, lk, { x: mx - 11, y: my - 26, color: ACTOR[id].color, shackle: happened(w, "lock", id) ? { class: "fx-lock" } : {}, attrs: lfx });
      pen.text(`${lk}:n`, { x: mx + 18, y: my - 8, ...MONO, fill: COLOR.muted }, "9001");
    }
  }
}

/** Стрелки пода в банк: ключ на стрелке, пустое место ключа, повтор, узнанный банком, — зелёным. */
function drawArrows(pen: Pen, w: World): void {
  const right = POD.x + BOB.w + 8;
  for (const id of visible(w)) {
    const a = w.actors[id];
    const op = fade(w, id).opacity * (a.dead ? 0.35 : 1);
    const mid = podMid(id) - 8;
    const banks = a.acts.filter((x) => x.kind === "bank");
    banks.forEach((x, n) => {
      if (x.kind !== "bank") return;
      const k = `arr:${id}:${n}`;
      const y2 = BANK.y + 60 + ACTORS.indexOf(id) * 26;
      pen.line(k, { x1: right, y1: mid, x2: BANK.x - 8, y2, stroke: x.replayed ? COLOR.ok : ACTOR[id].color, "stroke-width": 3, marker: "arrow", opacity: op, ...drawIn(n) });
      if (n > 0) return;
      const kx = (right + BANK.x) / 2 - 13;
      const ky = (mid + y2) / 2 - 34;
      if (x.key) iconText(pen, `${k}:key`, "key", kx, ky + 20, x.key.split("·")[0], COLOR.warn, { ...MONO, "font-weight": 700 });
      else if (w.slot) {
        pen.rect(`${k}:slot`, { x: kx - 6, y: ky - 4, width: 38, height: 32, rx: 8, fill: "none", stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "4 4", class: "fx-pop" });
        icon(pen, `${k}:slot:i`, "question", kx + 1, ky + 1, 22, COLOR.warn);
      }
    });
    if (a.atBank) {
      pen.line(`wait:${id}`, { x1: right, y1: mid, x2: BANK.x - 8, y2: BANK.y + 60, stroke: ACTOR[id].color, "stroke-width": 3, "stroke-dasharray": "7 6", opacity: op });
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

/** Корона лидера: под уверен, что он лидер. */
function crown(pen: Pen, key: string, x: number, y: number, color: string, attrs = {}): void {
  pen.path(key, { d: `M${x} ${y + 16} L${x + 4} ${y} L${x + 12} ${y + 9} L${x + 20} ${y - 2} L${x + 28} ${y + 9} L${x + 36} ${y} L${x + 40} ${y + 16} Z`, fill: color, stroke: COLOR.bg, "stroke-width": 1.5, ...attrs });
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(a);
  const look: Look = a.atBank || a.acts.some((x) => x.kind === "bank") ? { x: 1, y: -0.3 } : { x: 0, y: 0 };
  const ghost = a.dead && a.conn === "closed";
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxOnce] = once(`pod:${a.id}:fx`, w.frame, happened(w, "crash", a.id) ? "fx-jolt" : happened(w, "restart", a.id) ? "fx-pop" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood, look, ghost, dashed: mood === "wait" }), fxOnce);
    pen.text(`pod:${a.id}:label`, { x: BOB.w / 2, y: BOB.h + 22, ...SANS, "font-weight": 700, fill: ghost ? COLOR.faint : color, "text-anchor": "middle" }, a.label);
    if (a.leader && !a.dead) {
      const [ck, cfx] = once(`pod:${a.id}:crown`, w.frame, happened(w, "lock", a.id) || happened(w, "takeover", a.id) ? "fx-pop" : null);
      // Корона — слева под будильником: над подом она наезжала бы на подпись соседа сверху.
      pen.group(ck, -46, 40, () => crown(pen, `${ck}:p`, 0, 0, COLOR.warn), cfx);
    }
    if (a.alarm) {
      pen.group(`pod:${a.id}:alarm`, -44, 4, () => {
        icon(pen, `pod:${a.id}:alarm:i`, "clock", 0, 0, 26, COLOR.warn);
      }, happened(w, "cron", a.id) ? { class: "fx-shake" } : {});
    }
    if (a.asleep) icon(pen, `pod:${a.id}:zz`, "sleep", BOB.w - 4, -18, 22, COLOR.muted);
    if (a.dead && a.conn === "closed") {
      const [dk, dfx] = once(`pod:${a.id}:dead`, w.frame, happened(w, "crash", a.id) ? "fx-pop" : null);
      pen.group(dk, BOB.w / 2 - 56, BOB.h + 30, () => pill(pen, `${dk}:p`, "OOM Killer", { x: 0, y: 0, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error }), dfx);
    }
    if (w.doubt === a.id) pen.text(`pod:${a.id}:doubt`, { x: BOB.w + 14, y: 8, "font-family": FONT.sans, "font-size": SIZE.plate, "font-weight": 800, fill: COLOR.warn, class: "fx-pop" }, "?");
    if (a.acts.some((x) => x.kind === "knock")) pill(pen, `pod:${a.id}:busy`, "занято", { x: BOB.w + 12, y: 6, fill: COLOR.surface2, color: COLOR.muted, attrs: { class: "fx-pop" } });
    if (a.thought) bubble(pen, `pod:${a.id}:think`, a.thought, { x: BOB.w + 10, y: 40, tail: "left", thought: true });
    if (a.crossed) {
      const ty = 40;
      const b = bubble(pen, `pod:${a.id}:crossed`, a.crossed, { x: BOB.w + 10, y: ty, tail: "left", thought: true, attrs: { opacity: 0.4 } });
      pen.line(`pod:${a.id}:strike`, { x1: BOB.w + 24, y1: ty, x2: BOB.w + 24 + b.w, y2: ty, stroke: COLOR.error, "stroke-width": 3.5, "stroke-linecap": "round", pathLength: 1, class: "fx-draw" });
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
      pen.group(k, x + 16, y + 48 + i * 32, () => {
        pen.rect(`${k}:bg`, { width: bw - 32, height: 28, rx: 6, fill: dup ? COLOR.alarmBg : COLOR.surface2, stroke: dup ? COLOR.error : COLOR.line, "stroke-width": 1.5 });
        pen.text(`${k}:t`, { x: 12, y: 20, ...MONO, fill: dup ? COLOR.error : COLOR.ink, "font-weight": 700 }, `−${rub(AMOUNT)} · подписка ${s.id}`);
        if (dup) pen.text(`${k}:n`, { x: 270, y: 20, ...MONO, fill: COLOR.error, "font-weight": 800 }, `×${n}`);
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
      }, fx);
    }, fade(w, "leader"));
  }
}

/** Врезка: объект Lease в Kubernetes — та же аренда: кто держит и сколько секунд. */
function drawLease(pen: Pen): void {
  pen.rect("scrim", { x: 0, y: 0, width: STAGE.w, height: SAFE_BOTTOM, fill: COLOR.bg, opacity: 0.92, class: "fx-fade" });
  panel(pen, "lease:box", { x: 300, y: 190, w: 680, h: 250, fill: "#11172e", stroke: COLOR.muted });
  pen.text("lease:title", { x: 336, y: 240, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, "Kubernetes · kind: Lease");
  ["holderIdentity: pod-a", "leaseDurationSeconds: 15", "renewTime: 03:00:05", "leaseTransitions: 7"].forEach((t, i) =>
    pen.text(`lease:l${i}`, { x: 336, y: 290 + i * 36, ...MONO, "font-size": SIZE.say, fill: COLOR.ink, class: `fx-rise d${Math.min(i + 1, 3)}` }, t));
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
