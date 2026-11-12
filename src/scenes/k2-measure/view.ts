import { STAGE, type Attrs, type Pen } from "../../engine/contract";
import { lock } from "../../kit/props";
import { ACTOR, COLOR, FONT, SIZE } from "../../kit/theme";
import { lamp, panel, pill } from "../../kit/widgets";
import { CLASSES, STATIONS, TIPS, ci, type Editable, type Focus, type Link, type Picture, type World } from "./sim";
import "./motion.css";

// Отрисовка наброска — серые фигуры фазы 0, без полировки. Раскладка:
//   сверху — площадка (пунктирная рамка), в ней нагрузка → виртуалка (сервис + база) → графики и алерт;
//   ниже — набор починок (стрелка в сервис), проверка (стрелка от виртуалки) → вердикт и CI;
//   под площадкой — строка причин (чипы); справа столбец — круг задачи (глава «нагрузка не та»);
//   внизу на всю ширину площадки — картинка примера или строка правила.

const sans = (size: number, weight = 600) => ({ "font-family": FONT.sans, "font-size": size, "font-weight": weight });
const mono = (size: number) => ({ "font-family": FONT.mono, "font-size": size });

const BOX = {
  site: { x: 16, y: 14, w: 1068, h: 404 },
  load: { x: 40, y: 56, w: 150, h: 170 },
  vm: { x: 210, y: 56, w: 320, h: 170 },
  graphs: { x: 570, y: 56, w: 494, h: 170 },
  deck: { x: 40, y: 250, w: 490, h: 150 },
  check: { x: 570, y: 250, w: 240, h: 150 },
  verdict: { x: 840, y: 250, w: 224, h: 150 },
} as const;
const SERVICE = { x: 230, y: 104, w: 140, h: 104 };
/** Картинка примера — на всю ширину площадки: без мёртвой зоны слева. */
const PIC = { x: 16, y: 470, w: 1068, h: 176 };
/** Где у звена знак подозреваемого (правый верхний угол звена; у площадки — у вкладки). */
const SUSPECT: Partial<Record<Link, { x: number; y: number }>> = {
  site: { x: BOX.site.x + 528, y: BOX.site.y + 4 },
  load: { x: BOX.load.x + BOX.load.w - 14, y: BOX.load.y - 22 },
  check: { x: BOX.check.x + BOX.check.w - 14, y: BOX.check.y - 22 },
};
/** Затемнение незатронутого — сильнее общего `DIM` серии (learning-designer, motion-designer); навигация (полка причин,
 * круг задачи) — слабее: зритель сверяется с ней, она должна читаться. */
const DIM_KK = 0.32;
const DIM_NAV = 0.55;
/** Прорисовка линии: `fx-draw` без `pathLength` оставляет линию штрихом в 1 px. */
const DRAW = { pathLength: 1, class: "fx-draw" };

function lit(w: World, ...what: Focus[]): Attrs {
  if (!w.focus || what.some((f) => w.focus!.includes(f))) return {};
  return { opacity: what.every((f) => f === "shelf" || f === "loop") ? DIM_NAV : DIM_KK };
}

const arrow = (pen: Pen, key: string, x1: number, y1: number, x2: number, y2: number, attrs: Attrs = {}) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = (s: number) => `${x2 - 10 * Math.cos(a + s)} ${y2 - 10 * Math.sin(a + s)}`;
  pen.path(key, { d: `M ${x1} ${y1} L ${x2} ${y2} M ${h(0.5)} L ${x2} ${y2} L ${h(-0.5)}`, fill: "none", stroke: COLOR.muted, "stroke-width": 3, ...attrs });
};

export function render(pen: Pen, w: World): void {
  pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg });
  if (w.on.site) site(pen, w);
  if (w.on.load) load(pen, w);
  if (w.on.vm) vm(pen, w);
  if (w.on.graphs) graphs(pen, w);
  if (w.on.deck) deck(pen, w);
  if (w.on.check) check(pen, w);
  if (w.on.verdict) verdict(pen, w);
  if (w.shelf.on) shelf(pen, w);
  if (w.loop.on) loop(pen, w);
  if (w.pic) picture(pen, w, w.pic);
  else if (w.rule) rule(pen, w, w.rule);
  if (w.tally) measure(pen);
  w.suspects.forEach((link, i) => suspect(pen, w, link, i + 1));
  pen.layer("top", () => {
    if (w.plate) chapterHead(pen, w);
    if (w.tips) tips(pen, w);
    if (w.moral) moral(pen, w);
    if (w.title) titleCard(pen, w);
  });
}

