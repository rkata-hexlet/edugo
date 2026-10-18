import { LAYERS, LINE_HEIGHT, type Attrs, type Layer, type Pen, type Span, type TextContent, type Transform } from "./contract";

const NS = "http://www.w3.org/2000/svg";

/** Сколько гаснет элемент, которого нет в новом кадре; в CSS приходит переменной `--leave-ms`. */
export const LEAVE_MS = 300;

/** Средняя ширина символа в долях кегля — когда браузер не умеет мерить текст (тесты). */
const CHAR_EM = 0.6;

/**
 * Pen поверх SVG: переиспользует узлы по ключу, порядок наложения = слой + порядок рисования,
 * не нарисованные в кадре узлы гаснут и удаляются.
 */
export class SvgPen implements Pen {
  private nodes = new Map<string, SVGElement>();
  private attrNames = new Map<string, string[]>();
  private texts = new Map<string, string>();
  private used = new Set<string>();
  /** Узлы, уже нарисованные в этом кадре. */
  private drawn = new Set<Element>();
  /** Последний узел, поставленный в этом кадре в каждого родителя: следующий встаёт сразу за ним. */
  private placed = new Map<Element, Element>();
  private layers: Record<Layer, SVGGElement>;
  private leaving = new Set<SVGElement>();
  private parent: SVGElement;
  private ruler?: SVGTextElement;
  private instant = false;
  private measured = new Map<string, { width: number; height: number }>();

  constructor(private root: SVGSVGElement) {
    this.layers = Object.fromEntries(
      LAYERS.map((name) => {
        const g = document.createElementNS(NS, "g") as SVGGElement;
        g.dataset.layer = name;
        root.appendChild(g);
        return [name, g];
      }),
    ) as Record<Layer, SVGGElement>;
    this.parent = this.layers.main;
  }

  /**
   * Нарисовать кадр. `instant` — перемотка, прыжок по актам: без переходов, анимаций и угасания.
   * Переходы гасит класс `.no-anim` на время кадра (снимаем после принудительного пересчёта стилей —
   * тогда изменения уже применены и переход не запустится); новым узлам — `animation: none` навсегда,
   * иначе их анимация стартовала бы в момент снятия класса.
   */
  frame(draw: () => void, { instant = false } = {}): void {
    this.used.clear();
    this.drawn.clear();
    this.placed.clear();
    this.parent = this.layers.main;
    this.instant = instant;
    if (instant) {
      for (const node of this.leaving) node.remove();
      this.leaving.clear();
      this.root.classList.add("no-anim");
    }
    draw();
    const gone = [...this.nodes].filter(([key]) => !this.used.has(key));
    const goneNodes = new Set(gone.map(([, node]) => node));
    for (const [key, node] of gone) {
      this.nodes.delete(key);
      this.attrNames.delete(key);
      this.texts.delete(key);
      // Ребёнок ушедшей группы уходит вместе с ней.
      if (goneNodes.has(node.parentNode as SVGElement)) continue;
      if (instant) node.remove();
      else this.leave(node);
    }
    if (instant) {
      this.root.getBoundingClientRect(); // пересчитать стили, пока переходы выключены
      this.root.classList.remove("no-anim");
    }
  }

  /** Ключ свободен сразу: если его нарисуют снова, это будет новый узел, а старый догаснет. */
  private leave(node: SVGElement): void {
    this.leaving.add(node);
    node.style.setProperty("--leave-ms", `${LEAVE_MS}ms`);
    node.classList.add("leaving");
    setTimeout(() => {
      if (!this.leaving.delete(node)) return; // уже убран перемоткой
      node.remove();
    }, LEAVE_MS);
  }

  rect(key: string, attrs: Attrs): void {
    this.apply(key, this.node(key, "rect"), attrs);
  }

  text(key: string, attrs: Attrs, content: TextContent): void {
    const node = this.node(key, "text");
    this.apply(key, node, attrs);
    const sig = JSON.stringify([content, attrs.x ?? 0]);
    if (this.texts.get(key) === sig) return;
    this.texts.set(key, sig);
    fillText(node, attrs, content);
  }

  line(key: string, attrs: Attrs): void {
    this.apply(key, this.node(key, "line"), this.withArrow(attrs));
  }

  path(key: string, attrs: Attrs): void {
    this.apply(key, this.node(key, "path"), { fill: "none", ...this.withArrow(attrs) });
  }

  private withArrow(attrs: Attrs): Attrs {
    const { marker, ...rest } = attrs;
    return marker === "arrow" ? { ...rest, "marker-end": `url(#${this.arrowHead(String(rest.stroke ?? "#000"))})` } : rest;
  }

