import type { Pen } from "../engine/contract";
import "./alice.css";
import { COLOR, FONT } from "./theme";

// Мир «Алисы» (эксперимент 01a, дизайн motion-designer 19.10): Кэрролл и Тенниел, ничего
// диснеевского. Простые формы серии: прямоугольники со скруглением и пути. Персонаж рисует то,
// что ему сказали; эмоцию выбирает эпизод по состоянию кадра.

export const ALICE = {
  paper: "#f1ead8",
  paperEdge: "#c9bfa3",
  skin: "#f3d9b8",
  leaf: "#2f8f6b",
  leafDark: "#236b50",
  ground: "#13253a",
  rose: "#e23a55",
  roseEdge: "#8f1f33",
  wood: "#b58a52",
  woodDark: "#8a6a3f",
  woodInk: "#2b1d0a",
  crown: "#ffd166",
  crownEdge: "#b8892a",
  robe: "#a3263f",
  ink: "#1b2342",
  pale: "#cfd3e6",
} as const;

const MONO = { "font-family": FONT.mono, "font-size": 18 };
const SANS = { "font-family": FONT.sans, "font-size": 18 };
const ROUND = { "stroke-linecap": "round", fill: "none" };

/** Круг через rect: Pen не знает circle. (cx, cy) — центр. */
function dot(pen: Pen, key: string, cx: number, cy: number, r: number, fill: string, extra: Record<string, string | number> = {}): void {
  pen.rect(key, { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, rx: r, fill, ...extra });
}

const SPADE = "M 7 0 Q 16 10 14 14 Q 11 17 7 12 Q 3 17 0 14 Q -2 10 7 0 Z M 7 12 L 4 17 L 10 17 Z";

export type GardenerMood = "idle" | "work" | "talk" | "frozen" | "lost";

/**
 * Садовник-карта (пики): тело 72×92, голова над картой, кисть в правой руке, копия бирки в левой.
 * (x, y) — левый верхний угол тела. `holding` — номер бирки в руке; `stale` — бирка уже не его.
 */