/** Подпись звена и отметки правок (оранжевые точки копятся; в итоге — число). */
function head(pen: Pen, key: string, text: string, w: World, edit: Editable | null, inline = false): void {
  pen.text(`${key}:h`, { x: 16, y: 28, fill: COLOR.muted, ...sans(SIZE.min, 500) }, text);
  if (!edit) return;
  const n = w.edits[edit];
  if (w.tally) {
    pill(pen, `${key}:tally`, `правок: ${n}`, { x: inline ? 26 + pen.measure(text, sans(SIZE.min, 500)).width : 14, y: inline ? 6 : 40, size: SIZE.min, fill: n ? COLOR.draftBg : COLOR.surface2, color: n ? COLOR.warn : COLOR.muted, attrs: { class: "fx-pop" } });
    return;
  }
  const x0 = 16 + pen.measure(text, sans(SIZE.min, 500)).width + 10;
  for (let i = 0; i < n; i++)
    pen.rect(`${key}:pip${i}`, { x: x0 + i * 18, y: 15, width: 14, height: 14, rx: 7, fill: COLOR.warn, ...(i === n - 1 ? { class: "fx-pop" } : {}) });
  // Первая правка эпизода подписана: зритель связывает точки с «правок: N» в итоге.
  const total = Object.values(w.edits).reduce((a, b) => a + b, 0);
  if (n && total === 1 && w.events.some((e) => e.kind === "edit"))
    pill(pen, `${key}:first`, "правка", { x: x0 + n * 18 + 4, y: 6, size: SIZE.min, fill: COLOR.draftBg, color: COLOR.warn, attrs: { class: "fx-pop" } });
}

function site(pen: Pen, w: World): void {
  const b = BOX.site;
  pen.group("site", b.x, b.y, () => {
    pen.rect("site:r", { x: 0, y: 0, width: b.w, height: b.h, rx: 18, fill: "none", stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "10 8" });
    pen.rect("site:tab", { x: 560, y: -2, width: 500, height: 40, rx: 10, fill: COLOR.bg });
    pen.group("site:hd", 560, 0, () => head(pen, "site", `площадка: ${w.site}`, w, "site", true));
  }, lit(w, "site"));
}

function load(pen: Pen, w: World): void {
  const b = BOX.load;
  pen.group("load", b.x, b.y, () => {
    panel(pen, "load:p", { x: 0, y: 0, w: b.w, h: b.h, fill: COLOR.bg2 });
    head(pen, "load", "нагрузка", w, "load");
    // Запросы — точки на шкале времени: ровно или залпами.
    const xs = w.load === "steady" ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 16 + i * 16) : [16, 22, 28, 34, 40, 96, 102, 108, 114, 120];
    for (const row of [0, 1, 2])
      xs.forEach((x, i) => pen.rect(`load:d${row}:${i}`, { x: x + (w.load === "steady" ? (row % 2) * 8 : 0), y: 76 + row * 26, width: 8, height: 8, rx: 4, fill: COLOR.ink }));
    pen.text(`load:mode:${w.load}`, { x: 16, y: 156, fill: w.load === "steady" ? COLOR.muted : COLOR.warn, class: "fx-pop", ...sans(SIZE.min, 600) }, w.load === "steady" ? "ровно" : "залпами");
  }, lit(w, "load"));
  arrow(pen, "load:a", b.x + b.w + 2, 141, BOX.vm.x - 4, 141, lit(w, "load", "vm"));
}

function vm(pen: Pen, w: World): void {
  const b = BOX.vm;
  pen.group("vm", b.x, b.y, () => {
    panel(pen, "vm:p", { x: 0, y: 0, w: b.w, h: b.h, fill: COLOR.bg2 });
    head(pen, "vm", "виртуалка", w, null);
  }, lit(w, "vm"));
  const s = SERVICE;
  pen.group("svc", s.x, s.y, () => {
    panel(pen, "svc:p", { x: 0, y: 0, w: s.w, h: s.h, fill: COLOR.surface, shadow: false });
    pen.text("svc:t", { x: s.w / 2, y: 36, "text-anchor": "middle", fill: COLOR.ink, ...sans(SIZE.body, 700) }, "сервис");
    if (w.card) {
      const c = w.card.right ? COLOR.ok : COLOR.error;
      pen.rect(`svc:patch:${w.card.name}`, { x: 24, y: 52, width: s.w - 48, height: 36, rx: 6, fill: w.card.right ? COLOR.doneBg : COLOR.alarmBg, stroke: c, "stroke-width": 2, class: "fx-pop" });
      pen.text("svc:patch:t", { x: s.w / 2, y: 77, "text-anchor": "middle", fill: c, ...sans(SIZE.min, 700) }, "починка");
    } else if (w.fault) {
      pen.path("svc:crack", { d: "M 50 50 L 66 66 L 58 72 L 76 92", fill: "none", stroke: COLOR.error, "stroke-width": 4 });
      pen.text("svc:crack:t", { x: 84, y: 82, fill: COLOR.error, ...sans(SIZE.min, 700) }, "поломка");
    }
  }, lit(w, "vm", "deck"));
  // База — цилиндр.
  pen.group("db", 400, 104, () => {
    pen.path("db:body", { d: "M 0 14 L 0 90 A 55 14 0 0 0 110 90 L 110 14", fill: COLOR.surface, stroke: COLOR.postgres, "stroke-width": 2 });
    pen.path("db:top", { d: "M 0 14 A 55 14 0 0 1 110 14 A 55 14 0 0 1 0 14", fill: COLOR.surface2, stroke: COLOR.postgres, "stroke-width": 2 });
    pen.text("db:t", { x: 55, y: 66, "text-anchor": "middle", fill: COLOR.ink, ...sans(SIZE.body, 700) }, "база");
  }, lit(w, "vm"));
}

