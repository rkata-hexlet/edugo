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
