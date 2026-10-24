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

describe("озвучка эпизода 06", () => {
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

  it("40001 громко, перегруз курьера — тихий аккорд без square", () => {
    const fail = steps.find((x) => x.act === ACT.ser && x.state.events.some((e) => e.kind === "fail"))!;
    const a = recorder();
    sound(a.s, fail.state);
    expect(a.calls.some((c) => c.kind === "tone" && c.gain >= 0.13)).toBe(true);
    const hook = steps.find((x) => x.act === ACT.hook && x.state.events.some((e) => e.kind === "overload"))!;
    expect(score(hook.state).map((e) => e.kind)).toContain("overload");
  });

  it("метки чтения и зависимости звучат тихо — замок не стучит", () => {
    const ring = steps.find((x) => x.state.events.some((e) => e.kind === "dep"))!;
    const { s, calls } = recorder();
    sound(s, ring.state);
    expect(calls.every((c) => c.gain <= 0.11)).toBe(true);
  });

  it(`не больше ${MAX_SOUNDS} звуков в кадре`, () => {
    for (const step of steps) expect(score(step.state, step.state.replay).length).toBeLessThanOrEqual(MAX_SOUNDS);
  });

  const kindsOf = (i: number) => score(steps[i].state, steps[i].state.replay).map((e) => e.kind);
  const at = (act: string, kind: string) => steps.findIndex((x) => x.act === act && x.state.events.some((e) => e.kind === kind));

  it("2.1 рифмуется с хуком: тот же «пум, динь, динь, аккорд»", () => {
    expect(kindsOf(at(ACT.rr, "overload"))).toEqual(kindsOf(at(ACT.hook, "overload")));
    expect(kindsOf(at(ACT.hook, "overload"))).toEqual(["commit", "ok", "ok", "overload"]);
  });

  it("цикл замкнулся — звучит ring вместо dep; метки и цикл тихие и без square", () => {
    const i = at(ACT.ser, "ring");
    expect(kindsOf(i)).toContain("ring");
    expect(kindsOf(i)).not.toContain("dep");
    for (const k of ["mark", "dep", "ring"]) {
      const j = steps.findIndex((x) => x.state.events.some((e) => e.kind === k));
      const { s, calls } = recorder();
      sound(s, { ...steps[j].state, events: steps[j].state.events.filter((e) => e.kind === k) });
      expect(calls.every((c) => c.gain <= 0.05 && c.wave !== "square"), k).toBe(true);
    }
  });

  it("пустой коммит не звучит: в кадре отказа нет «пум»", () => {
    for (const [i, step] of steps.entries()) {
      if (step.state.replay) continue;
      const picked = score(step.state);
      const refused = new Set(picked.filter((e) => e.kind === "busy" || e.kind === "zero").map((e) => e.by));
      expect(picked.filter((e) => e.kind === "commit" && refused.has(e.by)), `кадр ${i + 1}`).toEqual([]);
    }
  });

  it("«бзз» 40001 — три разных момента; красная лампа — без square", () => {
    const { s, calls } = recorder();
    sound(s, steps[at(ACT.ser, "fail")].state);
    expect(new Set(calls.filter((c) => c.wave === "square" || c.wave === "sawtooth").map((c) => c.at)).size).toBe(3);
    const red = steps.find((x) => x.state.events.some((e) => e.kind === "verdict" && e.lamps?.[0] === "red"))!;
    const r = recorder();
    sound(r.s, { ...red.state, events: red.state.events.filter((e) => e.kind === "verdict") });
    expect(r.calls.length).toBeGreaterThan(0);
    expect(r.calls.some((c) => c.wave === "square")).toBe(false);
  });
});
