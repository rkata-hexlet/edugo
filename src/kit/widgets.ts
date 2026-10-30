import type { Attrs, Pen, Span, TextContent } from "../engine/contract";
import type { Board } from "./director";
import { icon, type IconName } from "./icons";
import { highlightSql, markSql, type SqlMark } from "./sql";
import { ACTOR, COLOR, FONT, SIZE } from "./theme";

// Виджеты серии: панель, пузырь реплики с хвостом, пилюля, лампа, табло, окно SQL, штамп перемотки,
// полноэкранная плашка.
// Размеры текстовых рамок — по `pen.measure`, а не по числу символов.

/** Плоская тень: смещённая подложка без фильтров. */
const SHADOW = 4;

/** Поверхность с плоской тенью. */
export function panel(
  pen: Pen, key: string,
  o: { x: number; y: number; w: number; h: number; fill?: string; stroke?: string; rx?: number; shadow?: boolean; attrs?: Attrs },
): void {
  const rx = o.rx ?? 16;
  if (o.shadow !== false) pen.rect(`${key}:shadow`, { x: o.x, y: o.y + SHADOW, width: o.w, height: o.h, rx, fill: COLOR.shadow, ...o.attrs });
  pen.rect(`${key}:bg`, {
    x: o.x, y: o.y, width: o.w, height: o.h, rx,
    fill: o.fill ?? COLOR.surface, stroke: o.stroke ?? COLOR.line, "stroke-width": 1.5, ...o.attrs,
  });
}

export type Tail = "left" | "right" | "down" | "up";

/**
 * Пузырь реплики: светлый на тёмной сцене. `(x, y)` — кончик хвоста. Хвост "left" — пузырь справа
 * от точки, "right" — слева; "down" — над ней, "up" — под ней; `align: "end"` — пузырь уходит влево.
 */
export function bubble(
  pen: Pen, key: string, text: string,
  o: { x: number; y: number; tail: Tail; align?: "start" | "end"; size?: number; thought?: boolean; attrs?: Attrs },
): { w: number; h: number } {
  const size = o.size ?? SIZE.say;
  const font = { "font-size": size, "font-family": FONT.sans, "font-weight": 600 };
  const m = pen.measure(text, font);
  const padX = 16;
  const padY = 10;
  const w = Math.ceil(m.width) + padX * 2;
  const h = Math.ceil(m.height) + padY * 2;
  const tail = 12;
  let bx: number;
  let by: number;
  let tri: string;
  if (o.tail === "left") {
    bx = o.x + tail;
    by = o.y - h / 2;
    tri = `M ${o.x} ${o.y} L ${bx + 2} ${o.y - 8} L ${bx + 2} ${o.y + 8} Z`;
  } else if (o.tail === "right") {
    bx = o.x - tail - w;
    by = o.y - h / 2;
    tri = `M ${o.x} ${o.y} L ${bx + w - 2} ${o.y - 8} L ${bx + w - 2} ${o.y + 8} Z`;
  } else {
    const inset = 28;
    bx = o.align === "end" ? o.x - w + inset : o.x - inset;
    by = o.tail === "down" ? o.y - tail - h : o.y + tail;
    const edge = o.tail === "down" ? by + h - 2 : by + 2;
    tri = `M ${o.x} ${o.y} L ${o.x - 9} ${edge} L ${o.x + 9} ${edge} Z`;
  }
  pen.group(key, 0, 0, () => {
    if (o.thought) {
      // Мысль: тёмная, пунктиром, вместо хвоста — два кружка к говорящему.
      pen.rect(`${key}:bg`, { x: bx, y: by, width: w, height: h, rx: h / 2, fill: COLOR.surface2, stroke: COLOR.ink, "stroke-width": 2, "stroke-dasharray": "5 4" });
      const dir = o.tail === "right" ? -1 : 1;
      [[6, 4], [14, 6]].forEach(([d, r], i) =>
        pen.rect(`${key}:dot${i}`, { x: o.x + dir * d - r / 2, y: o.y - r / 2, width: r, height: r, rx: r / 2, fill: COLOR.ink }));
      pen.text(`${key}:t`, { x: bx + padX, y: by + padY + size * 0.8, fill: COLOR.ink, ...font, "font-style": "italic" }, text);
      return;
    }
    pen.rect(`${key}:shadow`, { x: bx, y: by + SHADOW, width: w, height: h, rx: 14, fill: COLOR.shadow });
    pen.path(`${key}:tail`, { d: tri, fill: COLOR.ink, stroke: "none" });
    pen.rect(`${key}:bg`, { x: bx, y: by, width: w, height: h, rx: 14, fill: COLOR.ink });
    // Базовая линия первой строки: верх + отступ + кегль × 0.8 (высота заглавных у Inter).
    pen.text(`${key}:t`, { x: bx + padX, y: by + padY + size * 0.8, fill: COLOR.bg, ...font }, text);
  }, o.attrs);
  return { w, h };
}

