import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import { BABBLE_AT, EVENT_WINDOW, MAX_SOUNDS, score, sound } from "./sound";

function recorder() {
  const calls: { kind: "tone" | "noise" | "babble"; at: number; gain: number; wave?: string }[] = [];
  const s: Sound = {
    tone: (o) => calls.push({ kind: "tone", at: o.at ?? 0, gain: o.gain ?? 0, wave: o.wave }),
    noise: (o) => calls.push({ kind: "noise", at: o.at ?? 0, gain: o.gain ?? 0 }),
    babble: (v: Voice, _t: string, at = 0) => calls.push({ kind: "babble", at, gain: v.gain }),
  };
  return { s, calls };
}

const steps = buildSteps();
const kindsOf = (i: number) => score(steps[i].state, steps[i].state.replay).map((e) => e.kind);
const at = (act: string, kind: string) => steps.findIndex((x) => x.act === act && x.state.events.some((e) => e.kind === kind));

describe("озвучка эпизода 07", () => {
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

  it("каждый кадр с событием звучит; итог — повтор", () => {
    for (const [i, step] of steps.entries()) {
      const { s, calls } = recorder();
      sound(s, step.state, step.state.replay);
      if (step.state.events.length) expect(calls.length, `кадр ${i + 1}`).toBeGreaterThan(0);
    }
    expect(steps.filter((x) => x.act === ACT.summary).every((x) => x.state.replay)).toBe(true);
  });

  it(`не больше ${MAX_SOUNDS} звуков в кадре`, () => {
    for (const step of steps) expect(score(step.state, step.state.replay).length).toBeLessThanOrEqual(MAX_SOUNDS);
  });

  it("кольцо замкнулось — звучит лязг вместо щелчков ожидания", () => {
    const k = kindsOf(at(ACT.hook, "ring"));
    expect(k).toContain("ring");
    expect(k).not.toContain("wait");
  });

  it("развязка хука: секунда, детектор, «бзз» 40P01 громче всего, отказ Борису и «динь» Ане", () => {
    const i = at(ACT.hook, "fail");
    expect(kindsOf(i)).toEqual(["tick", "detect", "fail", "refused", "ok"]);
    const { s, calls } = recorder();
    sound(s, steps[i].state);
    expect(calls.some((c) => c.wave === "square" && c.gain >= 0.13)).toBe(true);
  });
});
