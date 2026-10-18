import { describe, expect, it } from "vitest";
import { COVER_S, OUTRO_S, frameAt, frameSeconds, timeline } from "./timeline";

const step = (narration?: string, hold?: number) => ({ act: "a", caption: "", state: null, hold, narration });

describe("шкала записи", () => {
  it("кадр длится дольше из своего времени и голоса диктора", () => {
    expect(frameSeconds(step(undefined, 3))).toBe(3);
    // 10 слов при 2.5 слова/с = 4 с + 0.5 до голоса + 0.7 после.
    expect(frameSeconds(step("раз два три четыре пять шесть семь восемь девять десять", 2))).toBeCloseTo(5.2);
  });

  it("обложка, кадры подряд, финальная карточка", () => {
    const tl = timeline([step(undefined, 2), step(undefined, 3)]);
    expect(tl.starts).toEqual([COVER_S, COVER_S + 2]);
    expect(tl.end).toBe(COVER_S + 5);
    expect(tl.total).toBe(COVER_S + 5 + OUTRO_S);
  });

  it("кадр в момент t — последний начавшийся", () => {
    const starts = [2.5, 4.5, 7.5];
    expect(frameAt(starts, 2.5)).toBe(0);
    expect(frameAt(starts, 4.49)).toBe(0);
    expect(frameAt(starts, 4.5)).toBe(1);
    expect(frameAt(starts, 100)).toBe(2);
  });
});
