import { STAGE, type Attrs, type Pen } from "../../engine/contract";
import { bob } from "../../kit/characters";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, panel, pill, plate } from "../../kit/widgets";
import { CLASSES, CREW, STATIONS, type ClassNo, type Focus, type Picture, type Who, type World } from "./sim";

// Отрисовка наброска — серые фигуры фазы 0, без полировки. Раскладка: слева круг цикла и двое у стенда;
// справа сверху цепочка «решение → прибор → вердикт», под ней картинка примера; внизу полка пяти классов.

const sans = (size: number, weight = 600) => ({ "font-family": FONT.sans, "font-size": size, "font-weight": weight });
const mono = (size: number) => ({ "font-family": FONT.mono, "font-size": size });

const CAST: Record<Who, { letter: string; name: string; color: string; tint: string; x: number }> = {
  agent: { letter: "А", name: "агент", color: ACTOR.A.color, tint: ACTOR.A.tint, x: 60 },
  author: { letter: "Р", name: "автор", color: "#ffd166", tint: "#5a4a1c", x: 250 },
};
const CREW_Y = 450;
const LOOP = { x: 210, y: 210, r: 110 };

function lit(w: World, ...what: Focus[]): Attrs {
  return !w.focus || what.some((f) => w.focus!.includes(f)) ? {} : { opacity: DIM };
}

export function render(pen: Pen, w: World): void {
  pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg });
  if (w.loop.on) loop(pen, w);
  if (w.chain.on) chain(pen, w);
  if (w.pic) picture(pen, w, w.pic);
  if (w.shelf.on) shelf(pen, w);
  crew(pen, w);
  pen.layer("top", () => {
    if (w.plate) plate(pen, `plate:${w.frame}`, "класс", w.plate, STAGE);
    if (w.moral) moral(pen, w);
    if (w.title) titleCard(pen, w);
  });
}

/** Круг «красное → почему → правка → снова»; метка — где мы сейчас. */
function loop(pen: Pen, w: World): void {
  const { x, y, r } = LOOP;
  pen.group("loop", x, y, () => {
    pen.path("loop:ring", { d: `M 0 ${-r} A ${r} ${r} 0 1 1 -0.1 ${-r}`, fill: "none", stroke: COLOR.line, "stroke-width": 4 });
    STATIONS.forEach((name, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      const sx = Math.cos(a) * r;
      const sy = Math.sin(a) * r;
      const here = w.loop.at === i;
      const color = here ? (i === 0 ? COLOR.error : i === 3 && w.chain.verdict === "green" ? COLOR.ok : COLOR.warn) : COLOR.faint;
      pen.rect(`loop:s${i}`, { x: sx - 9, y: sy - 9, width: 18, height: 18, rx: 9, fill: here ? color : COLOR.bg, stroke: color, "stroke-width": 3 });
      const lx = sx + (i === 1 ? 20 : i === 3 ? -20 : 0);
      const ly = sy + (i === 0 ? -22 : i === 2 ? 38 : 6);
      const anchor = i === 1 ? "start" : i === 3 ? "end" : "middle";
      pen.text(`loop:t${i}`, { x: lx, y: ly, "text-anchor": anchor, fill: here ? COLOR.ink : COLOR.muted, ...sans(SIZE.body, here ? 700 : 500) }, name);
    });
    if (w.loop.lap) pen.text("loop:lap", { x: 0, y: 8, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.accent, 700) }, `круг ${w.loop.lap}`);
  }, lit(w, "loop"));
}

