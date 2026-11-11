import { STAGE, type Attrs, type Pen } from "../../engine/contract";
import { bob } from "../../kit/characters";
import { COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, lamp, panel, pill } from "../../kit/widgets";
import { CLASSES, STATIONS, ci, type Editable, type Focus, type Link, type Picture, type World } from "./sim";

// Отрисовка наброска — серые фигуры фазы 0, без полировки. Раскладка:
//   сверху — площадка (пунктирная рамка), в ней нагрузка → виртуалка (сервис + база) → графики и алерт;
//   ниже — набор починок (стрелка в сервис), проверка (стрелка от виртуалки) → вердикт и CI;
//   под площадкой — строка причин (чипы); справа столбец — круг задачи (глава «нагрузка не та»);
//   внизу слева автор и его представления (глава про модель и итог), справа картинка примера или строка правила.

const sans = (size: number, weight = 600) => ({ "font-family": FONT.sans, "font-size": size, "font-weight": weight });
const mono = (size: number) => ({ "font-family": FONT.mono, "font-size": size });

const BOX = {
  site: { x: 16, y: 14, w: 1068, h: 404 },
  load: { x: 40, y: 56, w: 150, h: 170 },
  vm: { x: 210, y: 56, w: 320, h: 170 },
  graphs: { x: 570, y: 56, w: 240, h: 170 },
  deck: { x: 40, y: 250, w: 490, h: 150 },
  check: { x: 570, y: 250, w: 240, h: 150 },
  verdict: { x: 840, y: 250, w: 224, h: 150 },
} as const;
const SERVICE = { x: 230, y: 104, w: 140, h: 104 };
const PIC = { x: 420, y: 470, w: 840, h: 176 };
const AUTHOR = { x: 40, y: 520 };
const MODEL = { x: 120, y: 470, w: 280, h: 176 };
/** Где у звена номер подозреваемого (левый верхний угол звена; у площадки — у вкладки). */
const SUSPECT: Partial<Record<Link, { x: number; y: number }>> = {
  site: { x: BOX.site.x + 528, y: BOX.site.y + 4 },
  load: { x: BOX.load.x - 24, y: BOX.load.y - 22 },
  check: { x: BOX.check.x - 24, y: BOX.check.y - 22 },
  model: { x: MODEL.x - 24, y: MODEL.y - 22 },
};