function graphs(pen: Pen, w: World): void {
  const b = BOX.graphs;
  arrow(pen, "graphs:a", BOX.vm.x + BOX.vm.w + 2, 120, b.x - 4, 120, lit(w, "graphs"));
  pen.group("graphs", b.x, b.y, () => {
    panel(pen, "graphs:p", { x: 0, y: 0, w: b.w, h: b.h, fill: COLOR.bg2 });
    head(pen, "graphs", "графики", w, null);
    ["ошибки", "время", "очередь"].forEach((name, i) => {
      // У «очереди» запас высоты сверху: хвост рисуется высоко, не задевая «время».
      const y = [64, 94, 142][i];
      pen.text(`graphs:n${i}`, { x: 16, y: y + 6, fill: COLOR.muted, ...sans(SIZE.min, 500) }, name);
      const bad = (w.alert && !w.backlog && i < 2) || (w.slow && i === 1);
      const d = bad ? `M 110 ${y} L 210 ${y} L 235 ${y - 16} L 270 ${y - 4} L 295 ${y - 18} L 350 ${y - 16}` : `M 110 ${y} L 350 ${y}`;
      if (i === 2 && w.backlog) {
        // Копится — круто вверх до края; хвост — высоко и сползает медленно.
        const end = w.backlog === "grow" ? y - 36 : y - 24;
        const tail = w.backlog === "grow" ? `M 110 ${y} L 180 ${y} L 350 ${end}` : `M 110 ${y - 36} L 350 ${end}`;
        pen.path(`graphs:l2:${w.backlog}`, { d: tail, fill: "none", stroke: w.backlog === "grow" ? COLOR.error : COLOR.warn, "stroke-width": 3, ...DRAW });
        pen.text("graphs:l2:t", { x: 362, y: end + 6, fill: COLOR.warn, ...sans(SIZE.min, 700) }, "хвост 30 тыс.");
        return;
      }
      pen.path(`graphs:l${i}:${bad}`, { d, fill: "none", stroke: bad ? COLOR.error : COLOR.ok, "stroke-width": 3, ...DRAW });
    });
    if (w.alert) pill(pen, "graphs:alert", "алерт", { x: 150, y: 10, size: SIZE.min, fill: COLOR.alarmBg, color: COLOR.error, attrs: { class: "fx-pop" } });
  }, lit(w, "graphs"));
}

function deck(pen: Pen, w: World): void {
  const b = BOX.deck;
  pen.group("deck", b.x, b.y, () => {
    panel(pen, "deck:p", { x: 0, y: 0, w: b.w, h: b.h, fill: COLOR.bg2 });
    head(pen, "deck", "набор починок: верные и ложные", w, null);
    // Карты: верные — зелёный край, ложные — красный. Примеренная поднята.
    const cards = [true, false, false, true, false, false].map((right, i) => ({ right, i, up: !!w.card && w.card.right === right && i === (right ? 0 : 1) }));
    // Поднятая — последней, чтобы соседи её не закрывали.
    [...cards.filter((c) => !c.up), ...cards.filter((c) => c.up)].forEach(({ right, i, up }) =>
      pen.rect(`deck:c${i}`, { x: 16 + i * 30, y: up ? 46 : 58, width: 52, height: 76, rx: 6, fill: COLOR.surface, stroke: right ? COLOR.ok : COLOR.error, "stroke-width": up ? 4 : 2 }));
    if (w.card) {
      const c = w.card.right ? COLOR.ok : COLOR.error;
      pen.text(`deck:kind:${w.frame}`, { x: 240, y: 72, fill: c, class: "fx-pop", ...sans(SIZE.body, 700) }, w.card.right ? "верная" : "ложная");
      pen.text("deck:name", { x: 240, y: 100, fill: COLOR.ink, ...mono(SIZE.min) }, w.card.name);
      if (w.tally && w.card.right) pill(pen, "deck:tally", "правок: 0", { x: 236, y: 104, size: SIZE.accent, fill: COLOR.surface2, color: COLOR.muted, attrs: { class: "fx-pop" } });
    }
  }, lit(w, "deck"));
  if (w.card) arrow(pen, "deck:a", 300, BOX.deck.y - 4, 300, SERVICE.y + SERVICE.h + 6, lit(w, "deck", "vm"));
}

function check(pen: Pen, w: World): void {
  const b = BOX.check;
  arrow(pen, "check:a", BOX.vm.x + BOX.vm.w + 2, 200, b.x - 4, b.y + 40, lit(w, "check"));
  pen.group("check", b.x, b.y, () => {
    panel(pen, "check:p", { x: 0, y: 0, w: b.w, h: b.h, fill: COLOR.bg2 });
    head(pen, "check", "проверка", w, "check");
    if (!w.tally) pen.text(`check:t:${w.check}`, { x: 16, y: 74, fill: COLOR.ink, class: "fx-pop", ...sans(SIZE.body, 600) }, w.check);
  }, lit(w, "check"));
  arrow(pen, "verdict:a", b.x + b.w + 2, b.y + 75, BOX.verdict.x - 4, b.y + 75, lit(w, "check", "verdict"));
}

