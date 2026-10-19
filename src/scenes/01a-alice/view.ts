import type { Pen } from "../../engine/contract";
import { COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, panel, pill } from "../../kit/widgets";
import { ACTORS, type ActorId, type Focus, type World } from "../01-skip-locked/sim";
import { clock } from "../01-skip-locked/script";

// MVP «Алисы»: серые фигуры и подписи, без полировки. Слева сад (таблица кустов), в центре
// садовники-карты, справа корзина Герцогини, сверху Королева со своими часами.

const TABLE = { x: 40, y: 150, rowH: 52, gap: 8 };
const COLS = [
  { title: "куст", x: 0, w: 100 },
  { title: "статус", x: 100, w: 180 },
  { title: "бирка", x: 280, w: 200 },
  { title: "до", x: 480, w: 130 },
];
const CARD = { x: 720, w: 64, h: 90 };
const CARD_Y: Record<ActorId, number> = { A: 130, B: 280, C: 430 };
const BASKET = { x: 960, y: 150, w: 280, h: 300 };

const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };

const rowY = (id: number) => TABLE.y + (id - 1) * (TABLE.rowH + TABLE.gap);
const cols = (w: World) => (w.leaseCols ? COLS : COLS.slice(0, 2));
const tableRight = (w: World) => TABLE.x + cols(w).reduce((x, c) => Math.max(x, c.x + c.w), 0);
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });

/** Цвет куста — статус строки: белый (new), наполовину (в работе), красный (done). */
const ROSE = { new: COLOR.ink, in_progress: COLOR.warn, done: COLOR.error } as const;