export function gardener(
  pen: Pen, key: string,
  o: { x: number; y: number; num: string; color: string; mood: GardenerMood; holding: string | null; stale?: boolean; doubt?: boolean },
): void {
  const { mood, color } = o;
  const asleep = mood === "frozen";
  pen.group(key, o.x, o.y, () => {
    [16, 46].forEach((lx, i) => pen.rect(`${key}:leg${i}`, { x: lx, y: 90, width: 10, height: 16, rx: 4, fill: ALICE.paperEdge }));
    pen.rect(`${key}:shadow`, { y: 3, width: 72, height: 92, rx: 10, fill: COLOR.shadow });
    pen.rect(`${key}:body`, { width: 72, height: 92, rx: 10, fill: asleep ? ALICE.pale : ALICE.paper, stroke: ALICE.paperEdge, "stroke-width": 2 });
    pen.rect(`${key}:hem`, { y: 80, width: 72, height: 12, rx: 6, fill: color });
    pen.text(`${key}:num`, { x: 8, y: 26, ...SANS, "font-size": 22, "font-weight": 800, fill: ALICE.ink }, o.num);
    pen.group(`${key}:pip`, 10, 32, () => pen.path(`${key}:pip:p`, { d: SPADE, fill: ALICE.ink }));
    pen.group(`${key}:spade`, 26, 46, () => pen.path(`${key}:spade:p`, { d: SPADE, fill: ALICE.ink, opacity: 0.9 }), {}, { scale: 1.5 });
    // Рабочая рука с кистью: поднята — работает; висит — спит или ждёт.
    const up = mood === "work";
    pen.path(`${key}:arm`, { d: up ? "M 70 30 Q 90 24 100 8" : "M 70 30 Q 88 40 94 56", stroke: ALICE.paperEdge, "stroke-width": 6, ...ROUND });
    const [bx, by, tx, ty] = up ? [100, 8, 112, -8] : [94, 56, 98, 76];
    pen.line(`${key}:brush`, { x1: bx, y1: by, x2: tx, y2: ty, stroke: ALICE.wood, "stroke-width": 4, "stroke-linecap": "round" });
    pen.rect(`${key}:bristle`, { x: tx - 6, y: up ? ty - 8 : ty, width: 12, height: 8, rx: 3, fill: color });
    if (asleep) dot(pen, `${key}:drip`, tx, ty + 14, 4, color, { class: "fx-pop" });
    // Левая рука и копия бирки: номер, без срока — срок знают куст и Королева.
    pen.path(`${key}:arm2`, { d: "M 2 30 Q -14 36 -22 22", stroke: ALICE.paperEdge, "stroke-width": 6, ...ROUND });
    if (o.holding && !asleep) {
      pen.group(`${key}:copy:${o.holding}`, -84, 8, () => {
        pen.rect(`${key}:copy:bg`, { width: 64, height: 30, rx: 6, fill: ALICE.wood, stroke: ALICE.woodDark, "stroke-width": 2 });
        pen.text(`${key}:copy:t`, { x: 32, y: 21, ...MONO, "font-weight": 700, fill: ALICE.woodInk, "text-anchor": "middle" }, o.holding!);
        if (o.stale) pen.line(`${key}:copy:x`, { x1: 4, y1: 26, x2: 60, y2: 4, stroke: COLOR.error, "stroke-width": 3, "stroke-linecap": "round", pathLength: 1, class: "fx-draw" });
      }, { class: "fx-pop" });
    }
    // Голова: спит — склонена набок.
    pen.group(`${key}:head`, 16, -30, () => {
      pen.rect(`${key}:face`, { width: 40, height: 34, rx: 17, fill: ALICE.skin });
      [8, 24].forEach((ex, i) => {
        if (asleep) pen.path(`${key}:eye${i}`, { d: `M ${ex} 13 Q ${ex + 4} 17 ${ex + 8} 13`, stroke: ALICE.ink, "stroke-width": 2.5, ...ROUND });
        else pen.rect(`${key}:eye${i}`, { x: ex, y: mood === "work" ? 10 : 12, width: 8, height: 10, rx: 4, fill: ALICE.ink });
      });
      if (mood === "lost") [[6, 7, 17, 4], [34, 7, 23, 4]].forEach(([x1, y1, x2, y2], i) =>
        pen.line(`${key}:brow${i}`, { x1, y1, x2, y2, stroke: ALICE.ink, "stroke-width": 2.5, "stroke-linecap": "round" }));
      const m = `${key}:mouth`;
      if (mood === "talk") pen.rect(m, { x: 15, y: 24, width: 10, height: 7, rx: 3.5, fill: ALICE.ink });
      else if (mood === "work") pen.path(m, { d: "M 13 25 Q 20 31 27 25", stroke: ALICE.ink, "stroke-width": 2.5, ...ROUND });
      else if (mood === "lost") pen.path(m, { d: "M 13 29 Q 20 23 27 29", stroke: ALICE.ink, "stroke-width": 2.5, ...ROUND });
      else if (asleep) dot(pen, m, 20, 27, 2.5, COLOR.muted);
      else pen.line(m, { x1: 15, y1: 27, x2: 25, y2: 27, stroke: ALICE.ink, "stroke-width": 2.5, "stroke-linecap": "round" });
    }, {}, asleep ? { rotate: 12, origin: [20, 34] } : {});
    if (asleep) {
      pen.text(`${key}:z1`, { x: 58, y: -36, ...SANS, "font-weight": 700, fill: COLOR.muted, class: "fx-pop" }, "z");
      pen.text(`${key}:z2`, { x: 72, y: -54, ...SANS, "font-size": 22, "font-weight": 700, fill: COLOR.muted, class: "fx-pop" }, "z");
    }
    if (mood === "lost") dot(pen, `${key}:sweat`, 62, -22, 4, COLOR.mail, { class: "fx-pop" });
    if (o.doubt) pen.text(`${key}:q`, { x: 84, y: -12, ...SANS, "font-size": 26, "font-weight": 700, fill: COLOR.warn }, "?");
  });
}

export type QueenMood = "calm" | "bored" | "check" | "refuse" | "talk";