function verdict(pen: Pen, w: World): void {
  const b = BOX.verdict;
  const v = w.verdict;
  pen.group("verdict", b.x, b.y, () => {
    panel(pen, "verdict:p", { x: 0, y: 0, w: b.w, h: b.h, fill: COLOR.bg2 });
    head(pen, "verdict", "вердикт", w, null);
    lamp(pen, `verdict:lamp:${w.frame}:${v.lamp}`, 40, 62, v.lamp, 20);
    if (v.lamp) pen.text("verdict:t", { x: 72, y: 69, fill: v.lamp === "red" ? COLOR.error : COLOR.ok, ...sans(SIZE.body, 700) }, v.lamp === "red" ? "красное" : "зелёное");
    if (v.expect) pen.text("verdict:x", { x: 16, y: 106, fill: COLOR.ink, ...sans(SIZE.body, 600) }, `ждали: ${v.expect === "red" ? "красное" : "зелёное"}`);
    const c = ci(w);
    if (c) pill(pen, `verdict:ci:${w.frame}`, `CI ${c === "green" ? "зелёный" : "красный"}`, {
      x: 14, y: 116, size: SIZE.min, fill: c === "green" ? COLOR.doneBg : COLOR.alarmBg, color: c === "green" ? COLOR.ok : COLOR.error, attrs: { class: "fx-pop" },
    });
  }, lit(w, "verdict"));
}

/** Строка четырёх причин под площадкой: встреченные — чипы, остальные — бледные чипы впереди (дорога эпизода). */
function shelf(pen: Pen, w: World): void {
  let x = 16;
  CLASSES.forEach((name, i) => {
    const met = w.shelf.met.includes(i as never);
    const active = w.shelf.active === i;
    if (!met) {
      x += pill(pen, `shelf:${i}:ahead`, `${i + 1}. ${name}`, { x, y: 427, size: SIZE.min, fill: COLOR.bg, color: COLOR.faint, stroke: COLOR.faint, attrs: lit(w, "shelf") }) + 12;
      return;
    }
    x += pill(pen, `shelf:${i}:${active}`, `${i + 1}. ${name}`, {
      x, y: 427, size: SIZE.min, fill: active ? COLOR.surface2 : COLOR.bg, color: active ? COLOR.warn : COLOR.ink, stroke: active ? COLOR.warn : COLOR.line,
      attrs: { ...(active ? { class: "fx-pop" } : {}), ...lit(w, "shelf") },
    }) + 12;
  });
}

/** Круг задачи — столбец справа: «круг N», под ним станции сверху вниз; текущая подсвечена. */
function loop(pen: Pen, w: World): void {
  pen.group("loop", 1096, 20, () => {
    if (w.loop.lap) pen.text(`loop:lap:${w.loop.lap}`, { x: 0, y: 24, fill: COLOR.ink, class: "fx-pop", ...sans(SIZE.body, 700) }, `круг ${w.loop.lap}`);
    STATIONS.forEach((name, i) => {
      const y = 44 + i * 76;
      const here = w.loop.at === i;
      const color = here ? (i === 0 ? COLOR.error : COLOR.warn) : COLOR.faint;
      pill(pen, `loop:s${i}:${here}`, name, { x: 0, y, size: SIZE.min, fill: here ? COLOR.surface2 : COLOR.bg, color: here ? color : COLOR.muted, stroke: color, attrs: here ? { class: "fx-pop" } : {} });
      if (i < STATIONS.length - 1) arrow(pen, `loop:a${i}`, 20, y + 38, 20, y + 70, { "stroke-width": 2 });
    });
    // «снова» возвращает к началу круга.
    pen.path("loop:back", { d: `M 150 ${44 + 3 * 76 + 16} L 164 ${44 + 3 * 76 + 16} L 164 60 L 150 60`, fill: "none", stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "5 4" });
  }, lit(w, "loop"));
}

