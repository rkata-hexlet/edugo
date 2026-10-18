import { describe, expect, it } from "vitest";
import { estimateMs, speakable } from "../../engine/narrator";
import { ACT, PRONOUNCE, buildSteps } from "./script";
import {
  claimLease, commit, complete, crash, duplicates, rollback, rowById, selectTask, send, stuck, updateTask, waitingFor, world,
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

  it("lease: до срока задачу не берут, после — перехватывают с новым токеном", () => {
    const w = world(1);
    expect(claimLease(w, "B")).toBe(1);
    w.clock = 30;
    expect(claimLease(w, "C")).toBeNull(); // lease_until < now() ещё ложно
    w.clock = 31;
    expect(claimLease(w, "C")).toBe(1);
    expect(w.actors.C.token).not.toBe(w.actors.B.token);
  });

  it("завершение по чужому (просроченному) токену задевает 0 строк", () => {
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

  it("письмо с ключом: повтор возвращает прошлый ответ, дубля нет; без ключа — дубль", () => {
    const w = world();
    send(w, "B", 1, true);
    send(w, "C", 1, true);
    expect(duplicates(w)).toEqual([]);
    send(w, "A", 2);
    send(w, "C", 2);
    expect(duplicates(w)).toEqual([2]);
    expect(w.events.map((e) => [e.kind, e.row, e.by])).toEqual([
      ["send", 1, "B"], ["replay", 1, "C"], ["send", 2, "A"], ["send", 2, "C"], ["duplicate", 2, "C"],
    ]);
  });

  it("застряла: замок у зависшего или «в работе» у упавшего без срока; с токеном и сроком — нет", () => {
    const w = world(1);
    selectTask(w, "B", "skip_locked");
    w.actors.B.frozen = true;
    expect(stuck(w)).toBe(true);
    const v = world(1);
    updateTask(v, "B", 1, { status: "in_progress" });
    commit(v, "B");
    crash(v, "B");
    expect(stuck(v)).toBe(true);
    const u = world(1);
    claimLease(u, "B");
    u.actors.B.carrying = 1;
    u.actors.B.frozen = true;
    expect(stuck(u)).toBe(false);
  });
});

describe("сценарий не врёт", () => {
  const steps = buildSteps();
  const frames = (act: string): World[] => steps.filter((s) => s.act === act).map((s) => s.state);
  const last = (act: string): World => frames(act).at(-1)!;
  const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);

  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("таблица фиксированная: всегда 6 задач, новые не появляются", () => {
    expect(steps.every((s) => s.state.rows.map((r) => r.id).join() === "1,2,3,4,5,6")).toBe(true);
  });

  it("хук: трое взяли #1 — три письма, в таблице одна строка done", () => {
    const s = steps[0].state;
    expect(steps[0].act).toBe(ACT.hook);
    expect(s.letters.map((l) => [l.row, l.by])).toEqual([[1, "A"], [1, "B"], [1, "C"]]);
    expect(rowById(s, 1).status).toBe("done");
    expect(s.board).toBeNull();
  });

  it("гонка и мьютекс: два письма по #1", () => {
    for (const act of [ACT.race, ACT.mutex]) {
      expect(last(act).letters.map((l) => l.row), act).toEqual([1, 1]);
    }
  });

  it("условный UPDATE: проигравшие ждали COMMIT и получили 0 строк, дублей нет", () => {
    const [waiting] = frames(ACT.cas).filter((w) => w.actors.B.pending && w.actors.C.pending);
    expect(rowById(waiting, 1).lockedBy).toBe("A");
    const [lost] = frames(ACT.cas).filter((w) => kinds(w).includes("zero"));
    expect(lost.events.filter((e) => e.kind === "zero").map((e) => e.by)).toEqual(["B", "C"]);
    expect(duplicates(last(ACT.cas))).toEqual([]);
    expect(last(ACT.cas).letters.map((l) => l.row)).toEqual([1, 2, 3]);
  });

  it("FOR UPDATE: конвой — C ждёт на #1, где замок перешёл от A к B", () => {
    const [convoy] = frames(ACT.forUpdate).filter((w) => w.actors.B.carrying === 2);
    expect(waitingFor(convoy.actors.C)).toBe(1);
    expect(rowById(convoy, 1)).toMatchObject({ lockedBy: "B", idle: true });
    expect(last(ACT.forUpdate).letters.map((l) => [l.row, l.by])).toEqual([[1, "A"], [2, "B"], [3, "C"]]);
  });

  it("SKIP LOCKED: B и C обходят занятые, никто не ждёт, всё разгребли без дублей", () => {
    const arcs = frames(ACT.skip).flatMap((w) => w.events.filter((e) => e.kind === "skip").map((e) => [e.by, e.row]));
    expect(arcs).toEqual([["B", 1], ["C", 1], ["C", 2]]);
    expect(frames(ACT.skip).some((w) => kinds(w).includes("wait"))).toBe(false);
    const s = last(ACT.skip);
    expect(s.rows.every((r) => r.status === "done")).toBe(true);
    expect(duplicates(s)).toEqual([]);
    expect(s.letters).toHaveLength(6);
  });

  it("держим транзакцию: через 10 минут #1 под замком зависшего B, в таблице всё ещё new", () => {
    const s = frames(ACT.stuck).find((w) => w.clock === 600)!;
    expect(rowById(s, 1)).toMatchObject({ lockedBy: "B", status: "new" });
    expect(s.actors.B.frozen).toBe(true);
  });

  it("lease: C перехватил #1 после истечения, замков нет", () => {
    const s = last(ACT.stuck);
    expect(rowById(s, 1)).toMatchObject({ token: "c21e", lockedBy: null });
  });

  it("зомби без ключа: одна строка done, писем два; с ключом — повтор ↺, дубля нет", () => {
    const noKey = frames(ACT.zombie).find((w) => duplicates(w).length > 0)!;
    expect(rowById(noKey, 1).status).toBe("done");
    expect(noKey.letters.map((l) => l.by)).toEqual(["B", "C"]);
    const s = last(ACT.zombie);
    expect(s.actors.B.affected).toBe(0);
    expect(rowById(s, 1).status).toBe("done");
    expect(s.letters.map((l) => l.replayed)).toEqual([false, true]);
    expect(duplicates(s)).toEqual([]);
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    steps.forEach((step, i) => {
      const w = step.state;
      const n = w.board?.attempts.length ?? 0;
      const t = w.board?.attempts[n - 1];
      const prev = i > 0 ? steps[i - 1].state : null;
      if (!t?.lamps || (prev?.chapter === w.chapter && prev.board?.attempts[n - 1]?.lamps)) return; // кадр оценки
      checked++;
      const attemptFrames = steps.slice(0, i + 1).map((s) => s.state)
        .filter((s) => s.chapter === w.chapter && s.board?.attempts.length === n);
      const [a, b] = t.lamps;
      if (w.chapter === 1) {
        expect(a === "red", t.name).toBe(duplicates(w).length > 0);
        expect(b === "green", t.name).toBe(!attemptFrames.some((s) => kinds(s).includes("wait")));
      } else {
        expect(a === "red", t.name).toBe(attemptFrames.some(stuck));
        expect(b === "red", t.name).toBe(duplicates(w).length > 0);
      }
    });
    expect(checked).toBe(9);
  });

  it("диктор есть во всех кадрах ролика (кроме двух последних кадров шпаргалки) и не читает SQL", () => {
    const voiced = steps.slice(0, -2);
    expect(voiced.every((s) => s.narration), "кадр без голоса").toBe(true);
    expect(steps.slice(-2).every((s) => !s.narration)).toBe(true);
    for (const s of voiced) expect(s.narration).not.toMatch(/SELECT|WHERE id|BEGIN|COMMIT;/);
  });

  it("закадр без телеграфного стиля: не больше одного тире на кадр (CLAUDE.md «Закадровый голос»)", () => {
    const choppy = steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration);
    expect(choppy).toEqual([]);
  });

  it("в речь диктора не попадает латиница без произношения в словаре; о собеседованиях не говорим", () => {
    for (const s of steps.filter((x) => x.narration)) {
      expect(speakable(s.narration!, PRONOUNCE), s.narration).not.toMatch(/[A-Za-z]/);
    }
    const screen = steps.flatMap((s) => [s.caption, s.narration ?? "", s.state.card ?? "", s.state.plate ?? ""]);
    expect(screen.filter((t) => /собес/i.test(t))).toEqual([]);
  });

  // Временно 4:50 (сейчас ≈4:49: знакомство с миром + микрошаги + пауза перед голосом) — до решения
  // пользователя после прослушивания; цель была 3:30. Не поднимать молча: каждое повышение — в «Обсуждения».
  it("хронометраж ≤ 4:50: кадр длится, пока не истечёт hold и не договорит диктор", () => {
    // голос начинается через 0.5 с после показа кадра (плеер), между фразами ~0.4 с
    const voice = (s: (typeof steps)[number]) => (s.narration ? 0.5 + estimateMs(s.narration) / 1000 + 0.4 : 0);
    const seconds = steps.reduce((sum, s) => sum + Math.max(s.hold ?? 0, voice(s)), 0);
    expect(seconds).toBeLessThanOrEqual(290);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.race]: "duplicate", [ACT.mutex]: "duplicate", [ACT.cas]: "zero", [ACT.forUpdate]: "relock",
      [ACT.skip]: "skip", [ACT.stuck]: "ticket", [ACT.zombie]: "replay",
    };
    for (const [act, kind] of Object.entries(mechanic)) {
      const fs = frames(act);
      const first = fs.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThan(0);
      expect(fs.slice(0, first + 1).some((w) => kinds(w).includes(kind)), act).toBe(true); // механика уже показана
      expect(fs.slice(first).every((w) => w.term === fs[first].term), act).toBe(true);
    }
    const bare = [ACT.hook, ACT.intro, ACT.case1, ACT.case2, ACT.cheat] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });
});
