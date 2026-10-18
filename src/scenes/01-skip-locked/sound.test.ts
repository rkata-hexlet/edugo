import { describe, expect, it } from "vitest";
import type { Sound, Voice } from "../../engine/contract";
import { ACT, buildSteps } from "./script";
import type { EventKind, World } from "./sim";
import { BABBLE_AT, EVENT_WINDOW, sound } from "./sound";

/** Записывает вызовы вместо звука. */
function recorder() {
  const calls: { kind: "tone" | "noise" | "babble"; at: number; gain?: number; text?: string }[] = [];
  const s: Sound = {
    tone: (o) => calls.push({ kind: "tone", at: o.at ?? 0, gain: o.gain }),
    noise: (o) => calls.push({ kind: "noise", at: o.at ?? 0, gain: o.gain }),
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
  it("хук: три письма и два дубля", () => {
    const k = kinds(steps[0].state);
    expect(k.filter((x) => x === "send")).toHaveLength(3);
    expect(k.filter((x) => x === "duplicate")).toHaveLength(2);
  });

  it("гонка звучит тритоном в стоп-кадре", () => {
    const [stop] = withEvent(ACT.race, "race");
    expect(stop.race).toBe(true);
    expect(kinds(stop)).toContain("card");
  });

  it("условный UPDATE: один «плинк», потом двое ждут, после COMMIT — два «0 строк»", () => {
    const [claim] = withEvent(ACT.cas, "one");
    expect(kinds(claim).filter((x) => x === "one")).toHaveLength(1);
    const [waiting] = withEvent(ACT.cas, "wait");
    expect(kinds(waiting).filter((x) => x === "wait")).toHaveLength(2);
    const [after] = withEvent(ACT.cas, "zero");
    expect(kinds(after).filter((x) => x === "zero")).toHaveLength(2);
    expect(kinds(after)).toContain("commit");
  });

  it("конвой: COMMIT будит B и передаёт ему замок", () => {
    const [k] = withEvent(ACT.forUpdate, "wake").map(kinds);
    expect(k).toEqual(expect.arrayContaining(["commit", "relock", "wake"]));
  });

  it("SKIP LOCKED: шорох обхода — у B один, у C два (микрошаги)", () => {
    const counts = withEvent(ACT.skip, "skip").map((w) => kinds(w).filter((x) => x === "skip").length);
    expect(counts).toEqual([1, 2]); // B мимо #1; C мимо #1 и #2
  });

  it("новая сцена (свежие 6 задач) начинается с перелистывания", () => {
    expect(kinds(frames(ACT.mutex)[0])[0]).toBe("page");
  });

  it("перемотка, оценка на табло, «?», отказ по токену, перечёркнутый токен — звучат событиями", () => {
    const all = steps.flatMap((x) => kinds(x.state));
    for (const k of ["rewind", "verdict", "doubt", "clash", "ghost"] as const) expect(all, k).toContain(k);
    // «?» звучит один раз — при появлении, а не каждый кадр, пока висит.
    expect(all.filter((k) => k === "doubt")).toHaveLength(1);
  });

  it("итог повтором звучит как в первый раз и без «перелистывания»", () => {
    const recap = frames(ACT.summary).map(kinds);
    expect(recap).toHaveLength(3);
    expect(recap.flat()).not.toContain("page");
    expect(recap[0]).toContain("ghost");
    expect(recap[1]).toContain("clash");
    expect(recap[2]).toContain("replay");
  });

  it("финал с ключом: повтор ↺, дубля нет", () => {
    const [k] = withEvent(ACT.zombie, "replay").map(kinds);
    expect(k).toContain("replay");
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

  it(`звуки событий начинаются в первые ${EVENT_WINDOW} с, бормотание — с ${BABBLE_AT} с, громкость ≤ 0.2`, () => {
    for (const [i, step] of steps.entries()) {
      const { s, calls } = recorder();
      sound(s, step.state);
      for (const c of calls) {
        if (c.kind === "babble") expect(c.at, `кадр ${i + 1}`).toBeGreaterThanOrEqual(BABBLE_AT);
        else {
          expect(c.at, `кадр ${i + 1}`).toBeLessThanOrEqual(EVENT_WINDOW);
          expect(c.gain ?? 0, `кадр ${i + 1}`).toBeLessThanOrEqual(0.2);
        }
      }
    }
  });

  it("реплики не перекрывают друг друга", () => {
    const { s, calls } = recorder();
    sound(s, frames(ACT.mutex)[0]); // B «взял мьютекс» / кладовщик
    const at = calls.filter((c) => c.kind === "babble").map((c) => c.at);
    expect(at).toHaveLength(2);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new Set(at).size).toBe(2);
  });
});