/** Картинка примера: то, что увидели на стенде. Координаты образов — от середины панели (`ox`). */
function picture(pen: Pen, w: World, p: Picture): void {
  const { w: W, h: H } = PIC;
  const ox = (W - 840) / 2;
  const dot = (key: string, cx: number, cy: number, r: number, attrs: Attrs) =>
    pen.rect(key, { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, rx: r, ...attrs });
  pen.group(`pic:${w.frame}`, PIC.x, PIC.y, () => {
    panel(pen, "pic:p", { x: 0, y: 0, w: W, h: H, fill: COLOR.bg2 });
    pen.text("pic:h", { x: 20, y: 30, fill: COLOR.muted, ...sans(SIZE.body, 500) }, p.title);
    if (p.kind === "chart") {
      const x0 = 30;
      const y0 = 50;
      const cw = W - 60;
      const ch = H - 70;
      const step = cw / Math.max(p.points.length - 1, 1);
      const y = (v: number) => y0 + ch - v * ch;
      pen.rect("pic:axis", { x: x0, y: y0 + ch, width: cw, height: 2, fill: COLOR.line });
      const d = p.points.map((v, i) => `${i ? "L" : "M"} ${x0 + i * step} ${y(v)}`).join(" ");
      pen.path("pic:line", { d, fill: "none", stroke: p.bad ? COLOR.error : COLOR.ok, "stroke-width": 3, ...DRAW });
      if (p.mark) {
        const mx = x0 + p.mark.at * step;
        pen.line("pic:mark", { x1: mx, y1: y0, x2: mx, y2: y0 + ch, stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "4 4" });
        pen.text("pic:markt", { x: mx + 10, y: y0 + 24, fill: COLOR.warn, ...sans(SIZE.body, 700) }, p.mark.label);
      }
    } else if (p.kind === "bars") {
      // Подписи 20…280, виртуалки 300…412, столбики с 440.
      p.bars.forEach((b, i) => {
        const by = 50 + i * 56;
        pen.text(`pic:b${i}:l`, { x: 20, y: by + 28, fill: COLOR.ink, ...sans(SIZE.body, 600) }, b.label);
        for (let k = 0; k < (b.vms ?? 0); k++) vmGlyph(pen, `pic:b${i}:vm${k}`, 300 + k * 36, by + 7, b.bad ? COLOR.error : COLOR.ok, k ? `fx-pop fx-l${k}` : "fx-pop");
        pen.rect(`pic:b${i}:bar`, { x: 440, y: by + 8, width: Math.max(8, 480 * b.value), height: 30, rx: 6, fill: b.bad ? COLOR.error : COLOR.ok });
        pen.text(`pic:b${i}:t`, { x: 452 + Math.max(8, 480 * b.value), y: by + 30, fill: b.bad ? COLOR.error : COLOR.ink, ...mono(SIZE.body) }, b.text);
      });
      if (p.threshold) {
        const tx = 440 + 480 * p.threshold.value;
        pen.line("pic:thr", { x1: tx, y1: 52, x2: tx, y2: 50 + p.bars.length * 56, stroke: COLOR.warn, "stroke-width": 3, "stroke-dasharray": "6 5" });
        pen.text("pic:thr:t", { x: tx + 8, y: 50, fill: COLOR.warn, ...sans(SIZE.min, 700) }, p.threshold.label);
      }
    } else if (p.kind === "tape") tape(pen, p, W);
    else if (p.kind === "deadlock") {
      // Каждый заказ держит свой товар (сплошная стрелка, замок его цвета) и хочет чужой (штрих крест-накрест).
      const orders = [ACTOR.A, ACTOR.B];
      orders.forEach((a, i) => {
        const y = 50 + i * 60;
        pen.rect(`pic:o${i}`, { x: 40 + ox, y, width: 150, height: 44, rx: 10, fill: a.tint, stroke: a.color, "stroke-width": 2 });
        pen.text(`pic:o${i}:t`, { x: 115 + ox, y: y + 29, "text-anchor": "middle", fill: COLOR.ink, ...sans(SIZE.body, 700) }, `заказ ${i + 1}`);
        pen.rect(`pic:g${i}`, { x: 450 + ox, y, width: 150, height: 44, rx: 8, fill: COLOR.surface, stroke: COLOR.postgres, "stroke-width": 2 });
        pen.text(`pic:g${i}:t`, { x: 466 + ox, y: y + 29, fill: COLOR.ink, ...mono(SIZE.body) }, `товар ${i ? "Y" : "X"}`);
        lock(pen, `pic:g${i}:lock`, { x: 568 + ox, y: y + 8, color: a.color, attrs: { class: "fx-pop" } });
        arrow(pen, `pic:hold${i}`, 194 + ox, y + 22, 446 + ox, y + 22, { stroke: a.color, "stroke-width": 4, ...DRAW });
      });
      arrow(pen, "pic:want0", 194 + ox, 84, 446 + ox, 122, { stroke: ACTOR.A.color, "stroke-dasharray": "7 5", class: "fx-fade fx-l2" });
      arrow(pen, "pic:want1", 194 + ox, 120, 446 + ox, 82, { stroke: ACTOR.B.color, "stroke-dasharray": "7 5", class: "fx-fade fx-l2" });
      pen.group("pic:x", 320 + ox, 102, () => {
        dot("pic:x:r", 0, 0, 14, { fill: COLOR.alarmBg, stroke: COLOR.error, "stroke-width": 3 });
        pen.path("pic:x:p", { d: "M -6 -6 L 6 6 M 6 -6 L -6 6", stroke: COLOR.error, "stroke-width": 3 });
      }, { class: "fx-pop fx-l3" });
      pen.text("pic:x:t", { x: 630 + ox, y: 108, fill: COLOR.error, class: "fx-pop fx-l3", ...sans(SIZE.body, 700) }, "ждут друг друга");
    } else if (p.kind === "burst") {
      // Ось времени, пуш — и все 16 нажатий падают в одно мгновение.
      const cx = W / 2;
      pen.line("pic:axis", { x1: 40, y1: 140, x2: W - 40, y2: 140, stroke: COLOR.line, "stroke-width": 2 });
      pen.line("pic:push", { x1: cx, y1: 50, x2: cx, y2: 140, stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "4 4" });
      pen.text("pic:push:t", { x: cx, y: 44, "text-anchor": "middle", fill: COLOR.warn, ...sans(SIZE.body, 700) }, "пуш");
      pen.group("pic:burst", 0, 0, () => {
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) dot(`pic:d${r}:${c}`, cx - 24 + c * 16, 82 + r * 16, 6, { fill: COLOR.ink });
      }, { class: "fx-fall" });
      pen.text("pic:burst:t", { x: cx + 40, y: 112, fill: COLOR.ink, class: "fx-pop", ...sans(SIZE.accent, 700) }, "16");
    } else if (p.kind === "lag") {
      // Правда и счётчик на одной оси времени: счётчик догоняет до 10 с, читаем раньше — видим старое.
      const seg = (key: string, x1: number, x2: number, y: number, fill: string, stroke: string, attrs: Attrs = {}) =>
        pen.rect(key, { x: x1 + ox, y, width: x2 - x1, height: 36, rx: 6, fill, stroke, "stroke-width": 2, ...attrs });
      const num = (key: string, x: number, y: number, n: string, attrs: Attrs = {}) =>
        pen.text(key, { x: x + ox, y: y + 26, "text-anchor": "middle", fill: COLOR.ink, ...mono(SIZE.accent), ...attrs }, n);
      pen.text("pic:l1:n", { x: 20, y: 88, fill: COLOR.muted, ...sans(SIZE.body, 500) }, "на самом деле");
      pen.text("pic:l2:n", { x: 20, y: 140, fill: COLOR.muted, ...sans(SIZE.body, 500) }, "счётчик");
      seg("pic:l1:a", 200, 275, 64, COLOR.surface2, COLOR.ok);
      seg("pic:l1:b", 275, 800, 64, COLOR.doneBg, COLOR.ok);
      num("pic:l1:an", 237, 64, "3");
      num("pic:l1:bn", 330, 64, "7");
      seg("pic:l2:a", 200, 700, 116, COLOR.draftBg, COLOR.warn, { class: "fx-grow" });
      num("pic:l2:an", 330, 116, "3", { class: "fx-fade" });
      pen.text("pic:l2:late", { x: 690 + ox, y: 140, "text-anchor": "end", fill: COLOR.muted, class: "fx-fade fx-l3", ...sans(SIZE.min, 500) }, "до 10 с");
      seg("pic:l2:b", 700, 800, 116, COLOR.doneBg, COLOR.ok, { class: "fx-pop fx-l4" });
      num("pic:l2:bn", 750, 116, "7", { class: "fx-pop fx-l4" });
      pen.line("pic:read", { x1: 290 + ox, y1: 52, x2: 290 + ox, y2: 156, stroke: COLOR.warn, "stroke-width": 3, "stroke-dasharray": "5 4" });
      pen.text("pic:read:t", { x: 298 + ox, y: 48, fill: COLOR.warn, ...sans(SIZE.body, 700) }, "читаем");
      dot("pic:read:o", 330 + ox, 134, 18, { fill: "none", stroke: COLOR.error, "stroke-width": 3, class: "fx-pop fx-l1" });
    } else {
      // Очередь: свои письма проверки — в самом хвосте, таймер 2 мин истекает раньше, чем они выйдут.
      const n = Math.floor((W - 60 - 6 - 14 - 66) / 18) + 1;
      const xs = Array.from({ length: n }, (_, i) => 66 + i * 18);
      pen.rect("pic:q", { x: 60, y: 58, width: W - 120, height: 42, rx: 8, fill: COLOR.bg, stroke: COLOR.line, "stroke-width": 2 });
      arrow(pen, "pic:q:out", 60, 79, 26, 79, { "stroke-width": 3 });
      xs.forEach((x, i) => pen.rect(`pic:q${i}`, { x, y: 65, width: 14, height: 28, rx: 3, fill: i >= n - 3 ? COLOR.warn : COLOR.mail }));
      const last = xs[n - 4] + 14;
      pen.path("pic:q:br", { d: `M 66 56 V 50 H ${last} V 56`, fill: "none", stroke: COLOR.muted, "stroke-width": 2 });
      pen.text("pic:q:brt", { x: 700, y: 44, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.body, 500) }, "30 тысяч писем");
      pen.text("pic:q:ours", { x: W - 60, y: 124, "text-anchor": "end", fill: COLOR.warn, ...sans(SIZE.body, 700) }, "наши заказы");
      dot("pic:clock", 60, 150, 18, { fill: COLOR.bg, stroke: COLOR.warn, "stroke-width": 3 });
      pen.path("pic:clock:h", { d: "M 60 150 V 139 M 60 150 H 68", stroke: COLOR.warn, "stroke-width": 2 });
      const bw = W - 260;
      pen.rect("pic:timer", { x: 100, y: 143, width: bw, height: 14, rx: 7, fill: COLOR.line });
      pen.rect("pic:timer:f", { x: 100, y: 143, width: bw, height: 14, rx: 7, fill: COLOR.error, class: "fx-grow" });
      pen.text("pic:timer:t", { x: 112 + bw, y: 158, fill: COLOR.error, class: "fx-fade fx-l4", ...sans(SIZE.accent, 700) }, "2 мин");
    }
  }, { class: "fx-pop", ...lit(w, "pic") });
}