function lit(w: World, ...what: Focus[]): Attrs {
  return !w.focus || what.some((f) => w.focus!.includes(f)) ? {} : { opacity: DIM };
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
  if (w.author.on) author(pen, w);
  if (w.loop.on) loop(pen, w);
  if (w.pic) picture(pen, w, w.pic);
  else if (w.rule) rule(pen, w, w.rule);
  if (w.tally) measure(pen);
  w.suspects.forEach((link, i) => suspect(pen, w, link, i + 1));
  pen.layer("top", () => {
    if (w.plate) chapterHead(pen, w);
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
  for (let i = 0; i < n; i++)
    pen.rect(`${key}:pip${i}`, { x: 16 + pen.measure(text, sans(SIZE.min, 500)).width + 10 + i * 16, y: 16, width: 12, height: 12, rx: 6, fill: COLOR.warn, ...(i === n - 1 ? { class: "fx-pop" } : {}) });
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
      const y = 70 + i * 34;
      pen.text(`graphs:n${i}`, { x: 16, y: y + 6, fill: COLOR.muted, ...sans(SIZE.min, 500) }, name);
      const bad = w.alert && i < 2;
      const d = bad ? `M 110 ${y} L 150 ${y} L 160 ${y - 16} L 175 ${y - 4} L 185 ${y - 18} L 220 ${y - 16}` : `M 110 ${y} L 220 ${y}`;
      pen.path(`graphs:l${i}:${bad}`, { d, fill: "none", stroke: bad ? COLOR.error : COLOR.ok, "stroke-width": 3, class: "fx-draw" });
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
    [true, false, false, true, false, false].forEach((right, i) => {
      const up = w.card && w.card.right === right && i === (right ? 0 : 1);
      pen.rect(`deck:c${i}`, { x: 16 + i * 30, y: up ? 46 : 58, width: 52, height: 76, rx: 6, fill: COLOR.surface, stroke: right ? COLOR.ok : COLOR.error, "stroke-width": up ? 4 : 2 });
    });
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

/** Строка пяти причин под площадкой: встреченные — чипы с названием, остальные — пустые кружки. */
function shelf(pen: Pen, w: World): void {
  let x = 16;
  CLASSES.forEach((name, i) => {
    const met = w.shelf.met.includes(i as never);
    const active = w.shelf.active === i;
    if (!met) {
      pen.rect(`shelf:${i}:empty`, { x, y: 434, width: 18, height: 18, rx: 9, fill: "none", stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "4 3", ...lit(w, "shelf") });
      x += 30;
      return;
    }
    x += pill(pen, `shelf:${i}:${active}`, `${i + 1}. ${name}`, {
      x, y: 427, size: SIZE.min, fill: active ? COLOR.surface2 : COLOR.bg, color: active ? COLOR.warn : COLOR.ink, stroke: active ? COLOR.warn : COLOR.line,
      attrs: { ...(active ? { class: "fx-pop" } : {}), ...lit(w, "shelf") },
    }) + 12;
  });
}

/** Автор и его представления о системе — звено «модель». */
function author(pen: Pen, w: World): void {
  pen.group("author", AUTHOR.x, AUTHOR.y, () => {
    bob(pen, "author:b", { x: 0, y: 0, color: "#ffd166", tint: "#5a4a1c", letter: "М", mood: w.author.mood, look: { x: 0.6, y: -0.4 } });
    pen.text("author:n", { x: 32, y: 92, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.min, 500) }, "мы");
  }, lit(w, "author", "model"));
  if (w.on.model) {
    pen.group("model", MODEL.x, MODEL.y, () => {
      panel(pen, "model:p", { x: 0, y: 0, w: MODEL.w, h: MODEL.h, fill: COLOR.bg2, stroke: COLOR.faint });
      head(pen, "model", "что мы думаем", w, "model");
      if (w.model && !w.tally) pen.text(`model:t:${w.model}`, { x: 16, y: 74, fill: COLOR.ink, class: "fx-pop", ...sans(SIZE.body, 600) }, w.model);
    }, lit(w, "model"));
    if (w.model && !w.tally && w.focus?.includes("author")) pen.layer("front", () => bubble(pen, `author:say:${w.frame}`, "хм", { x: AUTHOR.x + 50, y: AUTHOR.y - 4, tail: "down", thought: true }));
  }
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

/** Картинка примера: то, что увидели на стенде. */
function picture(pen: Pen, w: World, p: Picture): void {
  const { w: W, h: H } = PIC;
  pen.group(`pic:${w.frame}`, PIC.x, PIC.y, () => {
    panel(pen, "pic:p", { x: 0, y: 0, w: W, h: H, fill: COLOR.bg2 });
    pen.text("pic:h", { x: 20, y: 30, fill: COLOR.muted, ...sans(SIZE.body, 500) }, p.title);
    if (p.kind === "chart") {
      const x0 = 30;
      const y0 = 50;
      const cw = (p.note ? 520 : W - 60);
      const ch = H - 70;
      const step = cw / Math.max(p.points.length - 1, 1);
      const y = (v: number) => y0 + ch - v * ch;
      pen.rect("pic:axis", { x: x0, y: y0 + ch, width: cw, height: 2, fill: COLOR.line });
      const d = p.points.map((v, i) => `${i ? "L" : "M"} ${x0 + i * step} ${y(v)}`).join(" ");
      pen.path("pic:line", { d, fill: "none", stroke: p.bad ? COLOR.error : COLOR.ok, "stroke-width": 3, class: "fx-draw" });
      if (p.mark) {
        const mx = x0 + p.mark.at * step;
        pen.line("pic:mark", { x1: mx, y1: y0, x2: mx, y2: y0 + ch, stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "4 4" });
        pen.text("pic:markt", { x: mx + 10, y: y0 + 24, fill: COLOR.warn, ...sans(SIZE.body, 700) }, p.mark.label);
      }
      if (p.note) pen.text("pic:note", { x: 580, y: 90, fill: COLOR.ink, ...sans(SIZE.accent, 700) }, p.note);
    } else if (p.kind === "bars") {
      p.bars.forEach((b, i) => {
        const by = 50 + i * 56;
        pen.text(`pic:b${i}:l`, { x: 20, y: by + 28, fill: COLOR.ink, ...sans(SIZE.body, 600) }, b.label);
        pen.rect(`pic:b${i}:bar`, { x: 380, y: by + 8, width: Math.max(8, 300 * b.value), height: 30, rx: 6, fill: b.bad ? COLOR.error : COLOR.ok });
        pen.text(`pic:b${i}:t`, { x: 392 + Math.max(8, 300 * b.value), y: by + 30, fill: b.bad ? COLOR.error : COLOR.ink, ...mono(SIZE.body) }, b.text);
      });
    } else {
      const card = (key: string, x: number, head: string, text: string, color: string) => {
        panel(pen, `${key}:p`, { x, y: 46, w: 390, h: 116, fill: COLOR.surface, stroke: color, shadow: false });
        pen.text(`${key}:h`, { x: x + 16, y: 74, fill: COLOR.muted, ...sans(SIZE.min, 500) }, head);
        pen.text(`${key}:t`, { x: x + 16, y: 106, fill: color === COLOR.line ? COLOR.ink : color, ...sans(SIZE.accent, 700) }, text);
      };
      card("pic:l", 20, p.left.head, p.left.text, COLOR.line);
      card("pic:r", 430, p.right.head, p.right.text, p.right.bad ? COLOR.error : COLOR.ok);
    }
  }, { class: "fx-pop", ...lit(w, "pic") });
}

/** Итог: всё, что меряет, обведено «измерением»; набор починок и вердикт — снаружи. */
function measure(pen: Pen): void {
  pen.layer("front", () => {
    const boxes = [BOX.load, BOX.vm, BOX.graphs, BOX.check, { x: MODEL.x, y: MODEL.y, w: MODEL.w, h: MODEL.h }];
    boxes.forEach((b, i) =>
      pen.rect(`measure:r${i}`, { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 16, fill: "none", stroke: COLOR.warn, "stroke-width": 3, class: "fx-fade" }));
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

/** Номер подозреваемого у звена. */
function suspect(pen: Pen, w: World, link: Link, n: number): void {
  const at = SUSPECT[link];
  if (!at) return;
  pen.group(`suspect:${link}`, at.x, at.y, () => {
    pen.rect(`suspect:${link}:r`, { x: 0, y: 0, width: 34, height: 34, rx: 17, fill: COLOR.warn });
    pen.text(`suspect:${link}:t`, { x: 17, y: 24, "text-anchor": "middle", fill: COLOR.bg, ...sans(SIZE.body, 700) }, String(n));
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

function moral(pen: Pen, w: World): void {
  pen.group(`moral:${w.frame}`, 140, 230, () => {
    pen.rect("moral:under", { x: -10, y: -10, width: 1020, height: 200, rx: 18, fill: COLOR.bg, opacity: 0.95 });
    panel(pen, "moral:p", { x: 0, y: 0, w: 1000, h: 180, fill: COLOR.bg2, stroke: COLOR.warn });
    pen.text("moral:t", { x: 500, y: 76, "text-anchor": "middle", fill: COLOR.ink, ...sans(SIZE.title, 700) }, w.moral!);
  }, { class: "fx-rise" });
}

function titleCard(pen: Pen, w: World): void {
  const t = w.title!;
  pen.rect("title:bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg });
  pen.text("title:h", { x: STAGE.w / 2, y: 200, "text-anchor": "middle", fill: COLOR.muted, "letter-spacing": 6, ...sans(SIZE.title, 600) }, t.head.toUpperCase());
  pen.text("title:t", { x: STAGE.w / 2, y: 290, "text-anchor": "middle", fill: COLOR.ink, class: "fx-rise", ...sans(40, 700) }, t.text);
}
