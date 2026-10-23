import { describe, expect, it } from "vitest";
import { ACT, buildSteps } from "./script";
import {
  ACTORS, PEOPLE, click, crowdVid, daySum, estimate, flood, flush, grow, hash, inflated, light, merge, place, realEstimate, record,
  reported, truth, union, world, year,
} from "./sim";
import { flashbackState } from "./view";

const ANYA = PEOPLE.anya.vid;

describe("модель уникальных", () => {
  it("хэш детерминирован; visitor ID героев лежат в задуманных регистрах", () => {
    expect(hash(ANYA)).toBe(hash(ANYA));
    expect(place(ANYA)).toEqual({ box: 5, rho: 3 });
    expect(place(PEOPLE.boris.vid)).toEqual({ box: 11, rho: 1 });
    expect(place(PEOPLE.vika.vid)).toEqual({ box: 5, rho: 2 });
  });

  it("set у каждого пода: Аня на трёх подах — три уникальных; пустеет со сбросом — снова новая", () => {
    const w = world();
    for (const id of ACTORS) click(w, id, ANYA);
    for (const id of ACTORS) flush(w, id);
    expect(w.uniques).toBe(3);
    expect(truth(w)).toBe(1);
    expect(inflated(w)).toBe(true);
    expect(light(w)).toBe(true);
    click(w, "A", ANYA);
    expect(w.actors.A.acts.some((a) => a.kind === "new")).toBe(true);
  });

  it("общий список: повтор отброшен, счёт точный; миллионы visitor ID — тяжело", () => {
    const w = world();
    w.mode = "list";
    click(w, "A", ANYA);
    click(w, "C", ANYA);
    flush(w, "A");
    flush(w, "C");
    expect(w.visitors).toEqual([ANYA]);
    expect(w.actors.C.acts.some((a) => a.kind === "insert" && a.dup)).toBe(true);
    expect(inflated(w)).toBe(false);
    grow(w, 3_000_000);
    expect(inflated(w)).toBe(false);
    expect(light(w)).toBe(false);
  });

  it("HLL: повтор не меняет регистры; оценка на малых — linear counting (≈ 1, ≈ 2)", () => {
    const w = world();
    w.mode = "hll";
    record(w, ANYA);
    expect(estimate(w.regs)).toBeCloseTo(1.03, 1);
    const before = w.regs.join();
    record(w, ANYA);
    expect(w.regs.join()).toBe(before);
    record(w, PEOPLE.boris.vid);
    expect(Math.round(estimate(w.regs))).toBe(2);
    record(w, PEOPLE.vika.vid); // новый человек в регистре с максимумом побольше — оценка не выросла
    expect(Math.round(estimate(w.regs))).toBe(2);
    expect(truth(w)).toBe(3);
  });

  it("толпа 10 000: 16 регистров — «почти на треть» (как говорит голос), 16 384 регистра — около процента", () => {
    const w = world();
    w.mode = "hll";
    flood(w, 10_000);
    const off = Math.abs(estimate(w.regs) / 10_000 - 1);
    expect(off).toBeGreaterThan(0.25);
    expect(off).toBeLessThan(0.34);
    expect(Math.abs(w.real! / 10_000 - 1)).toBeLessThan(0.03);
    expect(inflated(w)).toBe(false);
    expect(light(w)).toBe(true);
  });

  it("слияние регистров подов: Аня с A и с C — одна; merge — поэлементный максимум", () => {
    const w = world();
    w.mode = "hll";
    click(w, "A", ANYA);
    click(w, "C", ANYA);
    flush(w, "A");
    flush(w, "C");
    expect(Math.round(reported(w))).toBe(1);
    const a = [1, 0, 3];
    merge(a, [2, 0, 1]);
    expect(a).toEqual([2, 0, 3]);
  });

  it("год: сумма дневных завышает в разы; слияние дневных регистров — без завышения; «настоящий» — около процента", () => {
    const w = world();
    year(w);
    expect(daySum(w)).toBeGreaterThan(5 * truth(w));
    const est = estimate(union(w));
    expect(est).toBeLessThan(truth(w) * 1.8);
    const real = realEstimate(w.people);
    expect(Math.abs(real / truth(w) - 1)).toBeLessThan(0.03);
    void crowdVid;
  });
});

describe("сценарий эпизода 04 не врёт", () => {
  const steps = buildSteps();
  const lampsOf = (act: string) => steps.filter((s) => s.act === act).at(-1)!.state.board!.attempts.at(-1)!.lamps;

  it("табло сверено с моделью: set 🔴🟢, список 🟢🔴, HLL 🟡🟢, сумма дней 🔴🟢, регистры по дням 🟡🟢", () => {
    expect(lampsOf(ACT.notebook)).toEqual(["red", "green"]);
    expect(lampsOf(ACT.list)).toEqual(["green", "red"]);
    expect(lampsOf(ACT.hll)).toEqual(["yellow", "green"]);
    expect(lampsOf(ACT.daySum)).toEqual(["red", "green"]);
    expect(lampsOf(ACT.dayUnion)).toEqual(["yellow", "green"]);
    const last = (act: string) => steps.filter((s) => s.act === act).at(-1)!.state;
    expect(inflated(last(ACT.notebook))).toBe(true);
    expect(light(last(ACT.notebook))).toBe(true);
    expect(inflated(last(ACT.list))).toBe(false);
    expect(light(last(ACT.list))).toBe(false);
  });

  it("хук: три «Новая!» и uniques = 3 при одной Ане", () => {
    const hook = steps.find((s) => s.act === ACT.hook)!.state;
    expect(ACTORS.every((id) => hook.actors[id].acts.some((a) => a.kind === "new"))).toBe(true);
    expect(hook.uniques).toBe(3);
    expect(truth(hook)).toBe(1);
  });

  it("у HLL-пода нет мыслей «Новая!»: он не знает, кто новый", () => {
    const hll = steps.filter((s) => s.state.mode === "hll");
    expect(hll.flatMap((s) => ACTORS.flatMap((id) => s.state.actors[id].acts)).some((a) => a.kind === "new" || a.kind === "known")).toBe(false);
  });

  it("ярлыки — английские, ≤ 4 слов", () => {
    const terms = new Set(steps.map((s) => s.state.term).filter((t): t is string => !!t));
    expect([...terms]).toEqual(["Unique visitors", "Non-additive measure", "Exact distinct count", "HyperLogLog", "HLL union"]);
    for (const t of terms) expect(t.split(/\s+/).length).toBeLessThanOrEqual(4);
  });

  it("отсылка к 03 находит свой кадр; тире в закадре — не больше одного на кадр", () => {
    expect(() => flashbackState("И раз в пять секунд")).not.toThrow();
    for (const [i, s] of steps.entries()) expect((s.narration ?? "").split(" — ").length - 1, `кадр ${i + 1}`).toBeLessThanOrEqual(1);
  });
});
