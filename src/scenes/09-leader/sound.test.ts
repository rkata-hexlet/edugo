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

describe("озвучка эпизода 09", () => {
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

  it("дубль звучит в хуке, в 2.2 и в 2.3 — рифма образа", () => {
    for (const act of [ACT.hook, ACT.split, ACT.check]) {
      expect(steps.some((s) => s.act === act && score(s.state).some((e) => e.kind === "double")), act).toBe(true);
    }
  });

  it("три уведомления утром звучат трижды — рифма с тремя письмами; в финале — одно", () => {
    const morning = steps.find((s) => s.act === ACT.hook && s.state.events.some((e) => e.kind === "note"))!;
    expect(score(morning.state).filter((e) => e.kind === "note")).toHaveLength(3);
    const last = steps.at(-1)!;
    expect(score(last.state, true).filter((e) => e.kind === "note")).toHaveLength(1);
  });

  it("каждый кадр итога звучит своим образом", () => {
    for (const s of steps.filter((x) => x.act === ACT.summary)) expect(score(s.state, true).length, s.narration).toBeGreaterThan(0);
  });

  it("при дубле обычная касса и фон молчат", () => {
    for (const s of steps) {
      const kinds = score(s.state, s.state.replay).map((e) => e.kind);
      if (kinds.includes("double")) expect(kinds.filter((k) => ["charge", "tick", "insert", "renew"].includes(k)), s.narration).toEqual([]);
    }
  });
});
