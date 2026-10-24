import { describe, expect, it } from "vitest";
import type { Attrs, Pen, TextContent } from "../../engine/contract";
import { SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { buildSteps } from "./script";
import { HEADER_RIGHT, render } from "./view";

/** Фейковый Pen: копит текст и прямоугольники в координатах сцены (сдвиги групп складываются). */
class RecordingPen implements Pen {
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

const frames = buildSteps().map((step, i) => {
  const pen = new RecordingPen();
  render(pen, step.state);
  return { n: i + 1, pen };
});

describe("отрисовка эпизода 08 (все кадры)", () => {
  it(`кегль не меньше ${SIZE.min}: не влезает — убрать, а не уменьшить`, () => {
    const small = frames.flatMap(({ n, pen }) => pen.texts.filter((t) => !(t.size >= SIZE.min)).map((t) => `кадр ${n}: ${t.key} ${t.size}`));
    expect(small).toEqual([]);
  });

  it("низ кадра свободен под подпись и субтитры плеера", () => {
    const low = frames.flatMap(({ n, pen }) => [
      ...pen.texts.filter((t) => t.y > SAFE_BOTTOM).map((t) => `кадр ${n}: ${t.key} y=${t.y}`),
      // Фон сцены и полноэкранная плашка — во весь кадр по замыслу.
      ...pen.rects.filter((r) => r.bottom > SAFE_BOTTOM && r.key !== "bg" && !r.key.startsWith("plate:")).map((r) => `кадр ${n}: ${r.key} низ=${r.bottom}`),
    ]);
    expect(low).toEqual([]);
  });

  it("эмодзи в кадре нет — только иконки kit (эмодзи разные на каждой платформе)", () => {
    const emoji = frames.flatMap(({ n, pen }) =>
      pen.texts.filter((t) => /\p{Extended_Pictographic}/u.test(t.content)).map((t) => `кадр ${n}: ${t.key} «${t.content}»`));
    expect(emoji).toEqual([]);
  });

  it("штамп перемотки и реплика Postgres не встречаются в одном кадре: оба живут в шапке", () => {
    const both = buildSteps().flatMap((s, i) => (s.state.stamp && s.state.db ? [i + 1] : []));
    expect(both).toEqual([]);
  });

  it("штамп перемотки помещается в просвет шапки между Postgres и значком кейса", () => {
    const wide = frames.flatMap(({ n, pen }) => {
      const t = pen.texts.find((x) => x.key === "stamp:t");
      if (!t) return [];
      const right = t.x + pen.measure(t.content, { "font-size": t.size }).width + 16;
      return right > HEADER_RIGHT ? [`кадр ${n}: правый край ${Math.round(right)}`] : [];
    });
    expect(wide).toEqual([]);
  });

  
  it("текст не выходит за правый край кадра", () => {
    const wide = frames.flatMap(({ n, pen }) =>
      pen.texts.filter((t) => t.x > 1280).map((t) => `кадр ${n}: ${t.key} x=${t.x}`));
    expect(wide).toEqual([]);
  });
  it("пузырь реплики Postgres не наезжает на значок кейса", () => {
    const over = frames.flatMap(({ n, pen }) => {
      const t = pen.texts.find((x) => x.key === "db:say:t");
      if (!t || !pen.texts.some((x) => x.key === "chapter:t")) return [];
      const right = t.x + pen.measure(t.content, { "font-size": t.size }).width + 16;
      return right > HEADER_RIGHT ? [`кадр ${n}: правый край ${Math.round(right)}`] : [];
    });
    expect(over).toEqual([]);
  });
});
