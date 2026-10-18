import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import type { EventKind, World } from "./sim";
import { sound } from "./sound";

/** Записывает вызовы вместо звука. */
function recorder() {
  const calls: { kind: "tone" | "noise" | "babble"; at: number; text?: string }[] = [];
  const s: Sound = {
    tone: (o) => calls.push({ kind: "tone", at: o.at ?? 0 }),
    noise: (o) => calls.push({ kind: "noise", at: o.at ?? 0 }),
    babble: (_v: Voice, text: string, at = 0) => calls.push({ kind: "babble", at, text }),
  };
  return { s, calls };
}

const steps = buildSteps();
const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("журнал событий", () => {
  it("хук: два звонка и дубль", () => {
    const k = kinds(steps[0].state);
    expect(k.filter((x) => x === "deliver")).toHaveLength(2);
    expect(k).toContain("duplicate");
  });

  it("гонка звучит тритоном, стоп-кадр — только титром", () => {
    expect(kinds(frames(ACT.race)[7])).toContain("race");
    expect(kinds(frames(ACT.race)[8])).toEqual(["card"]);
  });

  it("толпа: один «плинк», два «0 строк»", () => {
    const k = kinds(frames(ACT.crowd)[1]);
    expect(k.filter((x) => x === "one")).toHaveLength(1);
    expect(k.filter((x) => x === "zero")).toHaveLength(2);
  });

  it("конвой: COMMIT будит B и передаёт ему замок", () => {
    const k = kinds(frames(ACT.convoy)[4]);
    expect(k).toEqual(expect.arrayContaining(["commit", "relock", "wake"]));
  });

  it("обход: шорох SKIP LOCKED у B и C", () => {
    const f = frames(ACT.skip);
    expect(kinds(f[1])).toContain("skip");
    expect(kinds(f[2])).toContain("skip");
  });

  it("новая сцена внутри акта начинается с перелистывания", () => {
    const naive = frames(ACT.naive);
    expect(kinds(naive[3])[0]).toBe("page");
  });

  it("финал у двери: повтор отклонён, дубля нет", () => {
    const k = kinds(frames(ACT.zombie)[3]);
    expect(k).toContain("rejected");
    expect(k).not.toContain("duplicate");
  });
});

describe("озвучка кадров", () => {
  it("каждый кадр озвучивается без ошибок, время не отрицательное", () => {
    for (const step of steps) {
      const { s, calls } = recorder();
      sound(s, step.state);
      expect(calls.every((c) => c.at >= 0)).toBe(true);
    }
  });

  it("бормочут только реплики, не SQL и не эмодзи", () => {
    for (const step of steps) {
      const { s, calls } = recorder();
      sound(s, step.state);
      for (const c of calls.filter((x) => x.kind === "babble")) {
        expect(c.text).not.toMatch(/SELECT|UPDATE|COMMIT/);
        expect(c.text).toMatch(/[\p{L}\p{N}]/u);
      }
    }
  });

  it("реплики не перекрывают друг друга", () => {
    const { s, calls } = recorder();
    sound(s, frames(ACT.zombie)[1]); // «Я — B» / «Нет, я — B» / кладовщик
    const at = calls.filter((c) => c.kind === "babble").map((c) => c.at);
    expect(at).toHaveLength(3);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new Set(at).size).toBe(3);
  });
});
