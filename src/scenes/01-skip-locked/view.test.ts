import { describe, expect, it } from "vitest";
import { RecordingPen } from "../../engine/recording-pen";
import { SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { buildSteps } from "./script";
import { render } from "./view";

const frames = buildSteps().map((step, i) => {
  const pen = new RecordingPen();
  render(pen, step.state);
  return { n: i + 1, pen };
});

describe("отрисовка эпизода 01 (все кадры)", () => {
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

  it("штамп перемотки помещается в просвет шапки между Postgres и пилюлями кейса", () => {
    const wide = frames.flatMap(({ n, pen }) => {
      const t = pen.texts.find((x) => x.key === "stamp:t");
      if (!t) return [];
      const right = t.x + pen.measure(t.content, { "font-size": t.size }).width + 16;
      return right > 700 - 12 ? [`кадр ${n}: правый край ${Math.round(right)}`] : [];
    });
    expect(wide).toEqual([]);
  });

  it("текст не выходит за правый край кадра", () => {
    const wide = frames.flatMap(({ n, pen }) =>
      pen.texts.filter((t) => t.x > 1280).map((t) => `кадр ${n}: ${t.key} x=${t.x}`));
    expect(wide).toEqual([]);
  });
  it("счётчик «осталось» — только где голос о том же: 0 в финале SKIP LOCKED, 1 при застрявшей задаче", () => {
    const shown = frames.flatMap(({ n, pen }) => {
      const t = pen.texts.find((x) => x.key === "left:t");
      return t ? [`${n}: ${t.content}`] : [];
    });
    expect(shown).toEqual([
      "25: осталось 0 из 6",
      ...[28, 29].map((n) => `${n}: осталось 1 из 6`),
      ...[32, 33, 34].map((n) => `${n}: осталось 1 из 6`),
    ]);
  });
});