/** Червонная Королева с часами — единственными в саду. (x, y) — угол; секундная стрелка — от `seconds`. */
export function queen(pen: Pen, key: string, o: { x: number; y: number; mood: QueenMood; time: string; seconds: number; fx?: string }): void {
  const { mood } = o;
  pen.group(key, o.x, o.y, () => {
    pen.path(`${key}:robe:sh`, { d: "M 14 65 L 86 65 L 100 149 L 0 149 Z", fill: COLOR.shadow });
    pen.path(`${key}:robe`, { d: "M 14 62 L 86 62 L 100 146 L 0 146 Z", fill: ALICE.robe });
    pen.rect(`${key}:collar`, { x: 22, y: 56, width: 56, height: 12, rx: 6, fill: ALICE.paper });
    pen.group(`${key}:heart`, 36, 94, () =>
      pen.path(`${key}:heart:p`, { d: "M 14 26 L 2 12 Q -4 0 6 -2 Q 14 -2 14 6 Q 14 -2 22 -2 Q 32 0 26 12 Z", fill: ALICE.paper }));
    pen.group(`${key}:head`, 0, 0, () => {
      pen.rect(`${key}:face`, { x: 26, y: 18, width: 48, height: 44, rx: 22, fill: ALICE.skin });
      pen.path(`${key}:crown`, { d: "M 24 20 L 24 0 L 38 10 L 50 -4 L 62 10 L 76 0 L 76 20 Z", fill: ALICE.crown, stroke: ALICE.crownEdge, "stroke-width": 2 });
      [[24, 0], [50, -4], [76, 0]].forEach(([cx, cy], i) => dot(pen, `${key}:gem${i}`, cx, cy, 3, ALICE.rose));
      // Сверяет — глаза к часам (вправо-вниз); скучает — веки опущены.
      const look = mood === "check" ? 2 : 0;
      [38, 54].forEach((ex, i) => {
        pen.rect(`${key}:eye${i}`, { x: ex + look, y: 33 + look / 2, width: 8, height: 9, rx: 4, fill: ALICE.ink });
        if (mood === "bored") pen.rect(`${key}:lid${i}`, { x: ex - 1, y: 31, width: 10, height: 6, rx: 3, fill: ALICE.skin });
      });
      const low = mood === "refuse" ? 3 : 0;
      pen.line(`${key}:brow0`, { x1: 34, y1: 28 + low, x2: 46, y2: 32 + low, stroke: ALICE.ink, "stroke-width": 3, "stroke-linecap": "round" });
      pen.line(`${key}:brow1`, { x1: 66, y1: 28 + low, x2: 54, y2: 32 + low, stroke: ALICE.ink, "stroke-width": 3, "stroke-linecap": "round" });
      const m = `${key}:mouth`;
      if (mood === "talk") pen.rect(m, { x: 45, y: 49, width: 10, height: 8, rx: 4, fill: ALICE.ink });
      else if (mood === "refuse") pen.path(m, { d: "M 40 56 Q 50 47 60 56", stroke: ALICE.ink, "stroke-width": 3, ...ROUND });
      else pen.line(m, { x1: 44, y1: 53, x2: 56, y2: 53, stroke: ALICE.ink, "stroke-width": 3, "stroke-linecap": "round" });
    }, o.fx === "fx-shake" ? { class: "fx-shake" } : {});
    pen.path(`${key}:arm`, { d: "M 92 80 Q 116 76 130 66", stroke: ALICE.skin, "stroke-width": 7, ...ROUND });
    // Часы: циферблат, метки, секундная стрелка — ходит от w.clock (переезд группы анимируется).
    pen.group(`${key}:clock`, 128, 28, () => {
      pen.rect(`${key}:clock:bg`, { width: 84, height: 84, rx: 42, fill: ALICE.paper, stroke: ALICE.crown, "stroke-width": 4 });
      [[42, 6, 42, 14], [78, 42, 70, 42], [42, 78, 42, 70], [6, 42, 14, 42]].forEach(([x1, y1, x2, y2], i) =>
        pen.line(`${key}:clock:m${i}`, { x1, y1, x2, y2, stroke: ALICE.ink, "stroke-width": 3, "stroke-linecap": "round" }));
      pen.group(`${key}:clock:hand`, 42, 42, () =>
        pen.line(`${key}:clock:hand:l`, { x1: 0, y1: 4, x2: 0, y2: -32, stroke: COLOR.error, "stroke-width": 3, "stroke-linecap": "round" }),
      {}, { rotate: o.seconds * 6 });
      dot(pen, `${key}:clock:pin`, 42, 42, 4, ALICE.ink);
    }, mood === "check" ? { class: "fx-pulse" } : {});
    pen.text(`${key}:time`, { x: 170, y: 140, "font-family": FONT.mono, "font-size": 24, "font-weight": 700, fill: COLOR.ink, "text-anchor": "middle" }, o.time);
  }, o.fx && o.fx !== "fx-shake" ? { class: o.fx } : {});
}

export type DuchessMood = "calm" | "accept" | "already";

