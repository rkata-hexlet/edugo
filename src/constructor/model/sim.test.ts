import { describe, expect, test } from "vitest";
import { BRICKS, play, run, type Brick, type Rule } from "./sim";
import { level } from "../levels/01-booking";

const set = (s: string) => new Set([...s] as Brick[]);
const rules = (s: string, phase: number) =>
  run(level.params, level.phases[phase], set(s)).violations.map((v) => v.rule).sort();

// Таблица «кирпичи × беды → исход» из docs/constructor/level-01.md: все сработавшие правила каждой беды.
const table: [string, Rule[], Rule[]][] = [
  ["", ["P1", "P2"], ["P1", "P2"]],
  ["T", ["P1"], ["P1", "P7"]],
  ["TO", [], ["P7"]],
  ["TOR", ["P3", "P4"], ["P4", "P5"]],
  ["TORK", ["P4"], ["P4", "P5"]],
  ["TORKJ", [], ["P5"]],
  ["TORJ", ["P3"], ["P5"]],
  ["TORKB", ["P4"], []],
  ["OB", ["P2"], ["P2", "P6"]],
  ["TOB", [], []],
  ["TORKJB", [], []],
];

describe("уровень 1: кирпичи × беды", () => {
  test.each(table)("%s", (s, d1, d2) => {
    expect(rules(s, 0)).toEqual(d1);
    expect(rules(s, 1)).toEqual(d2);
  });

  test("первый провал — тот, что в стоп-кадре", () => {
    expect(play(level, set("TORK")).failure?.rule).toBe("P4"); // ловушка 3: повторы разом
    expect(play(level, set("TOR")).failure?.rule).toBe("P4");
    expect(play(level, set("TORJ")).failure?.rule).toBe("P3"); // главная ловушка: две брони
    expect(play(level, set("TORKJ")).failure).toMatchObject({ rule: "P5", phase: "D2" });
    expect(play(level, set("OB")).failure).toMatchObject({ rule: "P2", phase: "D1" });
  });

  test("победа ровно у T+O+B, а ретрай — только с ключом и разбросом", () => {
    for (let m = 0; m < 64; m++) {
      const s = new Set(BRICKS.filter((_, i) => m & (1 << i)));
      const want = s.has("T") && s.has("O") && s.has("B") && (!s.has("R") || (s.has("K") && s.has("J")));
      expect(!play(level, s).failure, [...s].join("")).toBe(want);
    }
  });

  test("два решения — разный счёт: полное подтверждает больше, но грузит поставщика", () => {
    const lean = play(level, set("TOB")).score!;
    const full = play(level, set("TORKJB")).score!;
    expect(full.confirmed).toBeGreaterThan(lean.confirmed);
    expect(full.requests).toBeGreaterThan(lean.requests);
    expect(full.bricks).toBeGreaterThan(lean.bricks);
  });

  test("поставщик встал — пробный запрос замыкает выключатель, брони снова идут", () => {
    const d2 = level.phases[1];
    const r = run(level.params, d2, set("TOB"));
    expect(r.snapshots.at(-1)!.breaker).toBe("closed");
    expect(r.guests.some((g) => g.start >= d2.down!.to && g.answer === "confirmed")).toBe(true);
  });

  test("брошенный запрос поставщик доделывает: бронь создана, в стоп-кадре П3 видна вторая", () => {
    const r = run(level.params, level.phases[0], set("TORJ"));
    const p3 = r.violations.find((v) => v.rule === "P3")!;
    const snap = r.snapshots[p3.tick];
    expect(snap.calls.some((c) => c.landed && c.dupe)).toBe(true);
    expect(snap.orphanBookings).toBeGreaterThan(0);
    // без ретрая брошенные тоже доделываются — гость слышит «проверяем», а бронь у поставщика есть
    expect(run(level.params, level.phases[0], set("TOB")).snapshots.at(-1)!.orphanBookings).toBeGreaterThan(0);
  });

  test("детерминирована", () => {
    const a = play(level, set("TORKJB"));
    expect(play(level, set("TORKJB"))).toEqual(a);
  });
});
