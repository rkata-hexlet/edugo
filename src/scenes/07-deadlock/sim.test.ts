import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, RECALL, buildSteps } from "./script";
import {
  MUG, TEAPOT, accepted, begin, commit, deadlocked, detect, held, place, product, resume, retried, retry, take, world,
  type EventKind, type Level, type World,
} from "./sim";

/** Обе корзины навстречу: A — кружка, B — чайник, B ждёт кружку, A ждёт чайник. */
function race(w: World, level: Level): void {
  begin(w, "A", level);
  begin(w, "B", level);
  expect(take(w, "A")).toBe("write");
  expect(take(w, "B")).toBe("write");
  expect(take(w, "B")).toBe("wait");
  expect(take(w, "A")).toBe("wait");
}

describe("модель: замки строк до коммита", () => {
  it("запись держит строку до COMMIT; вторая запись в неё ждёт", () => {
    const w = world();
    begin(w, "A", "RC");
    take(w, "A");
    take(w, "A");
    expect(held(w, "A")).toEqual([TEAPOT, MUG]);
    begin(w, "B", "RC");
    expect(take(w, "B")).toBe("wait");
    commit(w, "A");
    expect(held(w, "A")).toEqual([]);
    expect(resume(w, "B")).toBe("write");
    expect(product(w, TEAPOT).draft!.stock).toBe(8);
  });
});

describe("deadlock", () => {
  for (const level of ["RC", "SER"] as const) {
    it(`${level}: встречные корзины замыкают цикл; детектор прерывает того, кто начал ждать первым — B`, () => {
      const w = world();
      race(w, level);
      expect(deadlocked(w)).toBe(true);
      expect(w.events.filter((e) => e.kind === "ring")).toHaveLength(1);
      expect(detect(w)).toBe("B");
      expect(w.reason.B).toBe("deadlock");
      expect(product(w, TEAPOT).draft).toBeNull(); // чайник B вернулся
      expect(resume(w, "A")).toBe("write");
      place(w, "A", "Аня");
      commit(w, "A");
      expect(accepted(w)).toBe(false);
    });
  }

  it("без цикла детектор молчит", () => {
    const w = world();
    begin(w, "A", "RC");
    take(w, "A");
    begin(w, "B", "RC");
    w.actors.B.plan = [MUG, TEAPOT];
    expect(take(w, "B")).toBe("wait");
    expect(detect(w)).toBeNull();
  });

  it("повтор после 40P01: второй заход B проходит, оба приняты, но с повтором", () => {
    const w = world();
    race(w, "RC");
    detect(w);
    resume(w, "A");
    place(w, "A", "Аня");
    commit(w, "A");
    retry(w, "B", "RC");
    take(w, "B");
    take(w, "B");
    place(w, "B", "Борис");
    commit(w, "B");
    expect(accepted(w)).toBe(true);
    expect(retried(w)).toBe(true);
    expect(product(w, MUG).stock).toBe(8);
  });

  it("порядок по id: второй ждёт с пустыми руками — цикла нет, оба приняты без повтора", () => {
    const w = world();
    for (const a of Object.values(w.actors)) a.plan = [TEAPOT, MUG];
    begin(w, "A", "RC");
    begin(w, "B", "RC");
    take(w, "A");
    expect(take(w, "B")).toBe("wait");
    expect(held(w, "B")).toEqual([]);
    expect(take(w, "A")).toBe("write");
    expect(deadlocked(w)).toBe(false);
    place(w, "A", "Аня");
    commit(w, "A");
    expect(resume(w, "B")).toBe("write");
    take(w, "B");
    place(w, "B", "Борис");
    commit(w, "B");
    expect(accepted(w)).toBe(true);
    expect(retried(w)).toBe(false);
  });

  it("SERIALIZABLE после ожидания строки, изменённой другим, — 40001, а не перепроверка", () => {
    const w = world();
    for (const a of Object.values(w.actors)) a.plan = [TEAPOT, MUG];
    begin(w, "A", "SER");
    begin(w, "B", "SER");
    take(w, "A");
    take(w, "B");
    commit(w, "A");
    expect(resume(w, "B")).toBe("fail");
    expect(w.reason.B).toBe("serialize");
  });
});

