import { describe, expect, it } from "vitest";
import {
  begin, boxes, bump, commit, count, insert, overloaded, resume, retried, retry, slotTop, world,
  type World,
} from "./sim";

/** Оба читают, оба вставляют — общий таймлайн 2.1 и 2.2. */
function race(w: World, level: "RR" | "SER"): void {
  begin(w, "A", level);
  begin(w, "B", level);
  expect(count(w, "A")).toBe(2);
  expect(count(w, "B")).toBe(2);
  insert(w, "A");
  insert(w, "B");
}

describe("модель: заказы слота и снимок", () => {
  it("чужой незакоммиченный заказ не виден, свой виден", () => {
    const w = world();
    begin(w, "A", "RC");
    begin(w, "B", "RC");
    insert(w, "A");
    expect(count(w, "A")).toBe(3);
    expect(count(w, "B")).toBe(2);
  });

  it("READ COMMITTED по очереди: второй видит 3 из 3", () => {
    const w = world();
    begin(w, "A", "RC");
    count(w, "A");
    insert(w, "A");
    commit(w, "A");
    begin(w, "B", "RC");
    expect(count(w, "B")).toBe(3);
  });

  it("REPEATABLE READ: снимок замер — пересчёт после чужого коммита всё ещё 2 (phantom read нет)", () => {
    const w = world();
    begin(w, "A", "RR");
    begin(w, "B", "RR");
    count(w, "B");
    count(w, "A");
    insert(w, "A");
    commit(w, "A");
    expect(count(w, "B")).toBe(2);
  });
});

describe("write skew на REPEATABLE READ", () => {
  it("оба видят 2 из 3, вставляют разные строки, никто не ждёт и не падает — у курьера 4 коробки", () => {
    const w = world();
    race(w, "RR");
    expect(w.actors.A.tx!.waiting || w.actors.B.tx!.waiting).toBe(false);
    expect(commit(w, "A")).toBe(true);
    expect(commit(w, "B")).toBe(true);
    expect(boxes(w)).toBe(4);
    expect(overloaded(w)).toBe(true);
    expect(retried(w)).toBe(false);
    expect(w.events.some((e) => e.kind === "overload")).toBe(true);
  });
});

describe("SERIALIZABLE (SSI)", () => {
  it("метки чтения никого не держат; вставки дают встречные зависимости, ошибки до коммита нет", () => {
    const w = world();
    race(w, "SER");
    expect(w.deps).toEqual([{ reader: "B", writer: "A" }, { reader: "A", writer: "B" }]);
    expect(w.actors.A.failed || w.actors.B.failed).toBe(false);
    expect(w.actors.A.tx!.waiting || w.actors.B.tx!.waiting).toBe(false);
  });

  it("первый закоммитивший выигрывает: A коммитится, B получает 40001 на COMMIT", () => {
    const w = world();
    race(w, "SER");
    expect(commit(w, "A")).toBe(true);
    expect(w.actors.B.tx!.doomed).toBe(true);
    expect(commit(w, "B")).toBe(false);
    expect(w.actors.B.failed).toBe(true);
    expect(w.reason.B).toBe("deps");
    expect(boxes(w)).toBe(3);
  });

  it("A закоммитил до вставки B — B падает прямо на INSERT", () => {
    const w = world();
    begin(w, "A", "SER");
    begin(w, "B", "SER");
    count(w, "A");
    count(w, "B");
    insert(w, "A");
    commit(w, "A");
    expect(insert(w, "B")).toBe(false);
    expect(w.actors.B.failed).toBe(true);
    expect(boxes(w)).toBe(3);
  });

  it("обречённая транзакция получает 40001 и на подсчёте: count — null, транзакция откатана", () => {
    const w = world();
    race(w, "SER");
    commit(w, "A");
    expect(count(w, "B")).toBeNull();
    expect(w.actors.B.failed).toBe(true);
    expect(w.actors.B.tx).toBeNull();
    expect(boxes(w)).toBe(3);
  });

  it("повтор B: свежий снимок видит 3 из 3, заказ не вставляем", () => {
    const w = world();
    race(w, "SER");
    commit(w, "A");
    commit(w, "B");
    retry(w, "B", "SER");
    expect(count(w, "B")).toBe(3);
    commit(w, "B");
    expect(boxes(w)).toBe(3);
    expect(overloaded(w)).toBe(false);
  });

  it("A откатился — B коммитится спокойно", () => {
    const w = world();
    race(w, "SER");
    w.actors.A.tx = null;
    w.orders = w.orders.filter((o) => o.by !== "A");
    w.deps = w.deps.filter((d) => d.reader !== "A" && d.writer !== "A");
    expect(commit(w, "B")).toBe(true);
  });
});

describe("счётчик в строке слота (2.3)", () => {
  it("READ COMMITTED: B ждёт коммита A, перепроверка 3 < 3 → 0 строк, без повтора", () => {
    const w = world();
    begin(w, "A", "RC");
    begin(w, "B", "RC");
    expect(bump(w, "A")).toBe("write");
    expect(bump(w, "B")).toBe("wait");
    insert(w, "A");
    commit(w, "A");
    expect(resume(w, "B")).toBe("zero");
    commit(w, "B");
    expect(w.slot[slotTop(w)].booked).toBe(3);
    expect(boxes(w)).toBe(3);
    expect(retried(w)).toBe(false);
  });

  it("REPEATABLE READ: тот же UPDATE после ожидания — 40001 (concurrent update)", () => {
    const w = world();
    begin(w, "A", "RR");
    begin(w, "B", "RR");
    bump(w, "A");
    bump(w, "B");
    commit(w, "A");
    expect(resume(w, "B")).toBe("fail");
    expect(w.reason.B).toBe("update");
  });
});

