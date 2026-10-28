import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, type Mood } from "../../kit/characters";
import { codeWindow } from "../../kit/code";
import { icon } from "../../kit/icons";
import { buyButton, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, stamp } from "../../kit/widgets";
import { clock } from "./script";
import {
  PODS, REPLICAS, ROOM, applied, lsnText, replayLsn, type Focus, type Pod, type PodId, type ReplicaId, type SimEvent, type Source, type World,
} from "./sim";

// MVP эпизода 11: серые фигуры. Слева — гость и его «Мои брони», в середине — поды, над ними primary; справа — лента
// журнала (WAL) с бегунками реплик и сами реплики; снизу — листающие гости и табло.

const GUEST = { x: 30, y: 104, w: 266, h: 380 };
const SERVICE = { x: 316, y: 104, w: 230, h: 380 };
const POD_X = 400;
const POD_Y: Record<PodId, number> = { A: 124, B: 236, C: 348 };
const PRIMARY = { x: 372, y: 20, w: 148, h: 46 };
const TAPE = { x: 566, y: 104, w: 674, card: 38, gap: 6, cardY: 136, cardH: 40, slots: 15 };
const REP = { y: 266, w: 327, h: 190 };
const REP_X: Record<ReplicaId, number> = { 1: 566, 2: 913 };
const CROWD = { x: 30, y: 504, w: 640, h: 84 };
const BOARD = { x: 700, y: 470, w: 540, rowH: 26 };
const CHAPTER_X = 1100;
const TERM = { x: 980, y: 72 };

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"]) => w.events.some((e) => e.kind === kind);
const seconds = (ms: number) => `${String(ms / 1000).replace(".", ",")} с`;
const where = (s: Source) => (s === "primary" ? "primary" : `реплика ${s}`);

