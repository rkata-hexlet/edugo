import { STAGE, type Pen, type Span } from "../../engine/contract";
import { bob, elephant, type Mood } from "../../kit/characters";
import { codeWindow } from "../../kit/code";
import { icon } from "../../kit/icons";
import { buyButton, person } from "../../kit/props";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, stamp } from "../../kit/widgets";
import {
  BOOKING, PODS, PRICE, SAGA_STEPS, active, net, type Act, type Focus, type LogState, type Op, type Pod, type PodId, type SimEvent, type World,
} from "./sim";

// MVP эпизода 12: серые фигуры. Слева — гость (сайт и банк), в середине — поды, правее — наша база (брони и журнал
// саги), справа пунктиром — платёжный шлюз и поставщик. Вызовы к внешним — строкой в их рамке, к базе и гостю — стрелками.
// Внизу — цепочка шагов или вилка решения и табло.

const GUEST = { x: 30, y: 104, w: 266, h: 380 };
const SERVICE = { x: 316, y: 104, w: 230, h: 380 };
const POD_X = 400;
const POD_Y: Record<PodId, number> = { A: 124, B: 236, C: 348 };
const DB = { x: 566, y: 104, w: 294, h: 380 };
const GATEWAY = { x: 880, y: 104, w: 360, h: 186 };
const SUPPLIER = { x: 880, y: 300, w: 360, h: 184 };
const BOTTOM = { x: 30, y: 500, w: 650 };
const BOARD = { x: 700, y: 500, w: 540, rowH: 26 };
const CHAPTER_X = 1100;
const TERM = { x: 960, y: 66 };

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: PodId) => w.events.some((e) => e.kind === kind && (!by || e.by === by));

function drawHeader(pen: Pen, w: World): void {
  elephant(pen, "db:face", { x: DB.x + 8, y: 8, talking: !!w.db, scale: 1.08 });
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: CHAPTER_X, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
}

const SITE = {
  idle: null,
  wait: { text: "Оформляем…", color: COLOR.warn },
  error: { text: "Брони нет", color: COLOR.error },
  ok: { text: `Бронь ${BOOKING}`, color: COLOR.ok },
} as const;