  /** Наконечник стрелки своего цвета: один <marker> на цвет на весь SVG. */
  private arrowHead(color: string): string {
    const id = `arrow-${color.replace(/[^a-z0-9]/gi, "")}`;
    if (this.root.querySelector(`#${id}`)) return id;
    let defs = this.root.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(NS, "defs");
      this.root.prepend(defs);
    }
    defs.insertAdjacentHTML(
      "beforeend",
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`,
    );
    return id;
  }

  group(key: string, x: number, y: number, children: () => void, attrs: Attrs = {}, transform: Transform = {}): void {
    const node = this.node(key, "g");
    this.apply(key, node, attrs);
    node.classList.add("mv");
    node.style.transform = cssTransform(x, y, transform);
    this.inside(node, children);
  }

  layer(layer: Layer, children: () => void): void {
    this.inside(this.layers[layer], children);
  }

  measure(content: TextContent, attrs: Attrs): { width: number; height: number } {
    const sig = JSON.stringify([content, attrs]);
    const cached = this.measured.get(sig);
    if (cached) return cached;
    const size = Number(attrs["font-size"] ?? 16);
    const lines = toLines(content);
    // Строка высотой в самый крупный кусок; межстрочный интервал — от кегля текста, как у `text`.
    const tallest = (line: Span[]) => Math.max(size, ...line.map((s) => Number(s.attrs?.["font-size"] ?? size)));
    const height = tallest(lines[0]) + lines.slice(1).reduce((h, line) => h + Math.max(size * LINE_HEIGHT, tallest(line)), 0);
    if (!this.ruler) {
      this.ruler = document.createElementNS(NS, "text") as SVGTextElement;
      this.root.appendChild(this.ruler);
    }
    const ruler = this.ruler;
    for (const [name, value] of Object.entries(attrs)) ruler.setAttribute(name, String(value));
    ruler.setAttribute("visibility", "hidden");
    let width = 0;
    for (const line of lines) {
      ruler.textContent = "";
      for (const span of line) ruler.appendChild(spanNode(span));
      const measured = typeof ruler.getComputedTextLength === "function" ? ruler.getComputedTextLength() : 0;
      const estimate = line.reduce((n, s) => n + s.text.length * Number(s.attrs?.["font-size"] ?? size), 0) * CHAR_EM;
      width = Math.max(width, measured || estimate);
    }
    ruler.textContent = "";
    for (const name of Object.keys(attrs)) ruler.removeAttribute(name);
    ruler.setAttribute("visibility", "hidden");
    const result = { width, height };
    this.measured.set(sig, result);
    return result;
  }

  private inside(parent: SVGElement, children: () => void): void {
    const outer = this.parent;
    this.parent = parent;
    children();
    this.parent = outer;
  }

  /** Узел по ключу, поставленный за предыдущим нарисованным в том же родителе. */
  private node(key: string, tag: string): SVGElement {
    if (this.used.has(key)) throw new Error(`pen: ключ «${key}» нарисован дважды за кадр`);
    this.used.add(key);
    let node = this.nodes.get(key);
    if (!node || node.tagName !== tag) {
      node?.remove();
      node = document.createElementNS(NS, tag) as SVGElement;
      if (this.instant) node.style.animation = "none";
      this.nodes.set(key, node);
      this.attrNames.delete(key);
      this.texts.delete(key);
    }
    const parent = this.parent;
    const before = this.placed.get(parent);
    // Ещё не нарисованных в кадре соседей пропускаем: нарисованные позже встанут на место сами,
    // а уходящие и гаснущие останутся где были, а не всплывут над всеми.
    this.drawn.add(node);
    let ref = before ? before.nextSibling : parent.firstChild;
    while (ref && ref !== node && !this.drawn.has(ref as Element)) ref = ref.nextSibling;
    if (node !== ref) place(parent, node, ref);
    this.placed.set(parent, node);
    return node;
  }

  private apply(key: string, node: SVGElement, attrs: Attrs): void {
    for (const name of this.attrNames.get(key) ?? []) {
      if (!(name in attrs)) node.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    this.attrNames.set(key, Object.keys(attrs));
  }
}

/** Переставить узел, не сбивая его CSS-переходы: `moveBefore` (Chrome 133+), иначе обычная вставка. */
function place(parent: Element, node: Element, ref: Node | null): void {
  const move = (parent as Element & { moveBefore?: (n: Node, r: Node | null) => void }).moveBefore;
  if (move && node.isConnected && node.ownerDocument === parent.ownerDocument) {
    try {
      return move.call(parent, node, ref);
    } catch {
      // старый родитель вне документа и т.п. — вставляем обычным способом
    }
  }
  parent.insertBefore(node, ref);
}

/** Всегда один и тот же список функций: тогда CSS-переход интерполирует каждую, а не матрицу целиком. */
function cssTransform(x: number, y: number, { rotate = 0, scale = 1, origin: [ox, oy] = [0, 0] }: Transform): string {
  return `translate(${x}px, ${y}px) translate(${ox}px, ${oy}px) rotate(${rotate}deg) scale(${scale}) translate(${-ox}px, ${-oy}px)`;
}

/** Текст → строки из кусков; `\n` внутри куска рвёт строку, атрибуты куска переходят на обе части. */
function toLines(content: TextContent): Span[][] {
  const spans = typeof content === "string" ? [{ text: content }] : content;
  const lines: Span[][] = [[]];
  for (const span of spans) {
    span.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines.at(-1)!.push({ ...span, text: part });
    });
  }
  return lines;
}

function spanNode(span: Span): SVGTSpanElement {
  const node = document.createElementNS(NS, "tspan") as SVGTSpanElement;
  for (const [name, value] of Object.entries(span.attrs ?? {})) node.setAttribute(name, String(value));
  node.textContent = span.text;
  return node;
}

function fillText(node: SVGElement, attrs: Attrs, content: TextContent): void {
  node.textContent = "";
  toLines(content).forEach((line, i) => {
    const row = document.createElementNS(NS, "tspan");
    row.setAttribute("x", String(attrs.x ?? 0));
    if (i > 0) row.setAttribute("dy", `${LINE_HEIGHT}em`);
    if (line.length === 0) row.textContent = " ";
    else if (line.length === 1 && !line[0].attrs) row.textContent = line[0].text;
    else for (const span of line) row.appendChild(spanNode(span));
    node.appendChild(row);
  });
}