const steps = buildSteps();
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);
const kinds = (w: World) => w.events.map((e) => e.kind);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("30 кадров; вставка эпизода 05 — кадр, где B ждёт у запертой строки", () => {
    expect(steps).toHaveLength(30);
    expect(RECALL).toBeGreaterThanOrEqual(0);
    expect(steps[0].state.flashback).toBe(RECALL);
  });

  it("хук на READ COMMITTED: кольцо, 40P01 у B при полном складе, Аня принята", () => {
    const fs = frames(ACT.hook);
    expect(fs.some((w) => deadlocked(w))).toBe(true);
    const end = fs.at(-1)!;
    expect(end.reason.B).toBe("deadlock");
    expect(end.customers.map((c) => c.status)).toEqual(["ok", "fail"]);
    expect(end.products.every((p) => p.stock >= 9)).toBe(true);
  });

  it("норма: по очереди оба приняты, никто не ждал", () => {
    const fs = frames(ACT.norm);
    expect(accepted(fs.at(-1)!)).toBe(true);
    expect(fs.some((w) => kinds(w).includes("wait"))).toBe(false);
  });

  it("SERIALIZABLE — то же кольцо и 40P01", () => {
    const w = frames(ACT.ser).at(-1)!;
    expect(kinds(w)).toContain("detect");
    expect(w.reason.B).toBe("deadlock");
    expect(w.sql.some((q) => q.includes("SERIALIZABLE"))).toBe(true);
  });

  it("сортировка: кольца нет, B ждал с пустыми руками, перепроверка остатка", () => {
    const fs = frames(ACT.sort);
    expect(fs.some((w) => deadlocked(w))).toBe(false);
    const wait = fs.find((w) => kinds(w).includes("wait"))!;
    expect(held(wait, "B")).toEqual([]);
    expect(wait.actors.A.plan).toEqual([TEAPOT, MUG]);
    expect(fs.some((w) => kinds(w).includes("resume") && w.check?.ok)).toBe(true);
  });

  it("40P01 — только в хуке и в попытке SERIALIZABLE (вне итога)", () => {
    const acts = (kind: EventKind) => new Set(steps.filter((s) => kinds(s.state).includes(kind) && s.act !== ACT.summary).map((s) => s.act));
    expect(acts("fail")).toEqual(new Set([ACT.hook, ACT.ser]));
    expect(acts("ring")).toEqual(new Set([ACT.hook, ACT.ser]));
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    for (const step of steps) {
      const w = step.state;
      if (!kinds(w).includes("verdict")) continue;
      checked++;
      const t = w.board!.attempts.at(-1)!;
      const [both, again] = t.lamps!;
      if (both) expect(both === "green", `${t.name}: оба приняты`).toBe(accepted(w));
      if (again) expect(again === "green", `${t.name}: повторы`).toBe(!retried(w));
    }
    expect(checked).toBe(3);
  });

  it("диктор есть во всех кадрах и не читает команды целиком", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/WHERE|BEGIN|INSERT|UPDATE products/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; прошлые ролики — по теме", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[AB](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес|прошлом ролике|предыдущ/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("реплика Postgres — до 37 знаков", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = { [ACT.hook]: "ring", [ACT.retry]: "retry", [ACT.sort]: "wait" };
    for (const [act, kind] of Object.entries(mechanic)) {
      const fs = frames(act);
      const first = fs.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(fs.slice(0, first + 1).some((w) => kinds(w).includes(kind)), act).toBe(true);
      expect(fs.slice(first).every((w) => w.term === fs[first].term), act).toBe(true);
    }
  });
});
