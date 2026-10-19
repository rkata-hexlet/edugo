// Помощник тестов отрисовки: Pen, который копит текст и прямоугольники вместо DOM.
import type { Attrs, Pen, TextContent } from "./contract";

/** Фейковый Pen: копит текст и прямоугольники в координатах сцены (сдвиги групп складываются). */
export class RecordingPen implements Pen {
  texts: { key: string; x: number; y: number; size: number; content: string }[] = [];
  rects: { key: string; bottom: number; attrs: Attrs }[] = [];
  private offset: [number, number][] = [[0, 0]];
  private at = () => this.offset.at(-1)!;

  rect(key: string, attrs: Attrs): void {
    this.rects.push({ key, bottom: this.at()[1] + Number(attrs.y ?? 0) + Number(attrs.height ?? 0), attrs });
  }
  text(key: string, attrs: Attrs, content: TextContent): void {
    const text = typeof content === "string" ? content : content.map((s) => s.text).join("");
    const lines = text.split("\n").length;
    const size = Number(attrs["font-size"]);
    this.texts.push({ key, x: this.at()[0] + Number(attrs.x ?? 0), y: this.at()[1] + Number(attrs.y ?? 0) + (lines - 1) * size * 1.3, size, content: text });
    this.check(key, attrs);
  }
  line(key: string, attrs: Attrs): void {
    this.check(key, attrs);
  }
  path(key: string, attrs: Attrs): void {
    this.check(key, attrs);
  }
  group(key: string, x: number, y: number, children: () => void, attrs: Attrs = {}): void {
    this.check(key, attrs);
    const [ox, oy] = this.at();
    this.offset.push([ox + x, oy + y]);
    children();
    this.offset.pop();
  }
  layer(_: string, children: () => void): void {
    this.offset.push([0, 0]);
    children();
    this.offset.pop();
  }
  measure(content: TextContent, attrs: Attrs) {
    const text = typeof content === "string" ? content : content.map((s) => s.text).join("");
    const lines = text.split("\n");
    const size = Number(attrs["font-size"] ?? 16);
    return { width: Math.max(...lines.map((l) => l.length)) * size * 0.6, height: size * (1 + 1.3 * (lines.length - 1)) };
  }
  private check(key: string, attrs: Attrs): void {
    for (const [name, value] of Object.entries(attrs)) {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${key}.${name} = ${value}`);
      if (typeof value === "string" && /NaN|undefined/.test(value)) throw new Error(`${key}.${name} = ${value}`);
    }
  }
}
