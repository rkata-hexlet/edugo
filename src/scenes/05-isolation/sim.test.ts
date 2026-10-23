import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, buildSteps } from "./script";
import {
  begin, commit, insert, latest, oversold, read, resume, retried, retry, rollback, visible, world, write,
  type EventKind, type World,
} from "./sim";

describe("модель MVCC: одна строка товара", () => {
  it("UPDATE создаёт новую версию; чужая незакоммиченная не видна, своя — видна", () => {
    const w = world();
    begin(w, "A");
    begin(w, "B");
    expect(write(w, "A", { kind: "set", value: 0 })).toBe("write");
    expect(w.versions).toHaveLength(2);
    expect(read(w, "B")).toBe(1);
    expect(read(w, "A")).toBe(0);
  });

  it("READ COMMITTED: прочитал → посчитал → записал теряет обновление, заказов два", () => {
    const w = world();
    begin(w, "A");
    begin(w, "B");
    read(w, "A");
    read(w, "B");
    write(w, "A", { kind: "set", value: 0 });
    expect(write(w, "B", { kind: "set", value: 0 })).toBe("wait");
    insert(w, "A");
    commit(w, "A");
    expect(resume(w, "B")).toBe("write"); // условие только id — проходит
    insert(w, "B");
    commit(w, "B");
    expect(w.versions[latest(w)].stock).toBe(0);
    expect(oversold(w)).toBe(true);
  });

  it("READ COMMITTED: атомарный UPDATE … WHERE stock > 0 после ожидания перепроверяет условие → 0 строк", () => {
    const w = world();
    begin(w, "A");
    begin(w, "B");
    write(w, "A", { kind: "dec" });
    expect(write(w, "B", { kind: "dec" })).toBe("wait");
    commit(w, "A");
    expect(resume(w, "B")).toBe("zero");
    expect(w.versions[latest(w)].stock).toBe(0);
  });

  it("READ COMMITTED: снимок на каждый оператор — второй SELECT видит свежий коммит", () => {
    const w = world();
    begin(w, "B");
    expect(read(w, "B")).toBe(1);
    begin(w, "A");
    write(w, "A", { kind: "set", value: 0 });
    commit(w, "A");
    expect(read(w, "B")).toBe(0);
  });

  it("REPEATABLE READ: снимок с первого оператора, а не с BEGIN; потом не меняется", () => {
    const w = world();
    begin(w, "B", "RR");
    begin(w, "A");
    write(w, "A", { kind: "set", value: 0 });
    commit(w, "A");
    expect(read(w, "B")).toBe(0); // снимок взят после коммита A
    const v = world();
    begin(v, "B", "RR");
    expect(read(v, "B")).toBe(1);
    begin(v, "A");
    write(v, "A", { kind: "set", value: 0 });
    commit(v, "A");
    expect(read(v, "B")).toBe(1);
    expect(visible(v, "B")).toBe(0);
  });

  it("REPEATABLE READ: строку после снимка изменил другой → 40001, откат; повтор видит 0", () => {
    const w = world();
    begin(w, "A", "RR");
    begin(w, "B", "RR");
    read(w, "A");
    read(w, "B");
    write(w, "A", { kind: "set", value: 0 });
    write(w, "B", { kind: "set", value: 0 });
    insert(w, "A");
    commit(w, "A");
    expect(resume(w, "B")).toBe("fail");
    expect(w.actors.B.tx).toBeNull();
    expect(oversold(w)).toBe(false);
    retry(w, "B", "RR");
    expect(read(w, "B")).toBe(0);
    expect(retried(w)).toBe(true);
  });

  it("REPEATABLE READ: если сосед откатился, ожидавший продолжает без ошибки", () => {
    const w = world();
    begin(w, "A", "RR");
    begin(w, "B", "RR");
    read(w, "B");
    write(w, "A", { kind: "set", value: 0 });
    write(w, "B", { kind: "set", value: 0 });
    rollback(w, "A");
    expect(resume(w, "B")).toBe("write");
  });
});

const steps = buildSteps();
const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("хук: остаток 0, а заказов два — оба покупателя получили подтверждение", () => {
    const w = frames(ACT.hook).at(-1)!;
    expect(w.versions[latest(w)].stock).toBe(0);
    expect(oversold(w)).toBe(true);
    expect(w.customers.map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  it("норма: по очереди — Аня купила, Борис видит «нет в наличии»", () => {
    const w = frames(ACT.norm).at(-1)!;
    expect(oversold(w)).toBe(false);
    expect(w.customers.map((c) => c.status)).toEqual(["ok", "none"]);
  });

  it("каждая попытка стартует одинаково: свежий стол с одной кружкой", () => {
    for (const act of [ACT.naive, ACT.atomic, ACT.rr]) {
      const w = frames(act)[0];
      expect(w.versions[0].stock, act).toBe(1);
      expect(kinds(w), act).toContain("press");
    }
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    steps.forEach((step, i) => {
      const w = step.state;
      if (!kinds(w).includes("verdict")) return;
      checked++;
      const t = w.board!.attempts.at(-1)!;
      const [extra, again] = t.lamps!;
      if (extra) expect(extra === "green", `${t.name}: лишнего`).toBe(!oversold(w));
      if (again) expect(again === "green", `${t.name}: повторы`).toBe(!retried(w));
      expect(steps.slice(0, i).every((s) => s.state.board?.attempts.length !== w.board!.attempts.length || !kinds(s.state).includes("verdict"))).toBe(true);
    });
    expect(checked).toBe(3);
  });

  it("40001 — только на REPEATABLE READ, 0 строк — только у атомарного UPDATE", () => {
    const fails = steps.filter((s) => kinds(s.state).includes("fail") && s.act !== ACT.summary).map((s) => s.act);
    expect(new Set(fails)).toEqual(new Set([ACT.rr]));
    const zeros = steps.filter((s) => kinds(s.state).includes("zero") && s.act !== ACT.summary).map((s) => s.act);
    expect(new Set(zeros)).toEqual(new Set([ACT.atomic]));
  });

  it("диктор есть во всех кадрах и не читает команды целиком", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/SELECT|WHERE|BEGIN|INSERT/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[ABC](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("реплика Postgres — до 37 знаков", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = { [ACT.naive]: "write", [ACT.atomic]: "zero", [ACT.rr]: "fail" };
    for (const [act, kind] of Object.entries(mechanic)) {
      const fs = frames(act);
      const first = fs.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(fs.slice(0, first + 1).some((w) => kinds(w).includes(kind)), act).toBe(true);
      expect(fs.slice(first).every((w) => w.term === fs[first].term), act).toBe(true);
    }
    const bare = [ACT.intro, ACT.hook, ACT.norm, ACT.case1, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });
});
