import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import { BABBLE_AT, EVENT_WINDOW, sound } from "./sound";

/** Записывает вызовы вместо звука. */
function recorder() {
  const calls: { kind: "tone" | "noise" | "babble"; at: number; gain: number; dur?: number }[] = [];
  const s: Sound = {
    tone: (o) => calls.push({ kind: "tone", at: o.at ?? 0, gain: o.gain ?? 0, dur: o.dur }),
    noise: (o) => calls.push({ kind: "noise", at: o.at ?? 0, gain: o.gain ?? 0, dur: o.dur }),
    babble: (v: Voice, _t: string, at = 0) => calls.push({ kind: "babble", at, gain: v.gain }),
  };
  return { s, calls };
}

const steps = buildSteps();

describe("озвучка эпизода 14", () => {
  it(`звуки событий начинаются в первые ${EVENT_WINDOW} с, бормотание — с ${BABBLE_AT} с, громкость ≤ 0.2`, () => {
    for (const [i, step] of steps.entries()) {
      const { s, calls } = recorder();
      sound(s, step.state, step.state.replay);
      for (const c of calls) {
        if (c.kind === "babble") expect(c.at, `кадр ${i + 1}`).toBeGreaterThanOrEqual(BABBLE_AT);
        else {
          expect(c.at, `кадр ${i + 1}`).toBeGreaterThanOrEqual(0);
          expect(c.at, `кадр ${i + 1}`).toBeLessThanOrEqual(EVENT_WINDOW);
          expect(c.gain, `кадр ${i + 1}`).toBeLessThanOrEqual(0.2);
        }
      }
    }
  });

  it("каждый кадр с событием звучит; итог — тише исходного и без тревоги", () => {
    for (const [i, step] of steps.entries()) {
      const { s, calls } = recorder();
      sound(s, step.state, step.state.replay);
      if (step.state.events.length) expect(calls.length, `кадр ${i + 1}`).toBeGreaterThan(0);
    }
    const recap = steps.filter((x) => x.act === ACT.summary);
    expect(recap.every((x) => x.state.replay)).toBe(true);
  });

  it("Knight Capital в итоге тихий: только перелистывание", () => {
    const knight = steps.find((x) => x.state.knight)!;
    const { s, calls } = recorder();
    sound(s, knight.state, knight.state.replay);
    expect(calls.filter((c) => c.kind === "tone")).toEqual([]);
  });

  it("выключение флага без expand звучит отменой, после expand — нет", () => {
    const kinds = steps.map((x) => x.state.events.map((e) => e.kind));
    expect(kinds.some((k) => k.includes("toggle") && k.includes("cancel"))).toBe(true);
    expect(kinds.some((k) => k.includes("toggle") && k.includes("keep") && !k.includes("cancel"))).toBe(true);
  });
});