/** Виртуалка-значок: сервис (квадрат) и база (кружок) в рамке. */
function vmGlyph(pen: Pen, key: string, x: number, y: number, color: string, cls: string): void {
  pen.group(key, x, y, () => {
    pen.rect(`${key}:r`, { x: 0, y: 0, width: 40, height: 32, rx: 6, fill: COLOR.surface, stroke: color, "stroke-width": 2 });
    pen.rect(`${key}:s`, { x: 8, y: 11, width: 10, height: 10, fill: COLOR.muted });
    pen.rect(`${key}:d`, { x: 22, y: 11, width: 10, height: 10, rx: 5, fill: COLOR.postgres });
  }, { class: cls });
}

/** Лента лога: 24 с прошлого и 6 с будущего (будущее темнее, отчёт там — призрак); робот стоит на «сейчас». */
function tape(pen: Pen, p: Extract<Picture, { kind: "tape" }>, W: number): void {
  const x0 = 30;
  const tw = W - 60;
  const PAST = 24;
  const AHEAD = 6;
  const x = (ago: number) => x0 + ((PAST - ago) / (PAST + AHEAD)) * tw;
  const now = x(0);
  pen.rect("pic:future", { x: now, y: 44, width: x0 + tw - now, height: 68, fill: COLOR.bg });
  for (let i = 0; i < 100; i++) pen.rect(`pic:tk${i}`, { x: x0 + i * ((now - x0) / 100), y: 58, width: 2, height: 40, fill: COLOR.faint });
  p.marks.forEach((m, i) => {
    const ghost = m.ago < 0;
    pen.rect(`pic:m${i}`, { x: x(m.ago) - 4, y: 50, width: 8, height: 56, rx: 2, fill: ghost ? "none" : COLOR.ok, stroke: COLOR.ok, "stroke-width": ghost ? 2 : 0, ...(ghost ? { "stroke-dasharray": "4 3" } : {}) });
    pen.text(`pic:m${i}:t`, { x: x(m.ago), y: 130, "text-anchor": "middle", fill: COLOR.ok, ...sans(SIZE.min, 600) }, m.label);
  });
  // Период отчёта — скобка между двумя отчётами под лентой.
  const [a, b] = [x(16), x(6)];
  pen.path("pic:period", { d: `M ${a} 136 V 142 H ${b} V 136`, fill: "none", stroke: COLOR.muted, "stroke-width": 2 });
  pen.text("pic:period:t", { x: (a + b) / 2, y: 164, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.min, 500) }, "раз в 10 с");
  if (p.window) {
    const wa = x(p.window.past);
    const wb = x(-p.window.ahead);
    const box = { y: 44, height: 68, rx: 4, fill: "none", stroke: COLOR.error, "stroke-width": 3 };
    pen.rect("pic:win:past", { x: wa, width: now - wa, ...box, class: "fx-pop" });
    pen.rect("pic:win:ahead", { x: now, width: wb - now, ...box, "stroke-dasharray": "6 4", class: "fx-pop" });
    pen.text("pic:win:t", { x: wb, y: 30, "text-anchor": "end", fill: COLOR.error, ...sans(SIZE.min, 700) }, `${p.window.pastLabel} ${p.window.aheadLabel}`);
  }
  // «Сейчас» — поверх окна; под ним робот, который смотрит в лог.
  pen.line("pic:now:l", { x1: now, y1: 40, x2: now, y2: 112, stroke: COLOR.muted, "stroke-width": 3 });
  pen.group("pic:bot", now - 12, 114, () => {
    pen.line("pic:bot:ant", { x1: 12, y1: 0, x2: 12, y2: 6, stroke: COLOR.muted, "stroke-width": 2 });
    pen.rect("pic:bot:r", { x: 0, y: 6, width: 24, height: 20, rx: 6, fill: COLOR.surface2, stroke: COLOR.muted, "stroke-width": 2 });
    pen.rect("pic:bot:e1", { x: 6.5, y: 13.5, width: 5, height: 5, rx: 2.5, fill: COLOR.ink });
    pen.rect("pic:bot:e2", { x: 12.5, y: 13.5, width: 5, height: 5, rx: 2.5, fill: COLOR.ink });
  });
  pen.text("pic:now", { x: now, y: 164, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.min, 500) }, "сейчас");
}