/** Цепочка проверки: решение не трогаем, правки ложатся на прибор. */
function chain(pen: Pen, w: World): void {
  const c = w.chain;
  const box = (key: string, x: number, width: number, head: string, text: string, edits: number | null, focus: Focus) =>
    pen.group(key, x, 40, () => {
      panel(pen, `${key}:p`, { x: 0, y: 0, w: width, h: 150, fill: COLOR.bg2 });
      pen.text(`${key}:h`, { x: 20, y: 32, fill: COLOR.muted, ...sans(SIZE.min, 500) }, head);
      pen.text(`${key}:t`, { x: 20, y: 72, fill: COLOR.ink, ...sans(SIZE.accent, 700) }, text);
      if (edits !== null)
        pill(pen, `${key}:e${edits}`, `правок: ${edits}`, {
          x: 20, y: 100, size: SIZE.min, fill: edits ? COLOR.draftBg : COLOR.surface2, color: edits ? COLOR.warn : COLOR.muted,
          attrs: edits ? { class: "fx-pop" } : {},
        });
    }, lit(w, "chain", focus));
  box("fix", 440, 230, "решение", c.fix, c.fixEdits, "fix");
  pen.path("chain:a1", { d: "M 680 115 L 708 115 M 700 107 L 708 115 L 700 123", fill: "none", stroke: COLOR.muted, "stroke-width": 3 });
  box("gauge", 718, 280, "прибор", c.gauge, c.gaugeEdits, "gauge");
  pen.path("chain:a2", { d: "M 1006 115 L 1034 115 M 1026 107 L 1034 115 L 1026 123", fill: "none", stroke: COLOR.muted, "stroke-width": 3 });
  pen.group("verdict", 1044, 40, () => {
    panel(pen, "verdict:p", { x: 0, y: 0, w: 196, h: 150, fill: COLOR.bg2 });
    pen.text("verdict:h", { x: 20, y: 32, fill: COLOR.muted, ...sans(SIZE.min, 500) }, "вердикт");
    const color = c.verdict === "red" ? COLOR.error : c.verdict === "green" ? COLOR.ok : COLOR.faint;
    pen.rect(`verdict:lamp:${c.verdict}`, { x: 20, y: 56, width: 56, height: 56, rx: 28, fill: c.verdict ? color : COLOR.bg, stroke: color, "stroke-width": 3, class: c.verdict ? "fx-pop" : "" });
    if (c.verdict) pen.text("verdict:t", { x: 90, y: 92, fill: color, ...sans(SIZE.body, 700) }, c.verdict === "red" ? "красное" : "зелёное");
  }, lit(w, "chain"));
}

/** Картинка примера: то, что увидели на стенде. */
function picture(pen: Pen, w: World, p: Picture): void {
  const W = 800;
  const H = 340;
  pen.group(`pic:${w.frame}`, 440, 215, () => {
    panel(pen, "pic:p", { x: 0, y: 0, w: W, h: H, fill: COLOR.bg2 });
    pen.text("pic:h", { x: 24, y: 36, fill: COLOR.muted, ...sans(SIZE.body, 500) }, p.title);
    if (p.kind === "chart") {
      const x0 = 40;
      const y0 = 70;
      const cw = W - 80;
      const ch = H - 120;
      const step = cw / Math.max(p.points.length - 1, 1);
      const y = (v: number) => y0 + ch - v * ch;
      pen.rect("pic:axis", { x: x0, y: y0 + ch, width: cw, height: 2, fill: COLOR.line });
      if (p.limit !== null) {
        pen.line("pic:limit", { x1: x0, y1: y(p.limit), x2: x0 + cw, y2: y(p.limit), stroke: COLOR.error, "stroke-width": 2, "stroke-dasharray": "8 6" });
        pen.text("pic:limitt", { x: x0 + cw, y: y(p.limit) - 10, "text-anchor": "end", fill: COLOR.error, ...sans(SIZE.min, 500) }, "порог");
      }
      const d = p.points.map((v, i) => `${i ? "L" : "M"} ${x0 + i * step} ${y(v)}`).join(" ");
      pen.path("pic:line", { d, fill: "none", stroke: p.bad ? COLOR.error : COLOR.ok, "stroke-width": 3, class: "fx-draw" });
      if (p.mark) {
        const mx = x0 + p.mark.at * step;
        pen.line("pic:mark", { x1: mx, y1: y0, x2: mx, y2: y0 + ch, stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "4 4" });
        pen.text("pic:markt", { x: mx + 10, y: y0 + 22, fill: COLOR.warn, ...sans(SIZE.body, 700) }, p.mark.label);
      }
    } else if (p.kind === "bars") {
      p.bars.forEach((b, i) => {
        const by = 80 + i * 80;
        pen.text(`pic:b${i}:l`, { x: 24, y: by + 30, fill: COLOR.ink, ...sans(SIZE.body, 600) }, b.label);
        pen.rect(`pic:b${i}:bar`, { x: 300, y: by + 8, width: Math.max(8, 360 * b.value), height: 32, rx: 6, fill: b.bad ? COLOR.error : COLOR.ok});
        pen.text(`pic:b${i}:t`, { x: 310 + Math.max(8, 360 * b.value), y: by + 31, fill: b.bad ? COLOR.error : COLOR.ink, ...mono(SIZE.body) }, b.text);
      });
    } else {
      const card = (key: string, x: number, head: string, text: string, color: string) => {
        panel(pen, `${key}:p`, { x, y: 70, w: 350, h: 240, fill: COLOR.surface, stroke: color });
        pen.text(`${key}:h`, { x: x + 20, y: 106, fill: COLOR.muted, ...sans(SIZE.body, 500) }, head);
        pen.text(`${key}:t`, { x: x + 20, y: 154, fill: color === COLOR.line ? COLOR.ink : color, ...sans(SIZE.accent, 700) }, text);
      };
      card("pic:l", 30, p.left.head, p.left.text, COLOR.line);
      card("pic:r", 420, p.right.head, p.right.text, p.right.bad ? COLOR.error : COLOR.ok);
    }
  }, { class: "fx-pop", ...lit(w, "pic") });
}

