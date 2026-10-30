import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import { BABBLE_AT, EVENT_WINDOW, sound } from "./sound";

/** Записывает вызовы вместо звука. */
function recorder() {
  const calls: { kind: "tone" | "noise" | "babble"; at: number; gain: number; dur?: number; freq?: number; wave?: string }[] = [];
  const s: Sound = {
    tone: (o) => calls.push({ kind: "tone", at: o.at ?? 0, gain: o.gain ?? 0, dur: o.dur, freq: o.freq, wave: o.wave }),
    noise: (o) => calls.push({ kind: "noise", at: o.at ?? 0, gain: o.gain ?? 0, dur: o.dur, freq: o.freq }),
    babble: (v: Voice, _t: string, at = 0) => calls.push({ kind: "babble", at, gain: v.gain }),
  };
  return { s, calls };
}

const steps = buildSteps();

const frame = (act: string, kind: string) => steps.find((x) => x.act === act && x.state.events.some((e) => e.kind === kind))!;

function play(step: (typeof steps)[number]) {
  const { s, calls } = recorder();
  sound(s, step.state, step.state.replay);
  return calls;
}

describe("озвучка эпизода 03", () => {
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
    expect(recap.flatMap((x) => x.state.events.map((e) => e.kind))).not.toContain("dup");
  });

  it("повтор батча звучит провалом: в кадре дубля есть громкий «бзз»", () => {
    const frame = steps.find((x) => x.act === ACT.retry && x.state.events.some((e) => e.kind === "dup"))!;
    const { s, calls } = recorder();
    sound(s, frame.state);
    expect(calls.some((c) => c.kind === "tone" && c.gain >= 0.13)).toBe(true);
  });

  it("деплой без мягкой остановки: потеря кликов слышна — рассыпание", () => {
    expect(play(frame(ACT.deploy, "deploy")).some((c) => c.kind === "noise" && c.freq === 3000)).toBe(true);
  });

  it("при перегрузке звучит один гул: без «тук» прибавок и «дождя» кликов", () => {
    const overloaded = steps.filter((x) => !x.state.replay && x.state.events.some((e) => e.kind === "overload"));
    expect(overloaded.length).toBeGreaterThan(0);
    for (const step of overloaded) {
      expect(play(step).some((c) => c.kind === "tone" && (c.freq === 120 || c.freq === 1500))).toBe(false);
    }
  });

  it("в кадре дубля красная лампа не смазывает «бзз»", () => {
    const calls = play(frame(ACT.retry, "dup"));
    expect(calls.some((c) => c.kind === "tone" && c.freq === 220 && c.wave === "square")).toBe(false);
  });

  it("сброс после часов и SIGTERM, а не вместе с ними", () => {
    for (const [act, kind] of [[ACT.batch, "clock"], [ACT.graceful, "sigterm"]] as const) {
      const calls = play(frame(act, kind));
      const boom = calls.find((c) => c.kind === "tone" && c.freq === 90)!;
      const before = calls.filter((c) => c.at < boom.at && (c.freq === 2000 || c.freq === 880));
      expect(before.length, act).toBeGreaterThan(0);
      expect(calls.filter((c) => c.freq === 2000 || c.freq === 880).every((c) => c.at < boom.at), act).toBe(true);
    }
  });

  it("часы тикают без «дождя» кликов; при SIGTERM — сигнал без перемотки и один «бум»", () => {
    expect(play(frame(ACT.batch, "clock")).some((c) => c.freq === 1500)).toBe(false);
    for (const step of steps.filter((x) => !x.state.replay && x.state.events.some((e) => e.kind === "sigterm"))) {
      const calls = play(step);
      expect(calls.some((c) => c.freq === 800)).toBe(false);
      expect(calls.filter((c) => c.kind === "tone" && c.freq === 90)).toHaveLength(1);
    }
  });

  it("начало батча — без облегчения; штатный деплой — один тихий спад; отвергнутый повтор — «бум» вполсилы", () => {
    const start = steps.find((x) => x.act === ACT.batch)!;
    expect(start.state.events.map((e) => e.kind)).not.toContain("calm");
    const graceful = play(frame(ACT.graceful, "spawn"));
    expect(graceful.filter((c) => c.freq === 400)).toEqual([expect.objectContaining({ gain: 0.04 })]);
    const skipped = play(frame(ACT.keyed, "skip"));
    expect(skipped.filter((c) => c.kind === "tone" && c.freq === 90).every((c) => c.gain <= 0.1)).toBe(true);
  });

  it("строку разрезали на части — своя лесенка, а не тик клика", () => {
    expect(play(frame(ACT.sharded, "split")).filter((c) => c.kind === "tone" && c.wave === "square")).toHaveLength(8);
  });

  it("отсылки к эпизоду 01 — тишина целиком", () => {
    const flashbacks = steps.filter((x) => x.state.flashback);
    expect(flashbacks.length).toBeGreaterThan(0);
    for (const step of flashbacks) expect(play(step)).toHaveLength(0);
  });
});
