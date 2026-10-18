import { describe, expect, it } from "vitest";
import { ACT, buildSteps } from "./script";
import {
  claimLease, commit, complete, deliver, duplicates, rowById, selectTask, updateTask, world,
  type EventKind, type World,
} from "./sim";

describe("модель Postgres", () => {
  it("чужая незакоммиченная правка не видна (READ COMMITTED)", () => {
    const w = world();
    updateTask(w, "A", 1, { status: "in_progress" });
    selectTask(w, "B");
    expect(w.actors.B.seen).toBe(1);
    commit(w, "A");
    selectTask(w, "B");
    expect(w.actors.B.seen).toBe(2);
  });

  it("SELECT без блокировки + UPDATE по id: оба берут одну задачу", () => {
    const w = world();
    selectTask(w, "A");
    selectTask(w, "B");
    expect([w.actors.A.seen, w.actors.B.seen]).toEqual([1, 1]);
  });

  it("условный UPDATE: проигравший задевает 0 строк", () => {
    const w = world();
    updateTask(w, "A", 1, { status: "in_progress" }, (d) => d.status === "new");
    commit(w, "A");
    updateTask(w, "B", 1, { status: "in_progress" }, (d) => d.status === "new");
    expect([w.actors.A.affected, w.actors.B.affected]).toEqual([1, 0]);
  });

  it("FOR UPDATE: конвой — B ждёт A, берёт следующего кандидата, C ждёт уже B", () => {
    const w = world();
    selectTask(w, "A", "for_update");
    selectTask(w, "B", "for_update");
    selectTask(w, "C", "for_update");
    expect(w.actors.B.scan?.waitingFor).toBe(1);
    expect(w.actors.C.scan?.waitingFor).toBe(1);

    updateTask(w, "A", 1, { status: "in_progress" });
    commit(w, "A");
    expect(w.actors.B.seen).toBe(2);
    expect(rowById(w, 1).lockedBy).toBe("B"); // заблокирована, но не возвращена
    expect(w.actors.C.scan?.waitingFor).toBe(1);

    updateTask(w, "B", 2, { status: "in_progress" });
    commit(w, "B");
    expect(w.actors.C.seen).toBe(3);
    expect(w.actors.C.scan).toBeNull();
  });

  it("FOR UPDATE: кандидаты из снимка кончились — 0 строк", () => {
    const w = world(1);
    selectTask(w, "A", "for_update");
    selectTask(w, "B", "for_update");
    updateTask(w, "A", 1, { status: "in_progress" });
    commit(w, "A");
    expect(w.actors.B.seen).toBeNull();
    expect(w.actors.B.scan).toBeNull();
  });

  it("SKIP LOCKED: три пода — три разные задачи, никто не ждёт", () => {
    const w = world();
    for (const who of ["A", "B", "C"] as const) selectTask(w, who, "skip_locked");
    expect([w.actors.A.seen, w.actors.B.seen, w.actors.C.seen]).toEqual([1, 2, 3]);
    expect(Object.values(w.actors).every((a) => a.scan === null)).toBe(true);
  });

  it("lease: до срока задачу не берут, после — перехватывают с новым талоном", () => {
    const w = world(1);
    expect(claimLease(w, "B")).toBe(1);
    w.clock = 30;
    expect(claimLease(w, "C")).toBeNull(); // lease_until < now() ещё ложно
    w.clock = 31;
    expect(claimLease(w, "C")).toBe(1);
    expect(w.actors.C.token).not.toBe(w.actors.B.token);
  });

  it("завершение по чужому (сгоревшему) талону задевает 0 строк", () => {
    const w = world(1);
    claimLease(w, "B");
    w.clock = 31;
    claimLease(w, "B2");
    complete(w, "B", 1, true);
    expect(w.actors.B.affected).toBe(0);
    expect(rowById(w, 1).status).toBe("in_progress");
    complete(w, "B2", 1, true);
    expect(rowById(w, 1).status).toBe("done");
  });

  it("идемпотентная доставка: повтор отклонён, дубля нет", () => {
    const w = world();
    deliver(w, "B", 1, true);
    deliver(w, "B2", 1, true);
    expect(duplicates(w)).toEqual([]);
    deliver(w, "A", 2);
    deliver(w, "C", 2);
    expect(duplicates(w)).toEqual([2]);
  });
});

describe("сценарий не врёт", () => {
  const steps = buildSteps();
  const last = (act: string): World => steps.filter((s) => s.act === act).at(-1)!.state;

  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("хук: клиент получил посылку дважды", () => {
    expect(steps[0].act).toBe(ACT.hook);
    expect(duplicates(steps[0].state)).toEqual([1]);
  });

  it("час пик: дубль", () => {
    expect(duplicates(last(ACT.race))).toEqual([3]);
  });

  it("наивная перепроверка: оба держат #1", () => {
    const s = steps.filter((x) => x.act === ACT.naive)[2].state;
    expect([s.actors.A.carrying, s.actors.B.carrying]).toEqual([1, 1]);
  });

  it("толпа: у каждой посылки один владелец", () => {
    const s = last(ACT.crowd);
    expect([s.actors.A.carrying, s.actors.B.carrying, s.actors.C.carrying]).toEqual([1, null, 2]);
  });

  it("конвой: C в итоге взял #3", () => {
    expect(last(ACT.convoy).actors.C.seen).toBe(3);
  });

  it("обход: три доставки без дублей", () => {
    const s = last(ACT.skip);
    expect(s.deliveries.length).toBe(3);
    expect(duplicates(s)).toEqual([]);
  });

  it("завис с открытой транзакцией: #1 под замком B через 10 минут", () => {
    const s = steps.filter((x) => x.act === ACT.lease)[3].state;
    expect(s.clock).toBe(600);
    expect(rowById(s, 1).lockedBy).toBe("B");
    expect([s.actors.A.seen, s.actors.C.seen]).toEqual([2, 3]);
  });

  it("талон: B2 перехватил #1 после истечения, замков нет", () => {
    const s = last(ACT.lease);
    expect(rowById(s, 1)).toMatchObject({ token: "c21e", lockedBy: null });
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.race]: "race", [ACT.naive]: "mutex", [ACT.crowd]: "zero", [ACT.convoy]: "wait",
      [ACT.skip]: "skip", [ACT.lease]: "ticket", [ACT.zombie]: "rejected",
    };
    for (const [act, kind] of Object.entries(mechanic)) {
      const frames = steps.filter((s) => s.act === act).map((s) => s.state);
      const first = frames.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThan(0);
      expect(frames[first].events.map((e) => e.kind), act).toContain(kind);
      expect(frames.slice(first).every((w) => w.term === frames[first].term), act).toBe(true);
    }
    expect(steps.filter((s) => [ACT.hook, ACT.cheat].includes(s.act as never)).every((s) => s.state.term === null)).toBe(true);
  });

  it("два B: старый получил 0 строк, клиент отклонил повтор, дубля нет", () => {
    const s = last(ACT.zombie);
    expect(s.actors.B.affected).toBe(0);
    expect(rowById(s, 1).status).toBe("done");
    expect(s.deliveries.map((d) => d.rejected)).toEqual([false, true]);
    expect(duplicates(s)).toEqual([]);
  });
});
