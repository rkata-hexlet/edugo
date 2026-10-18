import { describe, expect, it } from "vitest";
import { ACT, buildSteps } from "./script";
import {
  claimLease, commit, complete, crash, deliver, duplicates, rollback, rowById, selectTask, updateTask, waitingFor, world,
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

  it("условный UPDATE: проигравший ждёт COMMIT победителя, перепроверяет WHERE — 0 строк", () => {
    const w = world();
    updateTask(w, "A", 1, { status: "in_progress" }, { status: "new" });
    updateTask(w, "B", 1, { status: "in_progress" }, { status: "new" });
    expect(waitingFor(w.actors.B)).toBe(1);
    expect(w.actors.B.affected).toBeNull();
    commit(w, "A");
    expect(waitingFor(w.actors.B)).toBeNull();
    expect([w.actors.A.affected, w.actors.B.affected]).toEqual([1, 0]);
    expect(rowById(w, 1).lockedBy).toBeNull(); // 0 строк — строку не блокирует
  });

  it("условный UPDATE: победитель откатился — ждавший задевает строку", () => {
    const w = world();
    updateTask(w, "A", 1, { status: "in_progress" }, { status: "new" });
    updateTask(w, "B", 1, { status: "in_progress" }, { status: "new" });
    rollback(w, "A");
    expect(w.actors.B.affected).toBe(1);
    expect(rowById(w, 1).lockedBy).toBe("B");
  });

  it("два ждавших UPDATE: второй ждёт уже первого", () => {
    const w = world();
    updateTask(w, "A", 1, { status: "in_progress" });
    updateTask(w, "B", 1, { status: "done" });
    updateTask(w, "C", 1, { status: "done" });
    commit(w, "A");
    expect(rowById(w, 1).lockedBy).toBe("B");
    expect(waitingFor(w.actors.C)).toBe(1);
  });

  it("падение пода: транзакция откатилась, замков нет, правки не видны", () => {
    const w = world();
    selectTask(w, "B", "for_update");
    updateTask(w, "B", 1, { status: "in_progress" });
    crash(w, "B");
    expect(rowById(w, 1)).toMatchObject({ status: "new", lockedBy: null, draft: null });
    expect(w.actors.B.present).toBe(false);
  });

  it("упал после COMMIT in_progress: без lease задачу не берёт никто, с lease — после срока", () => {
    const w = world(1);
    updateTask(w, "B", 1, { status: "in_progress" });
    commit(w, "B");
    crash(w, "B");
    selectTask(w, "A", "skip_locked");
    expect(w.actors.A.seen).toBeNull();

    const v = world(1);
    claimLease(v, "B");
    crash(v, "B");
    v.clock = 31;
    expect(claimLease(v, "A")).toBe(1);
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
    expect(rowById(w, 1)).toMatchObject({ lockedBy: "B", idle: true }); // заблокирована, но не возвращена
    expect(rowById(w, 2)).toMatchObject({ lockedBy: "B", idle: false });
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
    claimLease(w, "C");
    complete(w, "B", 1, true);
    expect(w.actors.B.affected).toBe(0);
    expect(rowById(w, 1).status).toBe("in_progress");
    complete(w, "C", 1, true);
    expect(rowById(w, 1).status).toBe("done");
  });

  it("идемпотентная доставка: повтор отклонён, дубля нет", () => {
    const w = world();
    deliver(w, "B", 1, true);
    deliver(w, "C", 1, true);
    expect(duplicates(w)).toEqual([]);
    deliver(w, "A", 2);
    deliver(w, "C", 2);
    expect(duplicates(w)).toEqual([2]);
    expect(w.events.filter((e) => e.row === 2).map((e) => [e.kind, e.by])).toEqual([
      ["deliver", "A"], ["deliver", "C"], ["duplicate", "C"],
    ]);
  });
});

describe("сценарий не врёт", () => {
  const steps = buildSteps();
  const last = (act: string): World => steps.filter((s) => s.act === act).at(-1)!.state;

  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("хук: двое у двери заказа 1, посылка получена дважды, талонов ещё нет", () => {
    const s = steps[0].state;
    expect(steps[0].act).toBe(ACT.hook);
    expect(duplicates(s)).toEqual([1]);
    expect([s.actors.B.at, s.actors.C.at]).toEqual([{ kind: "door", row: 1 }, { kind: "door", row: 1 }]);
    expect(s.actors.A.present).toBe(false);
    expect(s.rows.every((r) => r.token === null && r.leaseUntil === null)).toBe(true);
    expect(s.client?.row).toBe(1);
  });

  it("час пик: дубль", () => {
    expect(duplicates(last(ACT.race))).toEqual([3]);
  });

  it("наивная перепроверка: оба держат #1", () => {
    const s = steps.filter((x) => x.act === ACT.naive).map((x) => x.state).find((w) => w.actors.A.carrying === 1)!;
    expect(s.actors.B.carrying).toBe(1);
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
    const s = steps.filter((x) => x.act === ACT.lease).map((x) => x.state).find((w) => w.clock === 600)!;
    expect(rowById(s, 1).lockedBy).toBe("B");
    expect([s.actors.A.seen, s.actors.C.seen]).toEqual([2, 3]);
  });

  it("талон: C перехватил #1 после истечения, замков нет", () => {
    const s = last(ACT.lease);
    expect(rowById(s, 1)).toMatchObject({ token: "c21e", lockedBy: null });
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.race]: "race", [ACT.naive]: "mutex", [ACT.crowd]: "zero", [ACT.convoy]: "wait",
      [ACT.skip]: "skip", [ACT.lease]: "ticket", [ACT.zombie]: "zero",
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

  it("B и C: старый B получил 0 строк, клиент отклонил повтор, дубля нет", () => {
    const s = last(ACT.zombie);
    expect(s.actors.B.affected).toBe(0);
    expect(rowById(s, 1).status).toBe("done");
    expect(s.deliveries.map((d) => d.rejected)).toEqual([false, true]);
    expect(duplicates(s)).toEqual([]);
  });
});