/** Герцогиня за оградой: тяжёлая голова в чепце, корзина слева, книга справа. (x, y) — угол. */
export function duchess(pen: Pen, key: string, o: { x: number; y: number; mood: DuchessMood }): void {
  pen.group(key, o.x, o.y, () => {
    pen.path(`${key}:dress`, { d: "M 40 90 L 120 90 L 150 220 L 10 220 Z", fill: COLOR.mail });
    pen.rect(`${key}:face`, { x: 36, y: 10, width: 88, height: 74, rx: 30, fill: ALICE.skin });
    pen.rect(`${key}:chin`, { x: 52, y: 62, width: 56, height: 30, rx: 14, fill: ALICE.skin });
    pen.path(`${key}:cap`, { d: "M 28 40 Q 80 -26 132 40 L 132 52 L 28 52 Z", fill: ALICE.paper });
    pen.rect(`${key}:ribbon`, { x: 28, y: 46, width: 104, height: 8, fill: ALICE.crown });
    // Тяжёлые веки; «уже получала» — глаза в книгу (вправо-вниз), одна бровь выше.
    const look = o.mood === "already" ? 3 : 0;
    [58, 88].forEach((ex, i) => {
      pen.rect(`${key}:eye${i}`, { x: ex + look, y: 58 + look / 2, width: 12, height: 12, rx: 6, fill: ALICE.ink });
      pen.rect(`${key}:lid${i}`, { x: ex - 2, y: 56, width: 16, height: 5, rx: 2.5, fill: ALICE.skin });
    });
    if (o.mood === "already") pen.line(`${key}:brow`, { x1: 86, y1: 57, x2: 100, y2: 54, stroke: ALICE.ink, "stroke-width": 3, "stroke-linecap": "round" });
    if (o.mood === "accept") dot(pen, `${key}:mouth`, 80, 82, 4, ALICE.ink);
    else pen.line(`${key}:mouth`, { x1: o.mood === "already" ? 68 : 62, y1: 82, x2: o.mood === "already" ? 96 : 98, y2: o.mood === "already" ? 80 : 82, stroke: ALICE.ink, "stroke-width": 3, "stroke-linecap": "round" });
  });
}

/** Корзина Герцогини; (x, y) — угол тела корзины. `jolt` — приняла розу. */
export function basket(pen: Pen, key: string, o: { x: number; y: number; jolt: boolean }): void {
  pen.group(key, o.x, o.y, () => {
    pen.path(`${key}:handle`, { d: "M 6 0 Q 55 -56 104 0", stroke: ALICE.woodDark, "stroke-width": 5, ...ROUND });
    pen.rect(`${key}:body`, { width: 110, height: 58, rx: 12, fill: ALICE.wood, stroke: ALICE.woodDark, "stroke-width": 2 });
    [15, 28, 41].forEach((y, i) => pen.line(`${key}:weave${i}`, { x1: 8, y1: y, x2: 102, y2: y, stroke: ALICE.woodDark, "stroke-width": 2 }));
  }, o.jolt ? { class: "fx-jolt" } : {});
}

