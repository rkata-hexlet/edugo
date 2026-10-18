import type { Attrs, Pen } from "./contract";

const NS = "http://www.w3.org/2000/svg";

/** Pen поверх SVG: переиспользует узлы по ключу, удаляет не нарисованные в кадре. */
export class SvgPen implements Pen {
  private nodes = new Map<string, SVGElement>();
  private attrNames = new Map<string, string[]>();
  private texts = new Map<string, string>();
  private used = new Set<string>();
  private parent: SVGElement;

  constructor(private root: SVGSVGElement) {
    this.parent = root;
  }

  frame(draw: () => void): void {
    this.used.clear();
    this.parent = this.root;
    draw();
    for (const [key, node] of this.nodes) {
      if (this.used.has(key)) continue;
      node.remove();
      this.nodes.delete(key);
      this.attrNames.delete(key);
      this.texts.delete(key);
    }
  }

  rect(key: string, attrs: Attrs): void {
    this.apply(key, this.node(key, "rect"), attrs);
  }

  text(key: string, attrs: Attrs, content: string): void {
    const node = this.node(key, "text");
    this.apply(key, node, attrs);
    if (this.texts.get(key) === content) return;
    this.texts.set(key, content);
    node.textContent = "";
    content.split("\n").forEach((line, i) => {
      const span = document.createElementNS(NS, "tspan");
      span.setAttribute("x", String(attrs.x ?? 0));
      if (i > 0) span.setAttribute("dy", "1.3em");
      span.textContent = line || " ";
      node.appendChild(span);
    });
  }

  line(key: string, attrs: Attrs): void {
    const { marker, ...rest } = attrs;
    const line = marker === "arrow" ? { ...rest, "marker-end": `url(#${this.arrowHead(String(rest.stroke ?? "#000"))})` } : rest;
    this.apply(key, this.node(key, "line"), line);
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

  group(key: string, x: number, y: number, children: () => void): void {
    const node = this.node(key, "g");
    node.classList.add("mv");
    node.style.transform = `translate(${x}px, ${y}px)`;
    const outer = this.parent;
    this.parent = node;
    children();
    this.parent = outer;
  }

  private node(key: string, tag: string): SVGElement {
    if (this.used.has(key)) throw new Error(`pen: ключ «${key}» нарисован дважды за кадр`);
    this.used.add(key);
    let node = this.nodes.get(key);
    if (!node || node.tagName !== tag) {
      node?.remove();
      node = document.createElementNS(NS, tag) as SVGElement;
      this.nodes.set(key, node);
      this.attrNames.delete(key);
      this.texts.delete(key);
      this.parent.appendChild(node);
    } else if (node.parentNode !== this.parent) {
      this.parent.appendChild(node);
    }
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
