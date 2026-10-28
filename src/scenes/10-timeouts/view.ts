import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, type Mood } from "../../kit/characters";
import { codeWindow } from "../../kit/code";
import { icon, type IconName } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, stamp } from "../../kit/widgets";
import { clock } from "./script";
import { PODS, POOL, SUP_CAP, type Focus, type Pod, type PodId, type Reply, type SimEvent, type World } from "./sim";

// MVP эпизода 10: серые фигуры. Слева — наш сервис (пул, гости, поды), справа — поставщик (очередь, брони), снизу —
// табло и волна повторов.

const POOL_BOX = { x: 40, y: 104, w: 560, h: 84 };
const SLOT = { x: 56, y: 140, w: 78, h: 34, gap: 10 };
const GUESTS = { x: 40, y: 216, w: 226, h: 256, line0: 290, lineH: 30 };
const POD_Y: Record<PodId, number> = { A: 220, B: 316, C: 412 };
const POD_X = 300;
const SERVICE = { x: 284, y: 200, w: 316, h: 304 };
const SUP = { x: 690, y: 104, w: 550, h: 346 };
const CARD = { x: 706, y: 196, w: 52, h: 40, gap: 8 };
const ROWS = { x: 706, y: 300, lineH: 30 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const WAVE = { x: 300, y: 548, w: 420, h: 100 };
const DB = { x: 100, w: 130 };
const HEAD_X = 640;

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const about = (w: World, id: Focus, all = true) => (w.focus ? w.focus.includes(id) : all);
const happened = (w: World, kind: SimEvent["kind"], by?: PodId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const did = (p: Pod, kind: Pod["acts"][number]["kind"]) => p.acts.some((a) => a.kind === kind);
const podMid = (id: PodId) => POD_Y[id] + BOB.h / 2;
const seconds = (ms: number) => (ms < 1000 ? `${String(ms / 1000).replace(".", ",")} с` : `${ms / 1000} с`);

function drawPool(pen: Pen, w: World): void {
  if (w.unseen.includes("pool")) return;
  const busy = w.pool.filter(Boolean).length;
  const [k, fx] = once("pool", w.frame, happened(w, "jam") ? "fx-shake" : null);
  pen.group(k, 0, 0, () => {
    panel(pen, "pool:box", { ...POOL_BOX, fill: busy === POOL ? COLOR.alarmBg : COLOR.surface, stroke: busy === POOL ? COLOR.error : COLOR.postgres });
    pen.text("pool:title", { x: POOL_BOX.x + 16, y: POOL_BOX.y + 26, ...SANS, "font-weight": 700, fill: COLOR.ink }, `Пул соединений · ${busy} из ${POOL}`);
    if (w.searchQueue > 0) {
      pen.text("pool:queue", { x: POOL_BOX.x + POOL_BOX.w - 16, y: POOL_BOX.y + 26, ...SANS, "text-anchor": "end", fill: COLOR.error, "font-weight": 700 },
        `поиск в очереди: ${w.searchQueue}`);
    }
    w.pool.forEach((s, i) => {
      const x = SLOT.x + i * (SLOT.w + SLOT.gap);
      const color = s ? ACTOR[s.by].color : COLOR.line;
      pen.rect(`pool:s${i}`, { x, y: SLOT.y, width: SLOT.w, height: SLOT.h, rx: 8, fill: s ? ACTOR[s.by].tint : COLOR.surface2, stroke: color, "stroke-width": 2 });
      if (s) pen.text(`pool:s${i}:t`, { x: x + SLOT.w / 2, y: SLOT.y + 24, ...SANS, "text-anchor": "middle", fill: COLOR.ink }, s.kind === "book" ? "бронь" : "поиск");
    });
  }, { ...fade(w, "pool"), ...fx });
}

const REPLY: Record<Reply["status"], { icon: IconName; color: string; search: string; book: string }> = {
  ok: { icon: "check", color: COLOR.ok, search: "номера", book: "забронировано" },
  wait: { icon: "hourglass", color: COLOR.warn, search: "ищем…", book: "бронируем…" },
  unknown: { icon: "question", color: COLOR.warn, search: "?", book: "проверяем" },
  later: { icon: "clock", color: COLOR.muted, search: "позже", book: "попробуйте позже" },
  error: { icon: "cross", color: COLOR.error, search: "ошибка", book: "ошибка" },
};

function drawGuests(pen: Pen, w: World): void {
  pen.group("guests", 0, 0, () => {
    panel(pen, "guests:box", { ...GUESTS });
    iconText(pen, "guests:title", "browser", GUESTS.x + 14, GUESTS.y + 36, "Гости", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    w.replies.slice(-6).forEach((r, i) => { // в журнал влезает шесть строк
      const s = REPLY[r.status];
      const y = GUESTS.line0 + i * GUESTS.lineH;
      pen.group(`guests:l${i}:${r.kind}:${r.status}`, 0, 0, () => {
        iconText(pen, `guests:l${i}`, s.icon, GUESTS.x + 14, y, r.kind === "search" ? `поиск: ${s.search}` : s.book, s.color, SANS);
      });
    });
  }, fade(w, "guests"));
}

function podMood(p: Pod): Mood {
  if (p.waiting > 0) return "wait";
  if (p.acts.length) return "work";
  return "idle";
}

const BREAKER: Record<NonNullable<Pod["breaker"]>, { text: string; color: string }> = {
  closed: { text: "замкнут", color: COLOR.ok },
  open: { text: "разомкнут", color: COLOR.error },
  half: { text: "пробный", color: COLOR.warn },
};

function drawPod(pen: Pen, w: World, p: Pod): void {
  const { color, tint } = ACTOR[p.id];
  pen.group(`pod:${p.id}`, POD_X, POD_Y[p.id], () => {
    bob(pen, `pod:${p.id}:bob`, { x: 0, y: 0, color, tint, letter: p.id, mood: podMood(p), look: { x: p.acts.some((a) => a.kind === "call") ? 1 : 0, y: 0 }, dashed: p.waiting > 0 });
    if (p.breaker) {
      const b = BREAKER[p.breaker];
      const [k, fx] = once(`pod:${p.id}:br`, w.frame, happened(w, "trip", p.id) || happened(w, "close", p.id) || happened(w, "probe", p.id) ? "fx-pop" : null);
      pen.group(k, 0, 0, () => {
        pen.rect(`pod:${p.id}:br:bg`, { x: BOB.w + 10, y: 19, width: 112, height: 26, rx: 8, fill: COLOR.surface2, stroke: b.color, "stroke-width": 2 });
        pen.text(`pod:${p.id}:br:t`, { x: BOB.w + 66, y: 38, ...SANS, "text-anchor": "middle", fill: b.color, "font-weight": 700 }, b.text);
      }, { ...fade(w, "breakers", p.id), ...fx });
    }
  }, fade(w, p.id));
}

/** Наш сервис: рамка вокруг подов — к нему обращается гость. */
function drawService(pen: Pen, w: World): void {
  pen.group("svc", 0, 0, () => {
    panel(pen, "svc:box", { ...SERVICE, fill: "none", stroke: COLOR.line, shadow: false });
    pen.text("svc:title", { x: SERVICE.x + 16, y: SERVICE.y + SERVICE.h - 14, ...SANS, "font-weight": 700, fill: COLOR.muted }, "Сервис бронирования");
  }, fade(w, ...PODS));
}

/** Стрелки пода: к пулу (слот), к поставщику (вызов; повтор — пунктиром), таймаут — крест на обрыве. */
function drawArrows(pen: Pen, w: World): void {
  for (const id of PODS) {
    const p = w.pods[id];
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const from = { x: POD_X + BOB.w / 2, y: POD_Y[id] - 4 };
    if ((did(p, "search") || did(p, "slot")) && w.unseen.includes("pool")) {
      // Пула ещё нет в кадре: под ходит прямо в базу.
      pen.line(`arr:${id}:db`, { x1: from.x, y1: from.y, x2: DB.x + DB.w + 14, y2: 74, stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", marker: "arrow", opacity: op, ...DRAW });
    } else if (did(p, "search") || did(p, "slot")) {
      pen.line(`arr:${id}:pool`, { x1: from.x, y1: from.y, x2: from.x, y2: SLOT.y + SLOT.h + 10, stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", marker: "arrow", opacity: op, ...DRAW });
    }
    const call = p.acts.find((a) => a.kind === "call");
    if (call && call.kind === "call") {
      const cut = did(p, "timeout");
      const x2 = cut ? (POD_X + BOB.w + SUP.x) / 2 + 40 : SUP.x - 6;
      pen.line(`arr:${id}:sup`, {
        x1: POD_X + BOB.w + 6, y1: podMid(id), x2, y2: CARD.y + CARD.h / 2 + (PODS.indexOf(id) - 1) * 12,
        stroke: color, "stroke-width": 3, "stroke-linecap": "round", ...(cut ? {} : { marker: "arrow" }), opacity: op,
        ...(call.retry ? { "stroke-dasharray": "8 6" } : DRAW),
      });
      if (cut) icon(pen, `arr:${id}:cut`, "cross", x2 - 4, CARD.y + CARD.h / 2 + (PODS.indexOf(id) - 1) * 12 - 12, 24, COLOR.error, { opacity: op });
    }
    if (did(p, "fast")) icon(pen, `arr:${id}:fast`, "check", POD_X - 36, podMid(id) - 12, 24, COLOR.ok, { opacity: op });
  }
}

function drawThoughts(pen: Pen, w: World): void {
  for (const id of PODS) {
    const t = w.pods[id].thought;
    if (!t) continue;
    bubble(pen, `pod:${id}:think`, t, { x: POD_X + BOB.w + 8, y: POD_Y[id] - 2, tail: "left", thought: true, attrs: { class: "fx-pop", ...fade(w, id) } });
  }
}

function drawSupplier(pen: Pen, w: World): void {
  if (w.unseen.includes("supplier")) return;
  const s = w.supplier;
  const dead = s.latency === null;
  const [k, fx] = once("sup", w.frame, happened(w, "down") || happened(w, "up") ? "fx-pulse" : null);
  pen.group(k, 0, 0, () => {
    panel(pen, "sup:box", { ...SUP, fill: dead ? COLOR.alarmBg : COLOR.surface, stroke: dead ? COLOR.error : COLOR.muted });
    pen.text("sup:title", { x: SUP.x + 16, y: SUP.y + 34, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Сеть отелей · поставщик");
    const lat = dead ? "лежит" : `ответ: ${seconds(s.latency!)}`;
    pen.text("sup:lat", { x: SUP.x + SUP.w - 16, y: SUP.y + 34, ...SANS, "text-anchor": "end", "font-weight": 700, fill: dead ? COLOR.error : s.latency! > 1000 ? COLOR.warn : COLOR.ok }, lat);
    pen.text("sup:q", { x: CARD.x, y: CARD.y - 14, ...SANS, fill: COLOR.muted }, s.queue.length ? `очередь: ${s.queue.length}` : "очередь пуста");
    s.queue.slice(0, 9).forEach((c, i) => {
      const x = CARD.x + i * (CARD.w + CARD.gap);
      const color = c.from ? ACTOR[c.from].color : COLOR.faint;
      pen.rect(`sup:c${i}`, {
        x, y: CARD.y, width: CARD.w, height: CARD.h, rx: 6, fill: c.from ? ACTOR[c.from].tint : COLOR.surface2, stroke: color, "stroke-width": 2,
        ...(c.abandoned ? { "stroke-dasharray": "5 4", opacity: 0.6 } : {}),
      });
      if (c.from) pen.text(`sup:c${i}:t`, { x: x + CARD.w / 2, y: CARD.y + 27, ...SANS, "text-anchor": "middle", "font-weight": 700, fill: COLOR.ink }, c.from);
    });
    pen.text("sup:rows", { x: ROWS.x, y: ROWS.y - 12, ...SANS, fill: COLOR.muted }, "Брони у поставщика");
    const dup = s.rows.filter((r) => r.guest === s.rows.at(-1)?.guest).length > 1;
    s.rows.slice(-4).forEach((r, i) => {
      const y = ROWS.y + 18 + i * ROWS.lineH;
      const ref = r.ref ? ` · ${r.ref}` : "";
      pen.text(`sup:r${i}:${r.id}`, { x: ROWS.x, y, ...MONO, fill: dup && r.guest ? COLOR.error : COLOR.ink, ...(happened(w, "confirm") ? { class: "fx-slide" } : {}) },
        `${r.id} · ${r.guest || "чужая"}${ref} · confirmed`);
    });
    if (s.doubt && !s.rows.some((r) => r.guest)) {
      icon(pen, "sup:doubt", "question", SUP.x + SUP.w - 60, ROWS.y + 4, 40, COLOR.warn, { class: "fx-pop" });
    }
  }, { ...fade(w, "supplier", "rows"), ...fx });
}

/** Волна повторов: удары в поставщика по секундам; пунктир — сколько он выдерживает. */
function drawWave(pen: Pen, w: World): void {
  const wave = w.wave;
  if (!wave) return;
  const peak = Math.max(4, ...wave);
  const bw = Math.min(40, WAVE.w / wave.length - 4);
  const unit = WAVE.h / peak;
  pen.group("wave", 0, 0, () => {
    pen.text("wave:title", { x: WAVE.x, y: WAVE.y - 14, ...SANS, fill: COLOR.muted }, "Повторов в поставщика за секунду");
    wave.forEach((n, i) => {
      if (!n) return;
      const h = n * unit;
      pen.rect(`wave:b${i}`, { x: WAVE.x + i * (bw + 4), y: WAVE.y + WAVE.h - h, width: bw, height: h, rx: 3, fill: n > SUP_CAP ? COLOR.error : COLOR.warn, class: "fx-grow" });
    });
    const capY = WAVE.y + WAVE.h - SUP_CAP * unit;
    pen.line("wave:cap", { x1: WAVE.x, y1: capY, x2: WAVE.x + WAVE.w, y2: capY, stroke: COLOR.ok, "stroke-width": 2, "stroke-dasharray": "6 5" });
    pen.line("wave:axis", { x1: WAVE.x, y1: WAVE.y + WAVE.h, x2: WAVE.x + WAVE.w, y2: WAVE.y + WAVE.h, stroke: COLOR.line, "stroke-width": 2 });
  }, { ...fade(w, "supplier"), class: "fx-fade" });
}

function drawHeader(pen: Pen, w: World): void {
  elephant(pen, "db:face", { x: 44, y: 8, talking: !!w.db, scale: 1.08, look: w.db ? { x: 1, y: 0 } : undefined });
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: HEAD_X, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!about(w, "clock", false) && !happened(w, "clock")) return;
  const [clockKey, clockFx] = once("clock", w.frame, happened(w, "clock") ? "fx-pulse" : null);
  pen.group(clockKey, 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
  }, { ...fade(w, "clock"), ...clockFx });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: HEAD_X, y: 64, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  drawPool(pen, w);
  drawGuests(pen, w);
  drawService(pen, w);
  drawSupplier(pen, w);
  drawArrows(pen, w);
  for (const id of PODS) drawPod(pen, w, w.pods[id]);
  drawWave(pen, w);
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [285, 420], attrs: fade(w, "board") });
  drawThoughts(pen, w);
  pen.layer("top", () => {
    if (w.code) codeWindow(pen, w.code, { rows: 5, y: 124 });
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: HEAD_X - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}
