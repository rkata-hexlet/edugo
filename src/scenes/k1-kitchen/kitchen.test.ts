import { describe, expect, it } from "vitest";
import type { Attrs, Pen, TextContent } from "../../engine/contract";
import { SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { ACT, DIRECTOR_LINES, buildSteps } from "./script";
import { CREW } from "./sim";
import { render } from "./view";

/** Фейковый Pen: копит текст и прямоугольники в координатах сцены (сдвиги групп складываются). */
class RecordingPen implements Pen {
  texts: { key: string; x: number; y: number; size: number; content: string }[] = [];
  rects: { key: string; bottom: number }[] = [];
  private offset: [number, number][] = [[0, 0]];
  private at = () => this.offset.at(-1)!;

  rect(key: string, attrs: Attrs): void {
    this.check(key, attrs);
    this.rects.push({ key, bottom: this.at()[1] + Number(attrs.y ?? 0) + Number(attrs.height ?? 0) });
  }
  text(key: string, attrs: Attrs, content: TextContent): void {
    const text = typeof content === "string" ? content : content.map((s) => s.text).join("");
    const size = Number(attrs["font-size"]);
    const lines = text.split("\n").length;
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

const steps = buildSteps();
const frames = steps.map((step, i) => {
  const pen = new RecordingPen();
  render(pen, step.state);
  return { n: i + 1, pen };
});

describe("сценарий кухни", () => {
  it("голосом звучат только реплики режиссёра, и каждая — в его пузыре", () => {
    const voiced = steps.filter((s) => s.narration);
    expect(voiced.map((s) => s.narration)).toEqual(["Забудь.", "На площадку.", "Ещё раз."]);
    expect(new Set(voiced.map((s) => s.narration))).toEqual(new Set(DIRECTOR_LINES));
    for (const s of voiced) expect(s.state.crew.director.say).toBe(s.narration);
  });

  it("«дубль» — только съёмочный: в тексте про письма его нет", () => {
    const texts = steps.flatMap((s) => [s.caption, ...CREW.map((k) => s.state.crew[k].say ?? ""), ...(s.state.art?.lines ?? [])]);
    expect(texts.filter((t) => /письм/i.test(t) && /дубл/i.test(t))).toEqual([]);
  });

  it("каждая сцена с 1-й по 7-ю открывается хлопушкой", () => {
    const acts = [ACT.s1, ACT.s2, ACT.s3, ACT.s4, ACT.s5, ACT.s6, ACT.s7];
    // Сцену 1 открывает хлопушка в конце готового трюка — рифма «Сцена 1, дубль 1 — СТОП!».
    const opened = acts.filter((act) => {
      const i = steps.findIndex((s) => s.act === act);
      return steps[i].state.clap || steps[i - 1].state.clap;
    });
    expect(opened).toEqual(acts);
  });

  it("счётчик сорванных дублей растёт на единицу и доходит до числа в титрах", () => {
    const shown = steps.filter((s) => s.state.failsShown).map((s) => s.state.fails);
    expect(shown).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.at(-1)!.state.credits ?? steps.at(-2)!.state.credits).toContain("6 сорванных дублей");
  });

  it("каскадёр кланяется последним", () => {
    const bowAt = (k: (typeof CREW)[number]) => steps.findIndex((s) => s.state.crew[k].bow);
    const others = CREW.filter((k) => k !== "stunt").map(bowAt);
    expect(Math.min(...others)).toBeGreaterThan(0);
    expect(bowAt("stunt")).toBeGreaterThan(Math.max(...others));
  });
});

describe("отрисовка кухни (все кадры)", () => {
  it(`кегль не меньше ${SIZE.min}`, () => {
    const small = frames.flatMap(({ n, pen }) => pen.texts.filter((t) => !(t.size >= SIZE.min)).map((t) => `кадр ${n}: ${t.key} ${t.size}`));
    expect(small).toEqual([]);
  });

  it("низ кадра свободен под подпись плеера", () => {
    const low = frames.flatMap(({ n, pen }) => [
      ...pen.texts.filter((t) => t.y > SAFE_BOTTOM).map((t) => `кадр ${n}: ${t.key} y=${t.y}`),
      ...pen.rects.filter((r) => r.bottom > SAFE_BOTTOM && r.key !== "bg" && r.key !== "title:bg").map((r) => `кадр ${n}: ${r.key} низ=${r.bottom}`),
    ]);
    expect(low).toEqual([]);
  });

  it("текст не выходит за края кадра", () => {
    const out = frames.flatMap(({ n, pen }) =>
      pen.texts.filter((t) => t.x < 0 || t.x > 1280).map((t) => `кадр ${n}: ${t.key} x=${t.x}`));
    expect(out).toEqual([]);
  });

  it("эмодзи в кадре нет", () => {
    const emoji = frames.flatMap(({ n, pen }) =>
      pen.texts.filter((t) => /\p{Extended_Pictographic}/u.test(t.content)).map((t) => `кадр ${n}: ${t.key}`));
    expect(emoji).toEqual([]);
  });
});