/** Полка пяти классов: пустые гнёзда заполняются по мере встречи. */
function shelf(pen: Pen, w: World): void {
  CLASSES.forEach((_, i) => {
    const no = w.shelf.byMeet ? w.shelf.met[i] : (i as ClassNo);
    const met = no !== undefined && w.shelf.met.includes(no);
    const active = met && w.shelf.active === no;
    const name = met ? `${w.shelf.byMeet ? "" : `${i + 1}. `}${CLASSES[no]}` : w.shelf.byMeet ? "?" : `${i + 1}. ?`;
    const x = 40 + i * 242;
    pen.group(`shelf:${i}`, x, 584, () => {
      pen.rect(`shelf:${i}:r`, {
        x: 0, y: 0, width: 230, height: 54, rx: 10, fill: met ? COLOR.surface2 : COLOR.bg,
        stroke: active ? COLOR.warn : met ? COLOR.line : COLOR.faint, "stroke-width": active ? 3 : 1.5, ...(met ? {} : { "stroke-dasharray": "6 5" }),
      });
      pen.text(`shelf:${i}:t`, { x: 115, y: 34, "text-anchor": "middle", fill: met ? (active ? COLOR.warn : COLOR.ink) : COLOR.faint, ...sans(SIZE.min, 700) },
        name);
    }, { ...(active ? { class: "fx-pop" } : {}), ...lit(w, "shelf") });
  });
}

function crew(pen: Pen, w: World): void {
  for (const k of CREW) {
    const m = w.crew[k];
    if (!m.on) continue;
    const c = CAST[k];
    pen.group(`crew:${k}`, c.x, CREW_Y, () => {
      bob(pen, `crew:${k}:b`, { x: 0, y: 0, color: c.color, tint: c.tint, letter: c.letter, mood: m.mood, look: { x: 0.5, y: -0.5 } });
      pen.text(`crew:${k}:n`, { x: 32, y: 92, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.min, 500) }, c.name);
    }, lit(w, k));
    if (m.say)
      pen.layer("front", () =>
        bubble(pen, `say:${k}:${w.frame}`, m.say!, { x: c.x + 32, y: CREW_Y - 22, tail: "down", align: k === "author" ? "end" : "start", attrs: { class: "fx-pop" } }));
  }
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
