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
/** Первый кадр акта с событием — кадры ищем по содержанию, а не по номеру: склейка кадров их сдвигает. */
const withEvent = (act: string, kind: EventKind) => frames(act).filter((w) => kinds(w).includes(kind));

describe("журнал событий", () => {
  it("хук: два звонка и дубль", () => {
    const k = kinds(steps[0].state);
    expect(k.filter((x) => x === "deliver")).toHaveLength(2);
    expect(k).toContain("duplicate");
  });

  it("гонка звучит тритоном, стоп-кадр — только титром", () => {
    const race = frames(ACT.race);
    const i = race.findIndex((w) => kinds(w).includes("race"));
    expect(i).toBeGreaterThan(0);
    expect(kinds(race[i + 1])).toEqual(["card"]); // стоп-кадр
    expect(race[i + 1].race).toBe(true);
  });

  it("толпа: один «плинк» и двое ждут, после COMMIT — два «0 строк»", () => {
    const [claim] = withEvent(ACT.crowd, "one");
    expect(kinds(claim).filter((x) => x === "one")).toHaveLength(1);
    expect(kinds(claim).filter((x) => x === "wait")).toHaveLength(2);
    const [after] = withEvent(ACT.crowd, "zero");
    expect(kinds(after).filter((x) => x === "zero")).toHaveLength(2);
    expect(kinds(after)).toContain("commit");
  });

  it("конвой: COMMIT будит B и передаёт ему замок", () => {
    const [k] = withEvent(ACT.convoy, "wake").map(kinds);
    expect(k).toEqual(expect.arrayContaining(["commit", "relock", "wake"]));
  });

  it("обход: шорох SKIP LOCKED у B и C", () => {
    const [f] = withEvent(ACT.skip, "skip");
    expect(kinds(f).filter((x) => x === "skip")).toHaveLength(3); // B мимо #1, C мимо #1 и #2
  });

  it("новая сцена внутри акта начинается с перелистывания", () => {
    const [mutexFrame] = withEvent(ACT.naive, "mutex");
    expect(kinds(mutexFrame)[0]).toBe("page");
  });

  it("финал у двери: повтор отклонён, дубля нет", () => {
    const [k] = withEvent(ACT.zombie, "rejected").map(kinds);
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
    sound(s, frames(ACT.zombie)[0]); // B отвис / кладовщик
    const at = calls.filter((c) => c.kind === "babble").map((c) => c.at);
    expect(at).toHaveLength(2);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new Set(at).size).toBe(2);
  });
});
