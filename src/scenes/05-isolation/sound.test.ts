import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import { BABBLE_AT, EVENT_WINDOW, MAX_SOUNDS, score, sound } from "./sound";

/** Записывает вызовы вместо звука. */
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

describe("озвучка эпизода 05", () => {
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

  it("40001 звучит провалом: громкий «бзз»", () => {
    const frame = steps.find((x) => x.act === ACT.rr && x.state.events.some((e) => e.kind === "fail"))!;
    const { s, calls } = recorder();
    sound(s, frame.state);
    expect(calls.some((c) => c.kind === "tone" && c.gain >= 0.13)).toBe(true);
  });

  const kinds = (i: number) => score(steps[i].state, steps[i].state.replay).map((e) => e.kind);
  const actFrames = (act: string) => steps.flatMap((x, i) => (x.act === act ? [i] : []));

  it("хук и 1.1 звучат одинаково: commit, ok, clobber, ok, oversold", () => {
    const rhyme = ["commit", "ok", "clobber", "ok", "oversold"];
    // В хуке концовка разбита на два кадра, повторный COMMIT пода B там — свой кадр.
    const hook = actFrames(ACT.hook).flatMap(kinds).filter((k) => !["read", "write", "wait", "page"].includes(k));
    expect(hook.filter((k, i) => k !== "commit" || hook.indexOf("commit") === i)).toEqual(rhyme);
    const naive = actFrames(ACT.naive).map(kinds).find((k) => k.includes("oversold"))!;
    expect(naive).toEqual(rhyme);
  });

  it("тихая беда тихая: clobber и oversold без square, gain ≤ 0.06; 40001 минимум вдвое громче", () => {
    const loudest = (kind: string) => {
      const frame = steps.find((x) => !x.state.replay && x.state.events.some((e) => e.kind === kind))!;
      const { s, calls } = recorder();
      sound(s, { ...frame.state, events: frame.state.events.filter((e) => e.kind === kind) });
      return calls;
    };
    for (const kind of ["clobber", "oversold"]) {
      const calls = loudest(kind);
      expect(calls.length, kind).toBeGreaterThan(0);
      expect(calls.every((c) => c.kind === "babble" || (c.gain <= 0.06 && c.wave !== "square")), kind).toBe(true);
    }
    const peak = (kind: string) => Math.max(...loudest(kind).filter((c) => c.kind !== "babble").map((c) => c.gain));
    expect(peak("fail")).toBeGreaterThanOrEqual(2 * Math.max(peak("clobber"), peak("zero")));
  });

  it(`не больше ${MAX_SOUNDS} звуков в кадре`, () => {
    for (const i of steps.keys()) expect(kinds(i).length, `кадр ${i + 1}`).toBeLessThanOrEqual(MAX_SOUNDS);
  });

  it("табло после «продано больше» без красной лампы: аккорд уже прозвучал, square — тембр 40001", () => {
    const frame = actFrames(ACT.naive).map((i) => steps[i]).find((x) => x.state.events.some((e) => e.kind === "verdict"))!;
    const { s, calls } = recorder();
    sound(s, frame.state);
    expect(calls.some((c) => c.kind === "tone")).toBe(true);
    expect(calls.some((c) => c.wave === "square")).toBe(false);
  });

  it("лесенка звучит одним мягким подъёмом, без ступенек", () => {
    const frame = steps.find((x) => x.state.events.some((e) => e.kind === "ladder"))!;
    const { s, calls } = recorder();
    sound(s, frame.state);
    expect(calls.filter((c) => c.kind === "tone")).toHaveLength(1);
  });

  it("звуки кадра идут по порядку и не сливаются: старты растут", () => {
    for (const [i, step] of steps.entries()) {
      const { s, calls } = recorder();
      sound(s, step.state, step.state.replay);
      // Первый вызов каждого звука — его старт; повторный старт в одной точке был бы наложением.
      const starts = calls.filter((c) => c.kind !== "babble").map((c) => c.at);
      for (let j = 1; j < starts.length; j++) expect(starts[j] + 1e-9, `кадр ${i + 1}`).toBeGreaterThanOrEqual(starts[j - 1] - 0.15);
    }
  });
});
