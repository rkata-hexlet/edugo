import { describe, expect, it } from "vitest";
import { phrases } from "../../engine/narrator";
import { RecordingPen } from "../../engine/recording-pen";
import { SAFE_BOTTOM, SIZE } from "../../kit/theme";
import { duplicates } from "../01-skip-locked/sim";
import { buildSteps } from "./script";
import { render } from "./view";

const steps = buildSteps();
const frames = steps.map((step, i) => {
  const pen = new RecordingPen();
  render(pen, step.state);
  return { n: i + 1, pen };
});
/** Кадр по началу закадра: номера сдвигаются при правках сценария. */
const at = (start: string) => steps.find((s) => s.narration?.startsWith(start))!.state;

describe("«Алиса» (эксперимент 01a): сцена не врёт", () => {
  it("зомби: отметка Пятёрки не прошла, роз две при одном отмеченном кусте", () => {
    const w = at("Следом с того же куста");
    expect(w.rows[0].status).toBe("done");
    expect(w.letters.filter((l) => !l.replayed).map((l) => l.by)).toEqual(["B", "C"]);
    expect(duplicates(w)).toEqual([1]);
    expect(w.clash).toEqual({ row: 1, by: "B" });
  });

  it("перехват: на кусте новая бирка, у спящей Пятёрки в руке — старая", () => {
    const w = at("И только когда за работой");
    expect(w.actors.C.token).toBe(w.rows[0].token);
    expect(w.actors.B.token).not.toBe(w.rows[0].token);
    expect(w.actors.B.frozen).toBe(true);
  });

  it("номер куста на розе: вторая роза вернулась с прежним ответом, дублей нет", () => {
    const w = at("Роза Семёрки тоже доходит");
    expect(w.letters.map((l) => l.replayed)).toEqual([false, true]);
    expect(duplicates(w)).toEqual([]);
  });
});

describe("«Алиса»: правила серии", () => {
  it(`кегль не меньше ${SIZE.min}`, () => {
    expect(frames.flatMap(({ n, pen }) => pen.texts.filter((t) => !(t.size >= SIZE.min)).map((t) => `кадр ${n}: ${t.key}`))).toEqual([]);
  });

  it("низ кадра свободен под субтитры", () => {
    expect(frames.flatMap(({ n, pen }) => [
      ...pen.texts.filter((t) => t.y > SAFE_BOTTOM).map((t) => `кадр ${n}: ${t.key}`),
      ...pen.rects.filter((r) => r.bottom > SAFE_BOTTOM && r.key !== "bg").map((r) => `кадр ${n}: ${r.key}`),
    ])).toEqual([]);
  });

  it("закадр: не больше одного тире на кадр, субтитр режется на куски", () => {
    for (const s of steps) {
      expect((s.narration!.match(/ — /g) ?? []).length, s.narration).toBeLessThanOrEqual(1);
      expect(phrases(s.narration!).length).toBeGreaterThan(0);
    }
  });
});