function drawHeader(pen: Pen, w: World): void {
  elephant(pen, "db:face", { x: PRIMARY.x - 56, y: 8, talking: !!w.db, scale: 1.08, look: w.db ? { x: 1, y: 0 } : undefined });
  pen.group("primary", 0, 0, () => {
    panel(pen, "primary:box", { ...PRIMARY, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
    pen.text("primary:t", { x: PRIMARY.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Primary");
  }, fade(w, "primary"));
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER_X, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!(w.focus?.includes("clock") || happened(w, "clock"))) return;
  const [k, fx] = once("clock", w.frame, happened(w, "clock") ? "fx-pulse" : null);
  pen.group(k, 0, 0, () => {
    icon(pen, "clock:i", "clock", 30, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 64, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
  }, { ...fade(w, "clock"), ...fx });
}

function drawGuest(pen: Pen, w: World): void {
  const g = w.guest;
  pen.group("guest", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    iconText(pen, "guest:title", "browser", GUEST.x + 14, GUEST.y + 34, "Гость", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    person(pen, "guest:p", { x: GUEST.x + 18, y: GUEST.y + 52, shirt: COLOR.browser, mood: g.thought ? "sad" : g.page ? "happy" : "idle" });
    buyButton(pen, "guest:btn", { x: GUEST.x + 18, y: GUEST.y + 112, pressed: g.pressed, label: "Забронировать", w: 190 });
    if (g.saving) icon(pen, "guest:wait", "hourglass", GUEST.x + 218, GUEST.y + 116, 26, COLOR.warn, { class: "fx-pop" });
    if (g.page !== null) {
      pen.text("guest:list", { x: GUEST.x + 18, y: GUEST.y + 186, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Мои брони");
      if (!g.page) pen.text("guest:none", { x: GUEST.x + 18, y: GUEST.y + 220, ...SANS, "font-style": "italic", fill: COLOR.faint }, "пусто");
      for (let i = 0; i < g.page; i++) {
        const y = GUEST.y + 200 + i * 34;
        pen.rect(`guest:b${i}`, { x: GUEST.x + 18, y, width: 230, height: 28, rx: 6, fill: COLOR.draftBg, stroke: COLOR.warn, "stroke-width": 2, class: "fx-slide" });
        pen.text(`guest:b${i}:t`, { x: GUEST.x + 30, y: y + 21, ...SANS, fill: COLOR.ink }, `Номер ${ROOM} · сб–вс`);
      }
      if (g.from) pen.text("guest:from", { x: GUEST.x + 18, y: GUEST.y + 300, ...SANS, fill: COLOR.muted }, `прочитано: ${where(g.from)}`);
    }
    if (g.sealUntil !== null) {
      iconText(pen, "guest:seal", "clock", GUEST.x + 18, GUEST.y + 350, `метка: primary ${seconds(g.sealUntil - w.clock)}`, COLOR.warn, { ...SANS, "font-weight": 700 });
    } else if (g.ticket !== null) {
      iconText(pen, "guest:ticket", "ticket", GUEST.x + 18, GUEST.y + 350, `LSN ${lsnText(g.ticket)}`, COLOR.warn, { ...MONO, "font-weight": 700 });
    }
  }, fade(w, "guest"));
}

function podMood(p: Pod): Mood {
  if (p.acts.some((a) => a.kind === "write" && a.hang)) return "wait";
  return p.acts.length ? "work" : "idle";
}

function drawService(pen: Pen, w: World): void {
  pen.group("svc", 0, 0, () => {
    panel(pen, "svc:box", { ...SERVICE, fill: "none", stroke: COLOR.line, shadow: false });
    pen.text("svc:title", { x: SERVICE.x + 16, y: SERVICE.y + SERVICE.h - 14, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Сервис бронирования");
  }, fade(w, ...PODS));
  for (const id of PODS) {
    const p = w.pods[id];
    const { color, tint } = ACTOR[id];
    pen.group(`pod:${id}`, POD_X, POD_Y[id], () => {
      bob(pen, `pod:${id}:bob`, { x: 0, y: 0, color, tint, letter: id, mood: podMood(p), look: { x: p.acts.some((a) => a.kind === "read" || a.kind === "check") ? 1 : 0, y: 0 } });
    }, fade(w, id));
  }
}

/** Где на ленте видна запись i: последние `slots` записей; левее окна — null. */
function cardX(w: World, i: number): number | null {
  const first = Math.max(0, w.wal.length - TAPE.slots);
  return i < first ? null : TAPE.x + (i - first) * (TAPE.card + TAPE.gap);
}

/** Лента журнала: карточки по порядку, золотые — брони гостя; под лентой бегунки реплик — до куда проиграно. */
function drawTape(pen: Pen, w: World): void {
  if (w.unseen.includes("tape")) return;
  pen.group("tape", 0, 0, () => {
    pen.text("tape:title", { x: TAPE.x, y: TAPE.y + 20, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Журнал WAL");
    if (w.lsn && w.wal.length) {
      pen.text("tape:head", { x: TAPE.x + TAPE.w, y: TAPE.y + 20, ...MONO, "text-anchor": "end", fill: COLOR.ink }, `конец: ${lsnText(w.wal.at(-1)!.lsn)}`);
    }
    w.wal.forEach((e, i) => {
      const x = cardX(w, i);
      if (x === null) return;
      pen.rect(`tape:c${e.lsn}`, {
        x, y: TAPE.cardY, width: TAPE.card, height: TAPE.cardH, rx: 5, "stroke-width": 2,
        fill: e.guest ? COLOR.warn : COLOR.surface2, stroke: e.guest ? COLOR.warn : COLOR.line, class: "fx-pop",
      });
    });
    for (const id of REPLICAS) {
      const r = w.replicas[id];
      const n = applied(w, id);
      const x = n === 0 ? TAPE.x - 3 : (cardX(w, n - 1) ?? TAPE.x - TAPE.card) + TAPE.card + TAPE.gap / 2;
      const y = TAPE.cardY + TAPE.cardH + 4 + (id - 1) * 30;
      const color = r.down ? COLOR.error : COLOR.postgres;
      pen.group(`tape:run${id}`, 0, 0, () => {
        pen.line(`tape:run${id}:l`, { x1: x, y1: TAPE.cardY - 4, x2: x, y2: y + 18, stroke: color, "stroke-width": 3 });
        const label = w.lsn ? `${id} · ${lsnText(replayLsn(w, id))}` : r.lag >= 1000 ? `${id} · отстаёт ${seconds(r.lag)}` : `${id}`;
        const end = x > TAPE.x + TAPE.w - 260;
        pen.text(`tape:run${id}:t`, { x: end ? x - 8 : x + 8, y: y + 18, ...(w.lsn ? MONO : SANS), "text-anchor": end ? "end" : "start", fill: color, "font-weight": 700 }, label);
      }, fade(w, "tape", id));
    }
  }, fade(w, "tape"));
}

function drawReplicas(pen: Pen, w: World): void {
  if (w.unseen.includes("replicas")) return;
  for (const id of REPLICAS) {
    const r = w.replicas[id];
    const x = REP_X[id];
    const [k, fx] = once(`rep${id}`, w.frame, r.down && happened(w, "down") ? "fx-shake" : null);
    pen.group(k, 0, 0, () => {
      panel(pen, `rep${id}:box`, { x, y: REP.y, w: REP.w, h: REP.h, fill: r.down ? COLOR.alarmBg : COLOR.surface, stroke: r.down ? COLOR.error : COLOR.postgres });
      elephant(pen, `rep${id}:face`, { x: x + 16, y: REP.y + 12, talking: !!r.say, scale: 0.8 });
      pen.text(`rep${id}:t`, { x: x + 70, y: REP.y + 40, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, `Реплика ${id}`);
      const tag = r.down ? "лежит" : r.sync ? "синхронная" : null;
      if (tag) pen.text(`rep${id}:tag`, { x: x + REP.w - 16, y: REP.y + 40, ...SANS, "text-anchor": "end", "font-weight": 700, fill: r.down ? COLOR.error : COLOR.warn }, tag);
      if (w.lsn) {
        const pos = replayLsn(w, id);
        const ok = w.guest.ticket === null ? null : pos >= w.guest.ticket;
        pen.text(`rep${id}:lsn`, { x: x + 16, y: REP.y + 148, ...MONO, fill: ok === null ? COLOR.ink : ok ? COLOR.ok : COLOR.error }, `проиграла до ${lsnText(pos)}`);
      }
      const mine = w.wal.slice(0, applied(w, id)).filter((e) => e.guest).length;
      pen.text(`rep${id}:mine`, { x: x + 16, y: REP.y + 176, ...SANS, fill: COLOR.muted }, `броней гостя: ${mine}`);
      if (r.say) bubble(pen, `rep${id}:say`, r.say, { x: x + 46, y: REP.y + 66, tail: "up", attrs: { class: "fx-pop" } });
    }, { ...fade(w, id), ...fx });
  }
}

/** Листающие гости: куда идут их чтения. */
function drawCrowd(pen: Pen, w: World): void {
  if (w.crowd === null || w.unseen.includes("crowd")) return;
  const toPrimary = w.crowd === "primary";
  pen.group("crowd", 0, 0, () => {
    panel(pen, "crowd:box", { ...CROWD, fill: toPrimary ? COLOR.alarmBg : COLOR.surface, stroke: toPrimary ? COLOR.error : COLOR.line });
    iconText(pen, "crowd:t", "browser", CROWD.x + 14, CROWD.y + 34, "Листают номера: десятки гостей на одну бронь", COLOR.browser, { ...SANS, "font-weight": 700 });
    pen.text("crowd:to", { x: CROWD.x + 14, y: CROWD.y + 66, ...SANS, fill: toPrimary ? COLOR.error : COLOR.ok, "font-weight": 700 },
      toPrimary ? "их чтения идут в primary" : "их чтения идут на реплики");
  }, fade(w, "crowd"));
}

/** Стрелки: гость → под, под → primary (запись), под → источник чтения; проверка метки — пунктиром с итогом. */
function drawArrows(pen: Pen, w: World): void {
  const g = w.guest;
  const reads = PODS.some((id) => w.pods[id].acts.some((a) => a.kind === "read"));
  if (g.pressed) pen.line("arr:press", { x1: GUEST.x + GUEST.w, y1: GUEST.y + 128, x2: POD_X - 8, y2: POD_Y.A + BOB.h / 2, stroke: COLOR.browser, "stroke-width": 2.5, marker: "arrow", ...fade(w, "guest"), ...DRAW });
  if (reads) pen.line("arr:open", { x1: GUEST.x + GUEST.w, y1: GUEST.y + 180, x2: POD_X - 8, y2: POD_Y.B + BOB.h / 2, stroke: COLOR.browser, "stroke-width": 2.5, marker: "arrow", ...fade(w, "guest"), ...DRAW });
  const to = (s: Source) => (s === "primary" ? { x: PRIMARY.x + PRIMARY.w / 2 + 30, y: PRIMARY.y + PRIMARY.h + 8 } : { x: REP_X[s] + 40, y: REP.y - 8 });
  for (const id of PODS) {
    const p = w.pods[id];
    const color = ACTOR[id].color;
    const op = fade(w, id);
    const from = { x: POD_X + BOB.w + 4, y: POD_Y[id] + BOB.h / 2 };
    p.acts.forEach((a, i) => {
      const key = `arr:${id}:${i}`;
      if (a.kind === "write") {
        pen.line(key, { x1: POD_X + BOB.w / 2, y1: POD_Y[id] - 4, x2: PRIMARY.x + PRIMARY.w / 2, y2: PRIMARY.y + PRIMARY.h + 8, stroke: color, "stroke-width": 3, marker: "arrow", ...op, ...DRAW });
        if (a.hang) icon(pen, `${key}:wait`, "hourglass", POD_X + BOB.w / 2 + 10, PRIMARY.y + PRIMARY.h + 10, 24, COLOR.warn, op);
      } else if (a.kind === "read" || a.kind === "ask") {
        const t = to(a.from);
        pen.line(key, { x1: from.x, y1: from.y, x2: t.x, y2: t.y, stroke: color, "stroke-width": 3, marker: "arrow", ...op, ...DRAW });
      } else if (a.kind === "check") {
        const t = to(a.replica);
        pen.line(key, { x1: from.x, y1: from.y + 8, x2: t.x + 30, y2: t.y, stroke: color, "stroke-width": 2, "stroke-dasharray": "6 5", ...op });
        icon(pen, `${key}:ok`, a.ok ? "check" : "cross", t.x + 18, t.y - 30, 24, a.ok ? COLOR.ok : COLOR.error, op);
      }
    });
  }
}

function drawThought(pen: Pen, w: World): void {
  if (!w.guest.thought) return;
  bubble(pen, "guest:think", w.guest.thought, { x: GUEST.x + 66, y: GUEST.y + 70, tail: "left", thought: true, attrs: { class: "fx-pop", ...fade(w, "guest") } });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  if (w.term) pill(pen, "term", w.term, { ...TERM, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  drawGuest(pen, w);
  drawService(pen, w);
  drawTape(pen, w);
  drawReplicas(pen, w);
  drawCrowd(pen, w);
  drawArrows(pen, w);
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [270, 440], attrs: fade(w, "board") });
  pen.layer("top", () => {
    drawThought(pen, w);
    if (w.code) codeWindow(pen, w.code, { rows: 3, y: 124 });
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: PRIMARY.x + PRIMARY.w + 12, right: TERM.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: PRIMARY.x + PRIMARY.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}