/** Итог: всё, что меряет, обведено «измерением»; набор починок и вердикт — снаружи. */
function measure(pen: Pen): void {
  pen.layer("front", () => {
    // Кольца — по очереди, как их называет голос: площадка, нагрузка, (виртуалка и графики), проверка.
    const boxes = [[BOX.load, "fx-l1"], [BOX.vm, "fx-l2"], [BOX.graphs, "fx-l2"], [BOX.check, "fx-l3"]] as const;
    boxes.forEach(([b, late], i) =>
      pen.rect(`measure:r${i}`, { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 16, fill: "none", stroke: COLOR.warn, "stroke-width": 3, class: `fx-fade ${late}` }));
    pen.rect("measure:site", { x: BOX.site.x, y: BOX.site.y, width: BOX.site.w, height: BOX.site.h, rx: 18, fill: "none", stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "10 8", class: "fx-fade" });
    pill(pen, "measure:t", "измерение", { x: 30, y: -2, size: SIZE.accent, fill: COLOR.bg, color: COLOR.warn, stroke: COLOR.warn, attrs: { class: "fx-pop" } });
  });
}

/** Строка правила главы — на месте картинки примера. */
function rule(pen: Pen, w: World, text: string): void {
  pen.group(`rule:${w.frame}`, PIC.x, PIC.y, () => {
    panel(pen, "rule:p", { x: 0, y: 0, w: PIC.w, h: 110, fill: COLOR.bg2, stroke: COLOR.warn });
    pen.text("rule:h", { x: 24, y: 36, fill: COLOR.muted, ...sans(SIZE.min, 500) }, "правило");
    pen.text("rule:t", { x: 24, y: 80, fill: COLOR.ink, ...sans(SIZE.title, 700) }, text);
  }, { class: "fx-pop", ...lit(w, "pic") });
}

