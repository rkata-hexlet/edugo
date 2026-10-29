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

describe("озвучка эпизода 13", () => {
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

  it("матрица итога тихая: только бормотание", () => {
    const matrix = steps.find((x) => x.state.matrix)!;
    const { s, calls } = recorder();
    sound(s, matrix.state, matrix.state.replay);
    expect(calls.filter((c) => c.kind !== "babble")).toEqual([]);
  });

  it("шум выброшенного растёт с глубиной выгрузки", () => {
    const durs = steps
      .filter((x) => !x.state.replay && x.state.events.some((e) => e.kind === "trash"))
      .map((x) => {
        const { s, calls } = recorder();
        sound(s, x.state);
        return calls.find((c) => c.kind === "noise" && c.at === 0.2 && (c.dur ?? 0) > 0.1)!.dur!;
      });
    expect(durs.length).toBeGreaterThanOrEqual(3);
    expect(durs).toEqual([...durs].sort((a, b) => a - b));
    expect(durs[durs.length - 1]).toBeGreaterThan(durs[0]);
  });

  it("лампа табло — после конца беды (дубль, пропажа)", () => {
    for (const [i, step] of steps.entries()) {
      const kinds = step.state.events.map((e) => e.kind);
      if (!kinds.includes("verdict") || !(kinds.includes("dup") || kinds.includes("lost"))) continue;
      const bad = step.state.events.filter((e) => e.kind !== "verdict");
      const lamps = step.state.events.filter((e) => e.kind === "verdict");
      const end = (events: typeof bad) => {
        const { s, calls } = recorder();
        sound(s, { ...step.state, events }, step.state.replay);
        return calls;
      };
      const trouble = end(bad.filter((e) => e.kind === "dup" || e.kind === "lost"));
      const lastBad = Math.max(...trouble.filter((c) => c.kind !== "babble").map((c) => c.at + (c.dur ?? 0)));
      const firstLamp = Math.min(...end(lamps).filter((c) => c.kind !== "babble").map((c) => c.at));
      expect(firstLamp - lastBad, `кадр ${i + 1}`).toBeGreaterThanOrEqual(0.02 - 1e-9);
    }
  });
});