function drawQueen(pen: Pen, w: World): void {
  pen.group("queen", 0, 0, () => {
    panel(pen, "queen:box", { x: 40, y: 20, w: 190, h: 56, fill: COLOR.surface2, stroke: COLOR.postgres });
    pen.text("queen:t", { x: 58, y: 56, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Королева");
  });
  if (w.db) bubble(pen, "queen:say", w.db, { x: 240, y: 48, tail: "left" });
  pen.group("clock", 0, 0, () => {
    pen.text("clock:t", { x: 1240, y: 50, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink, "text-anchor": "end" }, clock(w.clock));
    pen.text("clock:l", { x: 1240, y: 84, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, "часы Королевы");
  }, fade(w, "clock"));
}

function drawGarden(pen: Pen, w: World): void {
  cols(w).forEach((c, i) =>
    pen.text(`hdr:${i}`, { x: TABLE.x + c.x + 12, y: TABLE.y - 14, ...MONO, fill: COLOR.muted, ...fade(w, "table") }, c.title));
  const right = tableRight(w) - TABLE.x;
  for (const r of w.rows) {
    const y = rowY(r.id);
    const clash = w.clash?.row === r.id;
    pen.group(`row:${r.id}`, TABLE.x, y, () => {
      pen.rect(`row:${r.id}:bg`, {
        width: right, height: TABLE.rowH, rx: 8, fill: COLOR.surface,
        stroke: clash ? COLOR.error : COLOR.line, "stroke-width": clash ? 3 : 1.5,
      });
      pen.rect(`row:${r.id}:rose`, { x: 14, y: 12, width: 28, height: 28, rx: 14, fill: ROSE[r.status], stroke: COLOR.faint });
      pen.text(`row:${r.id}:id`, { x: 56, y: 33, ...MONO, fill: COLOR.ink }, String(r.id));
      pen.text(`row:${r.id}:st`, { x: 112, y: 33, ...MONO, fill: COLOR.ink }, r.status);
      if (!w.leaseCols) return;
      const old = w.ghost?.row === r.id ? `  ${w.ghost.token}` : "";
      pen.text(`row:${r.id}:tok`, { x: 292, y: 33, ...MONO, fill: COLOR.ink }, [
        { text: r.token ?? "—" },
        ...(old ? [{ text: old, attrs: { fill: COLOR.muted, "text-decoration": "line-through" } }] : []),
      ]);
      const late = r.leaseUntil !== null && r.leaseUntil < w.clock && r.status === "in_progress";
      pen.text(`row:${r.id}:until`, { x: 492, y: 33, ...MONO, fill: late ? COLOR.error : COLOR.ink }, r.leaseUntil === null ? "—" : clock(r.leaseUntil));
    }, fade(w, "table", `row:${r.id}`));
  }
}

function drawGardener(pen: Pen, w: World, id: ActorId): void {
  const a = w.actors[id];
  const y = CARD_Y[id];
  pen.group(`card:${id}`, CARD.x, y, () => {
    pen.rect(`card:${id}:bg`, { width: CARD.w, height: CARD.h, rx: 8, fill: a.frozen ? COLOR.surface : COLOR.surface2, stroke: COLOR.muted, "stroke-width": 2 });
    pen.text(`card:${id}:suit`, { x: CARD.w / 2, y: 54, ...SANS, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.error, "text-anchor": "middle" }, { A: "2", B: "5", C: "7" }[id]);
    pen.text(`card:${id}:name`, { x: CARD.w + 16, y: 34, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, a.label);
    if (a.token) pen.text(`card:${id}:tok`, { x: CARD.w + 16, y: 64, ...MONO, fill: COLOR.muted }, `бирка ${a.token}`);
    if (a.frozen) pen.text(`card:${id}:zz`, { x: CARD.w - 4, y: -6, ...SANS, "font-weight": 700, fill: COLOR.muted }, "z z");
    if (w.doubt === id) pen.text(`card:${id}:q`, { x: -24, y: 30, ...SANS, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.warn }, "?");
  }, fade(w, id));
  if (a.thought) bubble(pen, `card:${id}:th`, a.thought, { x: CARD.x + CARD.w / 2, y: y + CARD.h + 4, tail: "up", thought: true });
  if (a.carrying !== null) {
    const ry = rowY(a.carrying) + TABLE.rowH / 2;
    pen.line(`arrow:${id}`, { x1: CARD.x - 8, y1: y + CARD.h / 2, x2: tableRight(w) + 10, y2: ry, stroke: COLOR.muted, "stroke-width": 2.5, marker: "arrow", ...fade(w, id) });
  }
}

function drawBasket(pen: Pen, w: World): void {
  pen.group("basket", 0, 0, () => {
    panel(pen, "basket:box", { x: BASKET.x, y: BASKET.y, w: BASKET.w, h: BASKET.h, stroke: COLOR.mail });
    pen.text("basket:t", { x: BASKET.x + 18, y: BASKET.y + 34, ...SANS, "font-weight": 700, fill: COLOR.mail }, "Корзина Герцогини");
    const sent = w.letters.filter((l) => !l.replayed);
    w.letters.forEach((l, i) => {
      const dup = !l.replayed && sent.filter((s) => s.row === l.row).length > 1;
      const who = w.actors[l.by].label;
      const label = l.replayed ? `№${l.row} уже была · ${who}` : `роза${l.keyed ? ` №${l.row}` : ""} · ${who}`;
      pen.text(`basket:l${i}`, {
        x: BASKET.x + 18, y: BASKET.y + 74 + i * 32, ...SANS,
        fill: l.replayed ? COLOR.muted : dup ? COLOR.error : COLOR.ink,
      }, label);
    });
  }, fade(w, "mail"));
  if (w.mail) bubble(pen, "basket:say", w.mail, { x: BASKET.x + BASKET.w - 40, y: BASKET.y + BASKET.h + 4, tail: "up", align: "end" });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: 1280, height: 720, fill: COLOR.bg }));
  drawQueen(pen, w);
  drawGarden(pen, w);
  for (const id of ACTORS) drawGardener(pen, w, id);
  drawBasket(pen, w);
  pen.layer("top", () => {
    if (w.term) pill(pen, "term", w.term, { x: 720, y: 22, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true });
    if (w.stamp) pill(pen, "stamp", w.stamp, { x: 40, y: 560, fill: COLOR.warn, color: COLOR.bg });
  });
}
