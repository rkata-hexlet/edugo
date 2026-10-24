import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import { BABBLE_AT, EVENT_WINDOW, MAX_SOUNDS, score, sound } from "./sound";

function recorder() {
  const calls: { kind: "tone" | "noise" | "babble"; at: number; gain: number }[] = [];
  const s: Sound = {
    tone: (o) => calls.push({ kind: "tone", at: o.at ?? 0, gain: o.gain ?? 0 }),
    noise: (o) => calls.push({ kind: "noise", at: o.at ?? 0, gain: o.gain ?? 0 }),
    babble: (v: Voice, _t: string, at = 0) => calls.push({ kind: "babble", at, gain: v.gain }),
  };
  return { s, calls };
}

const steps = buildSteps();

describe("озвучка эпизода 08", () => {
  it(`звуки событий начинаются в первые ${EVENT_WINDOW} с, бормотание — с ${BABBLE_AT} с, громкость ≤ 0.2`, () => {
    for (const [i, step] of steps.entries()) {
      const { s, calls } = recorder();
      sound(s, step.state, step.state.replay);
      for (const c of calls) {
        if (c.kind === "babble") expect(c.at, `кадр ${i + 1}`).toBeGreaterThanOrEqual(BABBLE_AT);
        else {
          expect(c.at, `кадр ${i + 1}`).toBeLessThanOrEqual(EVENT_WINDOW);
          expect(c.gain, `кадр ${i + 1}`).toBeLessThanOrEqual(0.2);
        }
      }
    }
  });

  it(`не больше ${MAX_SOUNDS} звуков в кадре; итог — повтор`, () => {
    for (const step of steps) expect(score(step.state, step.state.replay).length).toBeLessThanOrEqual(MAX_SOUNDS);
    expect(steps.filter((x) => x.act === ACT.summary).every((x) => x.state.replay)).toBe(true);
  });

  it("второе списание звучит в хуке, в 1.1 и в 2.2 — рифма образа", () => {
    for (const act of [ACT.hook, ACT.check, ACT.lease]) {
      expect(steps.some((s) => s.act === act && score(s.state).some((e) => e.kind === "double")), act).toBe(true);
    }
  });
});