/** Книга Герцогини: номера принятых роз (ключи идемпотентности). `hit` — номер, который сейчас нашла. */
export function book(pen: Pen, key: string, o: { x: number; y: number; entries: string[]; hit: string | null }): void {
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:bg`, { width: 110, height: 70, rx: 6, fill: COLOR.surface2, stroke: COLOR.warn, "stroke-width": 2 });
    pen.line(`${key}:spine`, { x1: 55, y1: 4, x2: 55, y2: 66, stroke: COLOR.warn, "stroke-width": 1.5 });
    o.entries.forEach((e, i) =>
      pen.text(`${key}:e${i}`, { x: 12, y: 30 + i * 24, ...MONO, "font-weight": 700, fill: COLOR.ink, class: e === o.hit ? "fx-pulse" : "fx-pop" }, e));
  });
}

export type BushStatus = "new" | "in_progress" | "done";

/** Куст: цвет роз = статус строки. (cx, y) — центр по x и верх кроны. */
export function bush(pen: Pen, key: string, o: { cx: number; y: number; status: BushStatus; scale?: number }): void {
  const s = o.scale ?? 1;
  pen.group(key, o.cx, o.y, () => {
    pen.rect(`${key}:trunk`, { x: -8, y: 72, width: 16, height: 30, rx: 4, fill: ALICE.woodDark });
    const crowns: [number, number, number, number][] = [[-55, 0, 110, 72], [-65, 22, 70, 58], [-5, 22, 70, 58]];
    crowns.forEach(([x, y, w, h], i) => {
      pen.rect(`${key}:sh${i}`, { x, y: y + 4, width: w, height: h, rx: h / 2, fill: ALICE.leafDark });
      pen.rect(`${key}:c${i}`, { x, y, width: w, height: h, rx: h / 2, fill: ALICE.leaf });
    });
    const red = o.status === "done" ? 5 : o.status === "in_progress" ? 2 : 0;
    [[-34, 14], [20, 8], [-6, 40], [36, 38], [-38, 54]].forEach(([x, y], i) =>
      dot(pen, `${key}:r${i}`, x, y, 9, i < red ? ALICE.rose : COLOR.ink, { stroke: i < red ? ALICE.roseEdge : ALICE.paperEdge, "stroke-width": 1.5 }));
  }, {}, s === 1 ? {} : { scale: s });
}

/** Бирка на кусте: номер захвата и срок. Нет номера — болванка. late — срок прошёл; clash — отметка не прошла. */
export function tag(
  pen: Pen, key: string,
  o: { x: number; y: number; number: string | null; until: string | null; late: boolean; clash: boolean; fx?: string },
): void {
  pen.group(key, o.x, o.y, () => {
    pen.line(`${key}:rope`, { x1: 70, y1: 0, x2: 70, y2: -14, stroke: ALICE.woodDark, "stroke-width": 3 });
    if (!o.number) {
      pen.rect(`${key}:bg`, { width: 140, height: 64, rx: 8, fill: "none", stroke: ALICE.wood, "stroke-width": 2.5, "stroke-dasharray": "6 5" });
      pen.text(`${key}:t`, { x: 70, y: 40, ...MONO, fill: ALICE.wood, "text-anchor": "middle" }, "—");
      return;
    }
    pen.rect(`${key}:sh`, { y: 3, width: 140, height: 64, rx: 8, fill: COLOR.shadow });
    pen.rect(`${key}:bg`, { width: 140, height: 64, rx: 8, fill: ALICE.wood, stroke: o.clash ? COLOR.error : o.late ? COLOR.error : ALICE.woodDark, "stroke-width": o.clash ? 4 : o.late ? 3 : 2.5 });
    dot(pen, `${key}:hole`, 70, 10, 3, ALICE.woodDark);
    pen.text(`${key}:n`, { x: 12, y: 32, ...MONO, "font-weight": 700, fill: ALICE.woodInk }, `№ ${o.number}`);
    pen.text(`${key}:u`, { x: 12, y: 56, ...MONO, fill: o.late ? "#a3132b" : ALICE.woodInk, "font-weight": o.late ? 700 : 400, ...(o.late ? { class: "fx-pulse" } : {}) }, `до ${o.until}`);
  }, o.fx ? { class: o.fx } : {});
}

/** Роза: круг, стебель, лист; keyed — флажок с номером куста (ключ идемпотентности). */
export function rose(pen: Pen, key: string, o: { x: number; y: number; keyed: string | null; fx?: string; dup?: boolean; dim?: boolean }): void {
  pen.group(key, o.x, o.y, () => {
    pen.line(`${key}:stem`, { x1: 0, y1: 11, x2: -4, y2: 30, stroke: ALICE.leaf, "stroke-width": 3, "stroke-linecap": "round" });
    pen.rect(`${key}:leaf`, { x: -12, y: 18, width: 10, height: 6, rx: 3, fill: ALICE.leaf });
    if (o.dup) dot(pen, `${key}:ring`, 0, 0, 15, "none", { stroke: COLOR.error, "stroke-width": 2.5 });
    dot(pen, `${key}:bloom`, 0, 0, 11, ALICE.rose, { stroke: ALICE.roseEdge, "stroke-width": 2 });
    if (o.keyed) {
      pen.rect(`${key}:flag`, { x: 4, y: 16, width: 44, height: 26, rx: 5, fill: ALICE.paper, stroke: ALICE.paperEdge, "stroke-width": 1.5 });
      pen.text(`${key}:flag:t`, { x: 26, y: 35, ...MONO, "font-weight": 700, fill: ALICE.ink, "text-anchor": "middle" }, o.keyed);
    }
  }, { ...(o.fx ? { class: o.fx } : {}), ...(o.dim ? { opacity: 0.45 } : {}) });
}

/** Ограда сада: штакетник от x0 вниз, шаг 22. */
export function fence(pen: Pen, key: string, o: { x: number; y: number; n: number }): void {
  for (let i = 0; i < o.n; i++) pen.rect(`${key}:p${i}`, { x: o.x, y: o.y + i * 28, width: 14, height: 22, rx: 4, fill: ALICE.wood, opacity: 0.8 });
}