import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, RECALL, buildSteps } from "./script";
import type { EventKind } from "./sim";

const steps = buildSteps();
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);
const kinds = (w: World) => w.events.map((e) => e.kind);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("вставки эпизода 05: 40001 — вторым кадром (после контекста) и в 2.1 (что сверяет RR), атомарный UPDATE — перед 2.3", () => {
    expect(RECALL.rr).toBeGreaterThanOrEqual(0);
    expect(RECALL.atomic).toBeGreaterThanOrEqual(0);
    expect(steps[0].state.flashback).toBeNull();
    expect(steps[1].state.flashback).toBe(RECALL.rr);
    expect(steps.filter((s) => s.state.flashback !== null).map((s) => [s.act, s.state.flashback])).toEqual([[ACT.intro, RECALL.rr], [ACT.rr, RECALL.rr], [ACT.counter, RECALL.atomic]]);
  });

  it("хук на REPEATABLE READ: никто не ждал и не упал, оба получили подтверждение, коробок четыре", () => {
    const fs = frames(ACT.hook);
    const w = fs.at(-1)!;
    expect(overloaded(w)).toBe(true);
    expect(boxes(w)).toBe(4);
    expect(w.customers.map((c) => c.status)).toEqual(["ok", "ok"]);
    expect(fs.some((x) => kinds(x).includes("wait") || kinds(x).includes("fail"))).toBe(false);
    expect(steps.find((s) => s.act === ACT.hook)!.state.sql.length).toBe(0);
  });

  it("норма: по очереди — Аня записалась, Борис видит «слот занят»", () => {
    const w = frames(ACT.norm).at(-1)!;
    expect(overloaded(w)).toBe(false);
    expect(w.customers.map((c) => c.status)).toEqual(["ok", "busy"]);
  });

  it("каждая попытка стартует одинаково: два заказа в слоте на три места", () => {
    for (const act of [ACT.rr, ACT.ser, ACT.counter]) {
      const w = frames(act).find((x) => kinds(x).includes("press"))!;
      expect(w, act).toBeDefined();
      expect(w.orders.filter((o) => o.by === null), act).toHaveLength(2);
      expect(w.slot[0], act).toEqual({ booked: 2, by: null, at: 0 });
    }
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    for (const step of steps) {
      const w = step.state;
      if (!kinds(w).includes("verdict")) continue;
      checked++;
      const t = w.board!.attempts.at(-1)!;
      const [load, again] = t.lamps!;
      if (load) expect(load === "green", `${t.name}: курьер`).toBe(!overloaded(w));
      if (again) expect(again === "green", `${t.name}: повторы`).toBe(!retried(w));
    }
    expect(checked).toBe(3);
  });

  it("второй критерий табло виден с кадра цены и до конца кейса", () => {
    const from = steps.findIndex((s) => s.state.costShown);
    expect(steps[from].act).toBe(ACT.ser);
    expect(steps.slice(from).filter((s) => s.state.board).every((s) => s.state.costShown)).toBe(true);
  });

  it("SERIALIZABLE: никто не ждёт; 40001 у B — на COMMIT, после коммита A; метки — без замка", () => {
    const fs = frames(ACT.ser);
    expect(fs.some((x) => kinds(x).includes("wait"))).toBe(false);
    const fail = fs.find((x) => kinds(x).includes("fail"))!;
    expect(fail.reason.B ?? "deps").toBe("deps");
    const k = kinds(fail);
    expect(k.indexOf("commit")).toBeLessThan(k.indexOf("fail"));
    expect(fail.events.find((e) => e.kind === "fail")!.by).toBe("B");
    expect(fs.some((x) => x.slotLockedBy !== null)).toBe(false);
  });

  it("40001 — только на SERIALIZABLE; ожидание и 0 строк — только у счётчика в строке, на READ COMMITTED", () => {
    const acts = (kind: EventKind) => new Set(steps.filter((s) => kinds(s.state).includes(kind) && s.act !== ACT.summary).map((s) => s.act));
    expect(acts("fail")).toEqual(new Set([ACT.ser]));
    expect(acts("zero")).toEqual(new Set([ACT.counter]));
    expect(acts("wait")).toEqual(new Set([ACT.counter]));
    const press = frames(ACT.counter).find((x) => kinds(x).includes("press"))!;
    expect(press.sql.filter((q) => q.includes("BEGIN")).every((q) => q.endsWith("BEGIN"))).toBe(true);
  });

  it("диктор есть во всех кадрах и не читает команды целиком", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/SELECT|WHERE|BEGIN|INSERT/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; слово «фантом» не берём", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[AB](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес|фантом|phantom/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("реплика Postgres — до 37 знаков", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = { [ACT.rr]: "overload", [ACT.ser]: "dep", [ACT.counter]: "zero" };
    for (const [act, kind] of Object.entries(mechanic)) {
      const fs = frames(act);
      const first = fs.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(fs.slice(0, first + 1).some((w) => kinds(w).includes(kind)), act).toBe(true);
      expect(fs.slice(first).every((w) => w.term === fs[first].term), act).toBe(true);
    }
    const bare = [ACT.intro, ACT.hook, ACT.norm, ACT.case2, ACT.choice, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });
});
