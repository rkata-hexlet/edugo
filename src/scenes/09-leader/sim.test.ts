import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, RECALL, buildSteps } from "./script";
import {
  LEASE, acquire, advance, charge, crash, cut, duplicated, factKey, finished, leaders, record, recorded, renew,
  tryLock, vanish, world, type EventKind, type World,
} from "./sim";

const kinds = (w: World) => w.events.map((e) => e.kind);

describe("модель ночной задачи", () => {
  it("advisory lock — у соединения: проигравший получает false; под убит — замок снят", () => {
    const w = world();
    expect(tryLock(w, "A")).toBe(true);
    expect(tryLock(w, "B")).toBe(false);
    crash(w, "A");
    expect(w.lockBy).toBeNull();
    expect(kinds(w)).toContain("unlock");
    expect(tryLock(w, "B")).toBe(true);
  });

  it("узел пропал без закрытия соединения — замок висит сколько угодно", () => {
    const w = world();
    tryLock(w, "A");
    vanish(w, "A");
    advance(w, 3 * 3600);
    expect(tryLock(w, "B")).toBe(false);
    expect(w.lockBy).toBe("A");
  });

  it("аренда: роль забирают только после срока; продление без связи с базой невозможно", () => {
    const w = world();
    expect(acquire(w, "A")).toBe(true);
    expect(acquire(w, "B")).toBe(false);
    advance(w, LEASE);
    expect(acquire(w, "B")).toBe(false); // срок ровно сейчас — ещё не вышел
    advance(w, 1);
    expect(acquire(w, "B")).toBe(true);
    expect(w.leader!.epoch).toBe(2);
    cut(w, "A");
    expect(() => renew(w, "A")).toThrow();
  });

  it("сменённый лидер узнаёт об этом только сам, на продлении: до того лидеров два", () => {
    const w = world();
    acquire(w, "A");
    advance(w, LEASE + 1);
    acquire(w, "B");
    expect(leaders(w)).toEqual(["A", "B"]);
    expect(renew(w, "A")).toBe(false);
    expect(leaders(w)).toEqual(["B"]);
  });

  it("банк: тот же ключ — прежний результат без списания; разные ключи — два списания", () => {
    const w = world();
    expect(charge(w, "A", 42, factKey(42))).toBe(true);
    expect(charge(w, "B", 42, factKey(42))).toBe(false);
    expect(duplicated(w)).toBe(false);
    charge(w, "B", 42, "k-7e20·42");
    expect(duplicated(w)).toBe(true);
  });

  it("без связи с базой под не пишет и не читает charges", () => {
    const w = world();
    record(w, "A", 42);
    cut(w, "A");
    expect(() => recorded(w, "A", 42)).toThrow();
    expect(recorded(w, "B", 42)).toBe(true);
  });
});

describe("сценарий эпизода 09", () => {
  const steps = buildSteps();
  const end = (act: string) => steps.filter((s) => s.act === act).at(-1)!.state;

  it("вставка эпизода 08 — повтор с ключом получает сохранённый ответ", () => {
    expect(RECALL).toBeGreaterThanOrEqual(0);
    expect(steps[0].state.flashback).toBe(RECALL);
  });

  it("хук: три пода — каждую подписку списали трижды", () => {
    const w = end(ACT.hook);
    expect(w.ledger).toHaveLength(9);
    expect(w.ira.notes).toBe(3);
  });

  it("1.1: под убит — замок снят, B доделал без дублей; 1.2: узел пропал — не доделали", () => {
    const lock = end(ACT.lock);
    expect(finished(lock) && !duplicated(lock)).toBe(true);
    const silent = end(ACT.silent);
    expect(silent.lockBy).toBe("A");
    expect(finished(silent)).toBe(false);
  });

  it("CronJob: перезапуск после банка до записи — дубль", () => {
    expect(duplicated(end(ACT.cronjob))).toBe(true);
  });

  it("2.2: два лидера сразу; 2.4: ключ из факта — одно списание каждой подписки", () => {
    const split = steps.filter((s) => s.act === ACT.split).at(-1)!.state;
    expect(leaders(split)).toEqual(["A", "B"]);
    expect(duplicated(split)).toBe(true);
    const key = steps.filter((s) => s.act === ACT.key).at(-1)!.state;
    expect(finished(key) && !duplicated(key)).toBe(true);
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    for (const step of steps) {
      const w = step.state;
      if (!kinds(w).includes("verdict")) continue;
      checked++;
      const t = w.board!.attempts.at(-1)!;
      const [first, second] = t.lamps!;
      const [once, done] = w.chapter === 1 ? [first, second] : [second, first];
      if (once) expect(once === "green", `${t.name}: одно списание`).toBe(!duplicated(w));
      if (done) expect(done === "green", `${t.name}: доделают`).toBe(finished(w));
    }
    expect(checked).toBe(8);
  });

  it("диктор есть во всех кадрах и не читает команды целиком", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/WHERE|UPDATE|SELECT/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; прошлые ролики — по теме; не «ровно»", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[ABC](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес|прошлом ролике|предыдущ|exactly.once|ровно/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("fencing token — только голосом: банк номер срока не проверяет, ярлыка Fencing нет", () => {
    expect(steps.filter((s) => /fencing/i.test(s.state.term ?? ""))).toEqual([]);
  });

  it("реплики Postgres и банка — до 37 знаков", () => {
    expect(steps.flatMap((s) => [s.state.db, s.state.bank]).filter((t) => t && t.length > 37)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.hook]: "double", [ACT.lock]: "lock", [ACT.silent]: "silent", [ACT.lease]: "takeover", [ACT.split]: "double",
      [ACT.check]: "double", [ACT.key]: "replayed",
    };
    for (const [act, kind] of Object.entries(mechanic)) {
      const inAct = steps.filter((s) => s.act === act);
      const first = inAct.findIndex((s) => s.state.term);
      const seen = inAct.findIndex((s) => kinds(s.state).includes(kind));
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(seen, act).toBeGreaterThanOrEqual(0);
      expect(first, act).toBeGreaterThanOrEqual(seen);
    }
  });
});
