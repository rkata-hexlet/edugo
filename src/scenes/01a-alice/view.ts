import type { Pen } from "../../engine/contract";
import { ALICE, basket, book, bush, duchess, fence, gardener, queen, rose, tag, type GardenerMood, type QueenMood } from "../../kit/alice";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, pill } from "../../kit/widgets";
import type { ActorId, Focus, Row, SimEvent, World } from "../01-skip-locked/sim";
import { clock } from "../01-skip-locked/script";

// Сад Червонной Королевы (дизайн motion-designer 19.10): таблицы нет — строка это куст, колонки —
// розы (статус) и бирка (claim_token, lease_until). Королева с часами — база; за оградой Герцогиня
// с корзиной и книгой — получатель. Двойка (A) в этом кейсе не работает и в кадр не входит.

const GARDENER: Partial<Record<ActorId, { x: number; num: string }>> = { B: { x: 280, num: "5" }, C: { x: 520, num: "7" } };
const GARDENER_Y = 470;
const BUSH: Record<number, { cx: number; y: number; scale: number }> = {
  1: { cx: 440, y: 270, scale: 1 },
  2: { cx: 650, y: 300, scale: 0.85 },
  3: { cx: 800, y: 300, scale: 0.85 },
};
const DUCHESS = { x: 960, y: 300 };
const BASKET = { x: 950, y: 430 };
/** Места роз: в корзине — в ряд по верху; отвергнутый повтор — на земле у ограды. */
const roseIn = (k: number) => ({ x: BASKET.x + 18 + k * 24, y: BASKET.y - 2 });
const FALLEN = { x: 930, y: 610 };

const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"]) => w.events.some((e) => e.kind === kind);

function queenMood(w: World): QueenMood {
  if (happened(w, "clash")) return "refuse";
  if (happened(w, "ghost")) return "check";
  if (happened(w, "expire")) return "bored";
  return w.db ? "talk" : "calm";
}

function gardenerMood(w: World, id: ActorId): GardenerMood {
  const a = w.actors[id];
  if (a.frozen) return "frozen";
  if (w.clash?.by === id && happened(w, "clash")) return "lost";
  if (a.carrying !== null) return "work";
  return "idle";
}

function drawQueen(pen: Pen, w: World): void {
  const mood = queenMood(w);
  pen.group("q", 0, 0, () =>
    queen(pen, "queen", {
      x: 60, y: 40, mood, time: clock(w.clock), seconds: w.clock % 60,
      fx: mood === "refuse" ? "fx-shake" : mood === "check" ? "fx-nod" : undefined,
    }), fade(w, "clock", "table"));
  if (w.db) bubble(pen, "queen:say", w.db, { x: 290, y: 86, tail: "left", attrs: { class: "fx-pop" } });
}

function drawBush(pen: Pen, w: World, r: Row): void {
  const b = BUSH[r.id];
  pen.group(`garden:${r.id}`, 0, 0, () => {
    bush(pen, `bush:${r.id}`, { cx: b.cx, y: b.y, status: r.status, scale: b.scale });
    if (!w.leaseCols) return;
    const late = r.leaseUntil !== null && r.leaseUntil < w.clock && r.status === "in_progress";
    // Новый номер — новая бирка (новый узел въезжает); старая гаснет сама.
    tag(pen, `tag:${r.id}:${r.token ?? "blank"}`, {
      x: b.cx - 70, y: b.y + 60 * b.scale + 6, number: r.token, until: r.leaseUntil === null ? null : clock(r.leaseUntil),
      late, clash: w.clash?.row === r.id, fx: r.token ? "fx-slide" : "fx-pop",
    });
  }, fade(w, "table", `row:${r.id}`));
}

function drawGardener(pen: Pen, w: World, id: ActorId): void {
  const g = GARDENER[id]!;
  const a = w.actors[id];
  const stale = a.token !== null && !w.rows.some((r) => r.token === a.token);
  pen.group(`g:${id}`, 0, 0, () => {
    gardener(pen, `gardener:${id}`, {
      x: g.x, y: GARDENER_Y, num: g.num, color: ACTOR[id].color, mood: gardenerMood(w, id),
      holding: a.token, stale, doubt: w.doubt === id,
    });
    pen.text(`gardener:${id}:name`, {
      x: g.x + 36, y: 612, "font-family": FONT.sans, "font-size": SIZE.say, "font-weight": 700, fill: ACTOR[id].color, "text-anchor": "middle",
    }, a.label);
    if (a.carrying !== null) {
      const b = BUSH[a.carrying];
      pen.line(`reach:${id}:${a.token}`, {
        x1: g.x + 36, y1: GARDENER_Y - 40, x2: b.cx + (g.x < b.cx ? -24 : 24), y2: b.y + 104,
        stroke: ACTOR[id].color, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow", pathLength: 1, class: "fx-draw",
      });
    }
  }, fade(w, id));
  if (a.thought) bubble(pen, `gardener:${id}:th`, a.thought, { x: g.x - 6, y: 430, tail: "right", thought: true });
}

function drawReceiver(pen: Pen, w: World): void {
  const replayed = happened(w, "replay");
  const accepted = !replayed && happened(w, "send");
  pen.group("receiver", 0, 0, () => {
    fence(pen, "fence", { x: 900, y: 372, n: 5 });
    duchess(pen, "duchess", { ...DUCHESS, mood: replayed ? "already" : accepted ? "accept" : "calm" });
    basket(pen, "basket", { ...BASKET, jolt: accepted });
    if (w.keyed) {
      const entries = w.letters.filter((l) => l.keyed && !l.replayed).map((l) => `№${l.row}`);
      const hit = w.letters.find((l) => l.replayed);
      book(pen, "book", { x: 1110, y: 420, entries, hit: replayed && hit ? `№${hit.row}` : null });
    }
  }, fade(w, "mail"));
  // Розы: первая отправка по кусту — в корзину; без ключа повтор тоже ложится (дубль, красный ободок);
  // с ключом повтор отскакивает на землю. Ключ узла — по отправке: новая роза пролетает один раз.
  const sent = w.letters.filter((l) => !l.replayed);
  let k = 0;
  w.letters.forEach((l, i) => {
    const pos = l.replayed ? FALLEN : roseIn(k++);
    const fx = l.replayed ? "fx-bounce-c" : l.by === "B" ? "fx-fly-b" : "fx-fly-c";
    rose(pen, `rose:${i}:${l.keyed ? "k" : "n"}`, {
      ...pos, keyed: l.keyed ? `№${l.row}` : null, fx,
      dup: !l.replayed && sent.filter((s) => s.row === l.row).length > 1, dim: l.replayed && !replayed,
    });
  });
  if (w.mail) bubble(pen, "duchess:say", w.mail, { x: 1030, y: 300, tail: "down", align: "end", attrs: { class: "fx-pop" } });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => {
    pen.rect("bg", { x: 0, y: 0, width: 1280, height: 720, fill: COLOR.bg });
    pen.rect("ground", { x: 24, y: 250, width: 860, height: 400, rx: 24, fill: ALICE.ground });
  });
  drawQueen(pen, w);
  for (const r of w.rows) drawBush(pen, w, r);
  for (const id of ["B", "C"] as const) drawGardener(pen, w, id);
  drawReceiver(pen, w);
  pen.layer("top", () => {
    if (w.term) pill(pen, "term", w.term, { x: 900, y: 22, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
    if (w.stamp) pill(pen, "stamp", w.stamp, { x: 470, y: 22, fill: COLOR.warn, color: COLOR.bg, attrs: { class: "fx-stamp" } });
  });
}