/** Знак подозреваемого у звена: «?», а не номер — номера заняты причинами 1–4. */
function suspect(pen: Pen, w: World, link: Link, n: number): void {
  const at = SUSPECT[link];
  if (!at) return;
  pen.group(`suspect:${link}`, at.x, at.y, () => {
    pen.rect(`suspect:${link}:r`, { x: 0, y: 0, width: 34, height: 34, rx: 17, fill: COLOR.warn });
    pen.text(`suspect:${link}:t`, { x: 17, y: 24, "text-anchor": "middle", fill: COLOR.bg, ...sans(SIZE.body, 700) }, "?");
  }, { ...(n === w.suspects.length ? { class: "fx-pop" } : {}), ...lit(w, link) });
}

/** Заголовок главы поверх затемнённой схемы: схема остаётся якорем, не уходит со сцены. */
function chapterHead(pen: Pen, w: World): void {
  const n = (w.shelf.active ?? 0) + 1;
  pen.group(`plate:${w.frame}`, 0, 0, () => {
    pen.rect("plate:bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg, opacity: 0.7 });
    panel(pen, "plate:p", { x: 290, y: 250, w: 700, h: 170, fill: COLOR.bg2, stroke: COLOR.warn });
    pen.text("plate:h", { x: 640, y: 302, "text-anchor": "middle", fill: COLOR.muted, "letter-spacing": 6, ...sans(SIZE.title, 600) }, `ПРИЧИНА ${n}`);
    pen.text("plate:t", { x: 640, y: 378, "text-anchor": "middle", fill: COLOR.ink, class: "fx-rise", ...sans(40, 700) }, w.plate!);
  }, { class: "fx-fade" });
}

/** Итоговый список советов поверх схемы; оговорка — отдельной плашкой снизу. */
function tips(pen: Pen, w: World): void {
  const t = w.tips!;
  pen.group("tips", 0, 0, () => {
    pen.rect("tips:bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg, opacity: 0.85 });
    const h = 100 + TIPS.length * 50;
    panel(pen, "tips:p", { x: 140, y: 40, w: 1000, h, fill: COLOR.bg2, stroke: COLOR.warn });
    pen.text("tips:h", { x: 172, y: 88, fill: COLOR.muted, "letter-spacing": 4, ...sans(SIZE.title, 600) }, "КАК НЕ ДАТЬ ИЗМЕРЕНИЮ СОВРАТЬ");
    TIPS.slice(0, t.shown).forEach((line, i) =>
      pen.text(`tips:${i}`, { x: 172, y: 146 + i * 50, fill: COLOR.ink, class: "fx-rise", ...sans(SIZE.accent, 600) }, `${i + 1}. ${line}`));
    if (t.caveat) {
      panel(pen, "tips:c:p", { x: 140, y: 68 + h, w: 1000, h: 150, fill: COLOR.bg2, stroke: COLOR.error });
      pen.text("tips:c:t", { x: 172, y: 116 + h, fill: COLOR.ink, class: "fx-pop", ...sans(SIZE.accent, 700) }, t.caveat);
    }
  }, { class: "fx-fade" });
}

function moral(pen: Pen, w: World): void {
  // Под схемой, а не поверх: голос называет звенья «измерения» — рамка должна быть видна целиком.
  pen.group(`moral:${w.frame}`, PIC.x, PIC.y, () => {
    pen.rect("moral:under", { x: -10, y: -6, width: PIC.w + 20, height: 184, rx: 18, fill: COLOR.bg, opacity: 0.95 });
    panel(pen, "moral:p", { x: 0, y: 0, w: PIC.w, h: 172, fill: COLOR.bg2, stroke: COLOR.warn });
    pen.text("moral:t", { x: PIC.w / 2, y: 76, "text-anchor": "middle", fill: COLOR.ink, ...sans(SIZE.title, 700) }, w.moral!);
  }, { class: "fx-rise" });
}

function titleCard(pen: Pen, w: World): void {
  const t = w.title!;
  pen.rect("title:bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg });
  pen.text("title:h", { x: STAGE.w / 2, y: 200, "text-anchor": "middle", fill: COLOR.muted, "letter-spacing": 6, ...sans(SIZE.title, 600) }, t.head.toUpperCase());
  pen.text("title:t", { x: STAGE.w / 2, y: 290, "text-anchor": "middle", fill: COLOR.ink, class: "fx-rise", ...sans(40, 700) }, t.text);
}