/** Гость: сайт (кнопка и статус брони) и банк (строки выписки, заморозка). */
function drawGuest(pen: Pen, w: World): void {
  const g = w.guest;
  const gw = w.gateway;
  pen.group("guest", 0, 0, () => {
    panel(pen, "guest:box", { ...GUEST });
    iconText(pen, "guest:title", "browser", GUEST.x + 14, GUEST.y + 34, "Гость", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    const mood = g.thought || g.site === "error" ? "sad" : g.site === "ok" ? "happy" : "idle";
    person(pen, "guest:p", { x: GUEST.x + 18, y: GUEST.y + 52, shirt: COLOR.browser, mood });
    buyButton(pen, "guest:btn", { x: GUEST.x + 18, y: GUEST.y + 112, pressed: g.pressed, label: "Забронировать", w: 190 });
    const site = SITE[g.site];
    if (site) {
      const [k, fx] = once("guest:site", w.frame, g.site === "wait" ? null : "fx-pop");
      pen.text(k, { x: GUEST.x + 18, y: GUEST.y + 194, ...SANS, "font-weight": 700, fill: site.color, ...fx }, site.text);
    }
    pen.text("guest:bank", { x: GUEST.x + 18, y: GUEST.y + 248, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Банк");
    const lines: { key: string; text: string; color: string }[] = gw.statement.map((l, i) =>
      l === "charge" ? { key: `c${i}`, text: `−${PRICE} списание`, color: COLOR.error } : { key: `r${i}`, text: `+${PRICE} возврат`, color: COLOR.ok });
    if (gw.frozen) lines.push({ key: "frozen", text: `заморожено ${PRICE}`, color: COLOR.mail });
    if (!lines.length) pen.text("guest:none", { x: GUEST.x + 18, y: GUEST.y + 282, ...SANS, "font-style": "italic", fill: COLOR.faint }, "без движений");
    lines.forEach((l, i) => {
      const y = GUEST.y + 262 + i * 36;
      pen.rect(`guest:l:${l.key}`, { x: GUEST.x + 14, y, width: GUEST.w - 28, height: 30, rx: 6, fill: COLOR.surface2, stroke: l.color, "stroke-width": 1.5, class: "fx-slide" });
      pen.text(`guest:l:${l.key}:t`, { x: GUEST.x + 24, y: y + 22, ...SANS, fill: l.color }, l.text);
    });
  }, fade(w, "guest"));
}

function podMood(p: Pod): Mood {
  if (p.acts.some((a) => !a.ok && a.op !== "skip")) return "wait";
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
    const [k, fx] = once(`pod:${id}`, w.frame, happened(w, "crash", id) ? "fx-shake" : null);
    pen.group(k, POD_X, POD_Y[id], () => {
      bob(pen, `pod:${id}:bob`, { x: 0, y: 0, color, tint, letter: id, mood: podMood(p), look: { x: p.acts.length ? 1 : 0, y: 0 }, ghost: p.down });
      if (p.down) pen.text(`pod:${id}:sig`, { x: -8, y: 88, ...MONO, fill: COLOR.error, "font-weight": 700 }, "SIGTERM");
      else if (p.memory !== null) pen.text(`pod:${id}:mem`, { x: -8, y: 88, ...SANS, fill: COLOR.warn }, `в памяти: ${p.memory} из 4`);
    }, { ...fade(w, id), ...fx });
  }
}

const STATUS = { pending: COLOR.warn, confirmed: COLOR.ok, cancelled: COLOR.muted } as const;

/** Наша база: строка брони и журнал саги. */
function drawDb(pen: Pen, w: World): void {
  pen.group("db", 0, 0, () => {
    panel(pen, "db:box", { ...DB, stroke: COLOR.postgres });
    pen.text("db:title", { x: DB.x + 16, y: DB.y + 34, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
    pen.text("db:bookings", { x: DB.x + 16, y: DB.y + 74, ...MONO, fill: COLOR.muted }, "bookings");
    const b = w.booking;
    if (!b) pen.text("db:empty", { x: DB.x + 16, y: DB.y + 112, ...SANS, "font-style": "italic", fill: COLOR.faint }, "пусто");
    else {
      const color = STATUS[b.status];
      const [k, fx] = once("db:row", w.frame, happened(w, "insert") || happened(w, "confirm") || happened(w, "cancel") ? "fx-pop" : null);
      pen.group(k, 0, 0, () => {
        pen.rect("db:row:bg", { x: DB.x + 14, y: DB.y + 86, width: DB.w - 28, height: 36, rx: 6, fill: COLOR.surface2, stroke: color, "stroke-width": 2 });
        pen.text("db:row:t", { x: DB.x + 26, y: DB.y + 110, ...MONO, fill: color, "font-weight": 700 }, `${b.id} · ${b.status}`);
      }, fx);
    }
    if (!w.saga) return;
    const s = w.saga;
    pen.group("log", 0, 0, () => {
      pen.text("log:title", { x: DB.x + 16, y: DB.y + 164, ...MONO, fill: COLOR.muted }, "sagas");
      if (s.owner) {
        const down = w.pods[s.owner].down;
        pen.text("log:owner", { x: DB.x + DB.w - 16, y: DB.y + 164, ...SANS, "text-anchor": "end", "font-weight": 700, fill: down ? COLOR.faint : ACTOR[s.owner].color },
          `ведёт под ${s.owner}${down ? " †" : ""}`);
      }
      SAGA_STEPS.forEach((step, i) => {
        const e = s.entries.find((x) => x.step === step);
        const y = DB.y + 178 + i * 44;
        pen.rect(`log:s${i}`, { x: DB.x + 14, y, width: DB.w - 28, height: 36, rx: 6, fill: e ? LOG_BG[e.state] : COLOR.surface2, stroke: COLOR.line });
        pen.text(`log:s${i}:t`, { x: DB.x + 26, y: y + 25, ...SANS, fill: e ? COLOR.ink : COLOR.faint }, step);
        if (e) pen.text(`log:s${i}:st`, { x: DB.x + DB.w - 26, y: y + 25, ...SANS, "text-anchor": "end", fill: LOG_INK[e.state] }, e.state);
      });
    }, fade(w, "log"));
  }, fade(w, "db", "log"));
}

/** Журнал: начатое и компенсация в работе — жёлтым, сделанное и отменённое — зелёным, отказ — красным. */
const LOG_BG: Record<LogState, string> = { начат: COLOR.draftBg, сделан: COLOR.doneBg, отказ: COLOR.alarmBg, отмена: COLOR.draftBg, отменён: COLOR.doneBg };
const LOG_INK: Record<LogState, string> = { начат: COLOR.warn, сделан: COLOR.ok, отказ: COLOR.error, отмена: COLOR.warn, отменён: COLOR.ok };

const OP: Partial<Record<Op, string>> = {
  charge: "списать", hold: "холд", capture: "списать холд", release: "снять холд", refund: "возврат", book: "бронь",
};

/** Вызовы подов к внешнему сервису в кадре: «A ▸ холд, бронь»; повтор — «×N», отказ или нет ответа — словами. */
function callLine(w: World, to: Act["to"], full: string): Span[] {
  const spans: Span[] = [];
  for (const id of PODS) {
    const acts = w.pods[id].acts.filter((a) => a.to === to);
    if (!acts.length) continue;
    const parts: { op: Op; n: number; fail: boolean }[] = [];
    for (const a of acts) {
      const last = parts.at(-1);
      if (last && last.op === a.op) {
        last.n++;
        last.fail &&= !a.ok;
      } else parts.push({ op: a.op, n: 1, fail: !a.ok });
    }
    if (spans.length) spans.push({ text: "  " });
    spans.push({ text: `${id} ▸ `, attrs: { fill: ACTOR[id].color, "font-weight": 700 } });
    parts.forEach((p, i) => {
      const fail = acts.some((a) => a.op === p.op && !a.ok);
      const tail = p.n > 1 ? ` ×${p.n}` : fail ? ` (${to === "supplier" && w.supplier.free === 0 ? full : "нет ответа"})` : "";
      spans.push({ text: `${i ? ", " : ""}${OP[p.op]}${tail}`, attrs: { fill: fail && p.n === 1 ? COLOR.error : COLOR.ink } });
    });
  }
  return spans;
}

/** Внешний сервис: пунктирная рамка, хозяин окошка, реплика, вызовы кадра, итог у него внутри. */
function external(
  pen: Pen, w: World, key: "gateway" | "supplier", box: { x: number; y: number; w: number; h: number },
  title: string, say: string | null, chips: { key: string; text: string; color: string }[], corner: string | null,
): void {
  if (w.unseen.includes(key)) return;
  pen.group(key, 0, 0, () => {
    pen.rect(`${key}:box`, { x: box.x, y: box.y, width: box.w, height: box.h, rx: 16, fill: COLOR.bg2, stroke: COLOR.muted, "stroke-width": 2, "stroke-dasharray": "8 6" });
    pen.text(`${key}:t`, { x: box.x + 16, y: box.y + 30, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, title);
    if (corner) pen.text(`${key}:corner`, { x: box.x + box.w - 16, y: box.y + 30, ...SANS, "text-anchor": "end", fill: COLOR.muted }, corner);
    person(pen, `${key}:p`, { x: box.x + 16, y: box.y + 48, shirt: COLOR.postgres, mood: say ? "happy" : "idle" });
    if (say) bubble(pen, `${key}:say`, say, { x: box.x + 66, y: box.y + 66, tail: "left", attrs: { class: "fx-pop" } });
    const calls = callLine(w, key, "нет мест");
    if (calls.length) pen.text(`${key}:calls`, { x: box.x + 16, y: box.y + 126, ...SANS }, calls);
    let x = box.x + 14;
    for (const c of chips) {
      const width = pen.measure(c.text, MONO).width + 20;
      pen.rect(`${key}:chip:${c.key}`, { x, y: box.y + 140, width, height: 32, rx: 6, fill: COLOR.surface2, stroke: c.color, "stroke-width": 2, class: "fx-pop" });
      pen.text(`${key}:chip:${c.key}:t`, { x: x + 10, y: box.y + 162, ...MONO, fill: c.color }, c.text);
      x += width + 8;
    }
  }, fade(w, key));
}

function drawExternals(pen: Pen, w: World): void {
  const g = w.gateway;
  const money = [
    ...(net(w) > 0 || g.statement.includes("refund") ? [{ key: "charge", text: `списано ${PRICE}`, color: COLOR.error }] : []),
    ...(g.statement.includes("refund") ? [{ key: "refund", text: "возврат", color: COLOR.ok }] : []),
    ...(g.frozen ? [{ key: "hold", text: `холд ${PRICE}`, color: COLOR.mail }] : []),
  ];
  external(pen, w, "gateway", GATEWAY, "Платёжный шлюз", g.say, money, null);
  const s = w.supplier;
  const keys = s.bookings.map((b) => ({ key: b.ref, text: b.ref, color: b.cancelled ? COLOR.faint : active(w).length > 1 ? COLOR.error : COLOR.ok }));
  external(pen, w, "supplier", SUPPLIER, "Поставщик номеров", s.say, keys, `свободно: ${s.free}`);
}

/** Стрелки: гость → под, под → наша база, под → гость (ответ). */
function drawArrows(pen: Pen, w: World): void {
  if (w.guest.pressed) pen.line("arr:press", { x1: GUEST.x + GUEST.w, y1: GUEST.y + 128, x2: POD_X - 8, y2: POD_Y.A + 32, stroke: COLOR.browser, "stroke-width": 2.5, marker: "arrow", ...fade(w, "guest"), ...DRAW });
  for (const id of PODS) {
    const p = w.pods[id];
    const color = ACTOR[id].color;
    const op = fade(w, id);
    const y = POD_Y[id] + 32;
    const toDb = p.acts.filter((a) => a.to === "db");
    if (toDb.length) {
      const skipped = toDb.every((a) => a.op === "skip");
      pen.line(`arr:${id}:db`, { x1: POD_X + 68, y1: y, x2: DB.x - 6, y2: y, stroke: color, "stroke-width": 3, marker: "arrow", ...(skipped ? { "stroke-dasharray": "6 5" } : {}), ...op, ...DRAW });
      const label = toDb.some((a) => a.op === "claim") ? "взял сагу" : skipped ? "занято" : null;
      if (label) pen.text(`arr:${id}:db:t`, { x: POD_X + 72, y: y - 10, ...SANS, fill: color, "font-weight": 700 }, label);
    }
    const out = p.acts.filter((a) => a.to === "gateway" || a.to === "supplier");
    if (out.length) icon(pen, `arr:${id}:out`, "broadcast", POD_X + 70, y + 6, 24, color, op);
    const answer = p.acts.find((a) => a.to === "guest");
    if (answer) pen.line(`arr:${id}:guest`, { x1: POD_X - 8, y1: y + 14, x2: GUEST.x + GUEST.w + 4, y2: GUEST.y + 186, stroke: answer.ok ? COLOR.ok : COLOR.error, "stroke-width": 2.5, marker: "arrow", ...op, ...DRAW });
  }
}

const PAIRS: [string, string | null][] = [["pending", "cancelled"], ["списание", "возврат"], ["бронь", "отмена брони"], ["confirmed", null]];
const PIVOT: [string, string][] = [["pending", "легко отменить"], ["холд", "легко отменить"], ["бронь", "может отказать"], ["списание", "только возврат"]];
const CARD = { w: 152, h: 40, gap: 8 };

/** Цепочка саги: шаги и обратные шаги (стрелки обратно справа налево) или порядок с точкой невозврата. */
function drawChain(pen: Pen, w: World): void {
  if (!w.chain) return;
  const cx = (i: number) => BOTTOM.x + 10 + i * (CARD.w + CARD.gap);
  const card = (key: string, i: number, y: number, text: string, color: string) => {
    pen.rect(key, { x: cx(i), y, width: CARD.w, height: CARD.h, rx: 8, fill: COLOR.surface2, stroke: color, "stroke-width": 2, class: "fx-pop" });
    pen.text(`${key}:t`, { x: cx(i) + CARD.w / 2, y: y + 27, ...SANS, "text-anchor": "middle", fill: COLOR.ink }, text);
  };
  pen.group(`chain-${w.chain}`, 0, 0, () => {
    if (w.chain === "pairs") {
      PAIRS.forEach(([step, back], i) => {
        card(`chain:s${i}`, i, BOTTOM.y + 6, step, COLOR.ok);
        if (i < 3) pen.line(`chain:f${i}`, { x1: cx(i) + CARD.w, y1: BOTTOM.y + 26, x2: cx(i + 1) - 2, y2: BOTTOM.y + 26, stroke: COLOR.muted, "stroke-width": 2, marker: "arrow" });
        if (back) {
          card(`chain:b${i}`, i, BOTTOM.y + 90, back, COLOR.warn);
          pen.line(`chain:d${i}`, { x1: cx(i) + CARD.w / 2, y1: BOTTOM.y + 48, x2: cx(i) + CARD.w / 2, y2: BOTTOM.y + 86, stroke: COLOR.warn, "stroke-width": 2, marker: "arrow" });
        }
        if (i > 0 && i < 3) pen.line(`chain:r${i}`, { x1: cx(i) - 2, y1: BOTTOM.y + 110, x2: cx(i - 1) + CARD.w + 2, y2: BOTTOM.y + 110, stroke: COLOR.warn, "stroke-width": 2, marker: "arrow" });
      });
      return;
    }
    PIVOT.forEach(([step, note], i) => {
      card(`chain:s${i}`, i, BOTTOM.y + 6, step, i === 3 ? COLOR.error : i === 2 ? COLOR.warn : COLOR.ok);
      if (i !== 1) {
        const x = i === 0 ? cx(0) + CARD.w + CARD.gap / 2 : cx(i) + CARD.w / 2;
        pen.text(`chain:n${i}`, { x, y: BOTTOM.y + 76, ...SANS, "text-anchor": "middle", fill: COLOR.muted }, note);
      }
    });
    const px = cx(3) - CARD.gap / 2;
    pen.line("chain:pivot", { x1: px, y1: BOTTOM.y, x2: px, y2: BOTTOM.y + 140, stroke: COLOR.error, "stroke-width": 3, "stroke-dasharray": "6 4" });
    pen.text("chain:pivot:t", { x: cx(3) + CARD.w / 2, y: BOTTOM.y + 132, ...SANS, "text-anchor": "middle", "font-weight": 700, fill: COLOR.error }, "точка невозврата");
  }, fade(w, "chain"));
}

const FORK: { kind: World["fork"]; text: string }[] = [
  { kind: "forward", text: "временный сбой → повторяем вперёд" },
  { kind: "fix", text: "окончательный отказ → исправляем с конца" },
  { kind: "retry", text: "исправление → повторяем, пока не пройдёт" },
];

/** Вилка решения: три правила, текущее ярко. */
function drawFork(pen: Pen, w: World): void {
  if (!w.fork) return;
  pen.group("fork", 0, 0, () => {
    FORK.forEach((f, i) => {
      const on = f.kind === w.fork;
      const y = BOTTOM.y + 8 + i * 44;
      pen.rect(`fork:r${i}`, { x: BOTTOM.x, y, width: BOTTOM.w, height: 36, rx: 8, fill: on ? COLOR.surface2 : "none", stroke: on ? COLOR.warn : COLOR.line, "stroke-width": on ? 2 : 1 });
      pen.text(`fork:t${i}`, { x: BOTTOM.x + 16, y: y + 25, ...SANS, "font-weight": on ? 700 : 400, fill: on ? COLOR.ink : COLOR.faint }, f.text);
    });
  }, fade(w, "fork"));
}

/** «Одна транзакция на троих»: рамка вокруг базы, шлюза и поставщика — и её нет. */
function drawSplit(pen: Pen, w: World): void {
  if (!w.split) return;
  pen.rect("split:box", { x: DB.x - 10, y: DB.y - 10, width: GATEWAY.x + GATEWAY.w - DB.x + 20, height: DB.h + 20, rx: 20, fill: "none", stroke: COLOR.error, "stroke-width": 3, "stroke-dasharray": "14 10", class: "fx-draw", pathLength: 1 });
  pill(pen, "split:t", "общей транзакции нет", { x: BOTTOM.x, y: BOTTOM.y + 20, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, attrs: { class: "fx-pop" } });
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
  drawDb(pen, w);
  drawExternals(pen, w);
  drawArrows(pen, w);
  drawChain(pen, w);
  drawFork(pen, w);
  drawSplit(pen, w);
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [330, 470], attrs: fade(w, "board") });
  pen.layer("top", () => {
    drawThought(pen, w);
    if (w.code) codeWindow(pen, w.code, { rows: 6, y: 124 });
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + 60, right: TERM.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + 60, y: 40, tail: "left", attrs: { class: "fx-pop" } });
  });
}