/** Пилюля с текстом; (x, y) — левый верхний угол. Возвращает ширину. */
export function pill(
  pen: Pen, key: string, content: TextContent,
  o: { x: number; y: number; fill: string; color: string; stroke?: string; size?: number; mono?: boolean; bold?: boolean; attrs?: Attrs },
): number {
  const size = o.size ?? SIZE.body;
  const font = { "font-size": size, "font-family": o.mono ? FONT.mono : FONT.sans, "font-weight": o.bold === false ? 400 : 600 };
  const h = Math.round(size * 1.8);
  const w = Math.ceil(pen.measure(content, font).width) + h;
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:bg`, { width: w, height: h, rx: h / 2, fill: o.fill, ...(o.stroke ? { stroke: o.stroke, "stroke-width": 1.5 } : {}) });
    pen.text(`${key}:t`, { x: h / 2, y: h / 2 + size * 0.36, fill: o.color, ...font }, content);
  }, o.attrs);
  return w;
}

export type LampState = "red" | "yellow" | "green" | null;
const LAMP: Record<Exclude<LampState, null>, string> = { red: COLOR.error, yellow: COLOR.warn, green: COLOR.ok };

/** Светодиод табло; null — ещё не проверяли (пустой пунктир). (x, y) — центр. */
export function lamp(pen: Pen, key: string, x: number, y: number, state: LampState, r = 10): void {
  if (!state) {
    pen.rect(key, { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: r, fill: "none", stroke: COLOR.faint, "stroke-width": 1.5, "stroke-dasharray": "3 3" });
    return;
  }
  // Не только цвет: ✓ / ✕ / ! внутри — красный и зелёный сливаются у дальтоников.
  const glyph: Record<Exclude<LampState, null>, IconName> = { green: "check", red: "cross", yellow: "bang" };
  pen.group(key, 0, 0, () => {
    pen.rect(`${key}:glow`, { x: x - r - 4, y: y - r - 4, width: 2 * r + 8, height: 2 * r + 8, rx: r + 4, fill: LAMP[state], opacity: 0.22 });
    pen.rect(`${key}:dot`, { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: r, fill: LAMP[state] });
    icon(pen, `${key}:g`, glyph[state], x - r * 0.75, y - r * 0.75, r * 1.5, COLOR.bg);
  }, { class: "fx-pop" }); // новая оценка на табло вспыхивает
}

/**
 * Табло главы: критерии в шапке, строка на попытку с лампой на критерий (обычно две). Ярко — только попытка, о которой речь;
 * прошлые — фоном (learning-designer: 4×2 ламп не читают). `lampX` — центры ламп от левого края табло.
 */
export function board(
  pen: Pen, b: Board,
  o: { x: number; y: number; w: number; rowH: number; lampX: number[]; lampR?: number; dimIdle?: boolean; attrs?: Attrs },
): void {
  const font = { "font-family": FONT.sans, "font-size": SIZE.body };
  const lampX = o.lampX.map((dx) => o.x + dx);
  pen.group("board", 0, 0, () => {
    const height = 46 + b.attempts.length * o.rowH + 8;
    panel(pen, "board:box", { x: o.x, y: o.y, w: o.w, h: height });
    // dimIdle: критерий, который ещё ни разу не проверяли, — фоном, чтобы взгляд шёл к проверенным.
    const r = o.lampR ?? 10;
    const idle = (j: number) => o.dimIdle && b.attempts.every((t) => !t.lamps?.[j]);
    b.criteria.forEach((c, i) =>
      pen.text(`board:h${i}`, { x: lampX[i], y: o.y + 30, ...font, fill: COLOR.muted, "text-anchor": "middle", opacity: idle(i) ? 0.45 : 1 }, c));
    b.attempts.forEach((t, i) => {
      const y = o.y + 46 + i * o.rowH;
      const current = i === (b.focus ?? b.attempts.length - 1);
      pen.group(`board:a${i}`, 0, 0, () => {
        pen.text(`board:n${i}`, { x: o.x + 18, y: y + 18, ...font, fill: current ? COLOR.ink : COLOR.muted, "font-weight": current ? 700 : 400 }, t.name);
        // Критерий с пустым именем ещё не введён голосом — его ламп нет.
        lampX.forEach((x, j) => b.criteria[j] && lamp(pen, `board:l${i}:${j}`, x, y + 2 + r, t.lamps?.[j] ?? null, r));
      }, { opacity: current ? 1 : 0.45 });
    });
  }, o.attrs);
}

/**
 * Окно редактора с SQL: строки — уже раскрашенные куски. `mark` — части, о которых говорит голос: ярко, остальное приглушено
 * (`markSql`). Возвращает размер окна.
 */
export function sqlWindow(
  pen: Pen, key: string, lines: Span[][],
  o: { x: number; bottom: number; size?: number; mark?: SqlMark[]; attrs?: Attrs },
): { w: number; h: number } {
  const size = o.size ?? SIZE.body;
  const font = { "font-size": size, "font-family": FONT.mono };
  const spans = markSql(lines, o.mark ?? []).flatMap((line, i) => (i === 0 ? line : [{ text: "\n" }, ...line]));
  const m = pen.measure(spans, font);
  const top = 28;
  const w = Math.ceil(m.width) + 36;
  const h = top + Math.ceil(m.height) + 12;
  const y = o.bottom - h;
  pen.group(key, o.x, y, () => {
    panel(pen, `${key}:win`, { x: 0, y: 0, w, h, fill: "#11172e", rx: 12 });
    ["#ff5f57", "#febc2e", "#28c840"].forEach((fill, i) =>
      pen.rect(`${key}:dot${i}`, { x: 16 + i * 16, y: 10, width: 9, height: 9, rx: 4.5, fill, opacity: 0.75 }));
    pen.text(`${key}:t`, { x: 18, y: top + size * 0.8, ...font }, spans);
  }, o.attrs);
  return { w, h };
}

/** Строки SQL-панели: префикс «Pod A ▸» — цветом пода, сам запрос — с подсветкой; `\n` — продолжение запроса. */
export function podSql(entries: string[]): Span[][] {
  return entries.flatMap((entry) => {
    const [first, ...rest] = entry.split("\n");
    const m = /^(Pod ([ABC])) ▸ (.*)$/.exec(first);
    const head: Span[] = m
      ? [{ text: `${m[1]} ▸ `, attrs: { fill: ACTOR[m[2] as keyof typeof ACTOR].color, "font-weight": 700 } }, ...highlightSql(m[3])]
      : highlightSql(first);
    return [head, ...rest.map((line) => highlightSql(line))];
  });
}

/** Штамп перемотки «⟲ Иначе / Вернёмся: …» — по центру между `left` и `right`, в шапке. */
export function stamp(pen: Pen, text: string, o: { left: number; right: number }): void {
  const label = text.replace(/^⟲\s*/, "");
  const font = { "font-family": FONT.sans, "font-size": SIZE.body, "font-weight": 700 };
  const w = pen.measure(label, font).width + 62;
  pen.group("stamp", (o.left + o.right - w) / 2, 22, () => {
    pen.rect("stamp:bg", { width: w, height: 40, rx: 20, fill: COLOR.warn });
    icon(pen, "stamp:i", "replay", 14, 9, 22, COLOR.bg);
    pen.text("stamp:t", { x: 44, y: 27, ...font, fill: COLOR.bg }, label);
  }, { class: "fx-stamp" });
}

/** Значок и текст в строку; возвращает x правого края. (x, y) — базовая линия текста. */
export function iconText(
  pen: Pen, key: string, name: IconName, x: number, y: number, text: string, color: string,
  attrs: Attrs = { "font-family": FONT.sans, "font-size": SIZE.body },
): number {
  const size = 20;
  icon(pen, `${key}:i`, name, x, y - 16, size, color);
  if (!text) return x + size;
  pen.text(`${key}:t`, { x: x + size + 5, y, fill: color, ...attrs }, text);
  return x + size + 5 + pen.measure(text, attrs).width;
}

/** Разовый эффект кадра: с `fx` — новый ключ (эффект проигрывается заново) и класс; без — прежний ключ. */
export function once(key: string, frame: number, fx: string | null): [string, Attrs] {
  return fx ? [`${key}:fx${frame}`, { class: fx }] : [key, {}];
}

/** Полноэкранная плашка главы: надзаголовок и вопрос. */
export function plate(pen: Pen, key: string, head: string, question: string, stage: { w: number; h: number }): void {
  pen.group(key, 0, 0, () => {
    pen.rect(`${key}:bg`, { x: 0, y: 0, width: stage.w, height: stage.h, fill: COLOR.bg, opacity: 0.96 });
    pen.text(`${key}:head`, {
      x: stage.w / 2, y: stage.h / 2 - 50, "font-size": SIZE.title, "font-family": FONT.sans, "font-weight": 600,
      fill: COLOR.muted, "text-anchor": "middle", "letter-spacing": 6,
    }, head.toUpperCase());
    pen.text(`${key}:q`, {
      x: stage.w / 2, y: stage.h / 2 + 30, "font-size": SIZE.plate, "font-family": FONT.sans, "font-weight": 700,
      fill: COLOR.ink, "text-anchor": "middle", class: "fx-rise",
    }, question);
  }, { class: "fx-fade" });
}

/**
 * Шкала нагрузки: доля 0…1+ (больше 1 — «за край», красным с выступом); зелёная до 0.6, жёлтая до 0.9.
 * (x, y) — левый верхний угол, w×h — размер дорожки.
 */
export function meter(pen: Pen, key: string, o: { x: number; y: number; w: number; h?: number; load: number; attrs?: Attrs }): void {
  const h = o.h ?? 10;
  const level = Math.max(0, o.load);
  const fill = level > 0.9 ? COLOR.error : level > 0.6 ? COLOR.warn : COLOR.ok;
  const over = level > 1;
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:track`, { width: o.w, height: h, rx: h / 2, fill: COLOR.bg2, stroke: COLOR.line, "stroke-width": 1 });
    if (level > 0) pen.rect(`${key}:bar`, { width: Math.max(h, o.w * Math.min(1, level)), height: h, rx: h / 2, fill });
    // За край: выступ за дорожку — «не помещается».
    if (over) pen.rect(`${key}:over`, { x: o.w - 2, y: -3, width: 14, height: h + 6, rx: 3, fill: COLOR.error });
  }, o.attrs);
}
