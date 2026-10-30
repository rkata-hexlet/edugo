import { describe, expect, it } from "vitest";
import {
  FLAG, GUEST, GUESTS, OTHER, PODS, boot, bucket, cancelled, contract, decide, expand, oldBranch, seed, serviceDown, slide, startBooking,
  tick, toggle, visit, world, writeNew, allows, type World,
} from "./sim";

const local = (percent = 100): World => {
  const w = world();
  w.mode = "local";
  w.service = "up";
  w.console = { on: true, percent, salted: true };
  for (const id of PODS) boot(w, id);
  return w;
};

describe("модель эпизода 14: фичефлаг", () => {
  it("бакеты гостей под флагом оплаты — 07 · 24 · 58 · 91, у второго флага — другие", () => {
    expect(GUESTS.map((g) => bucket(g))).toEqual([7, 24, 58, 91]);
    expect(GUESTS.map((g) => bucket(g, OTHER))).not.toEqual([7, 24, 58, 91]);
    // Без соли бакет один на все флаги.
    expect(GUESTS.map((g) => bucket(g, FLAG, false))).toEqual(GUESTS.map((g) => bucket(g, OTHER, false)));
  });

  it("монетка: один и тот же гость получает то новую оплату, то старую", () => {
    const w = world();
    w.mode = "coin";
    const seen = new Set([0, 1, 2, 3].map(() => decide(w, "A")));
    expect(seen).toEqual(new Set([true, false]));
  });

  it("10 % → 30 %: прежние гости остаются, добавляются новые", () => {
    const r = { on: true, percent: 10, salted: true };
    const before = GUESTS.filter((g) => allows(r, g));
    const w = world();
    w.console = { ...r };
    slide(w, 30);
    const after = GUESTS.filter((g) => allows(w.console, g));
    expect(before).toEqual(["g1333"]);
    expect(after).toEqual(["g1333", "g1004"]);
  });

  it("remote: сервис флагов лежит — под виснет на каждом запросе", () => {
    const w = world();
    w.mode = "remote";
    w.service = "up";
    w.console.on = true;
    expect(visit(w, "A").fresh).toBe(true);
    serviceDown(w);
    expect(visit(w, "B").fresh).toBe("hang");
    expect(w.pods.B.hanging).toBe(true);
  });

  it("local: сервис лёг — под держит последнюю копию и пишет в лог", () => {
    const w = local();
    serviceDown(w);
    tick(w, 30);
    expect(PODS.every((id) => w.pods[id].log === "flags: refresh failed")).toBe(true);
    expect(visit(w, "A").fresh).toBe(true);
  });

  it("под запустился без сервиса — работает дефолт из кода, false", () => {
    const w = local();
    serviceDown(w);
    boot(w, "C");
    expect(w.pods.C.copy).toBeNull();
    expect(visit(w, "C").fresh).toBe(false);
  });

  it("переключение пульта: поды расходятся, пока не обновят копию", () => {
    const w = local();
    toggle(w, false);
    // Выключили: A обновится на 4-й секунде, B — на 17-й.
    tick(w, 5);
    expect(visit(w, "A").fresh).toBe(false);
    expect(visit(w, "B").fresh).toBe(true);
    tick(w, 30);
    expect(visit(w, "B").fresh).toBe(false);
  });

  it("решение записано с бронью: другой под читает его, а не флаг", () => {
    const w = local();
    const b = startBooking(w, "A");
    expect(b.flow).toBe("new");
    w.pods.B.copy = { on: false, percent: 0, salted: true };
    expect(visit(w, "B").fresh).toBe(true);
    expect(b.guest).toBe(GUEST);
  });

  it("старая ветка отменяет брони at_hotel, пока под не умеет их читать", () => {
    const w = world();
    seed(w, [["H-8117", "paid"], ["H-8118", "pending"]]);
    writeNew(w, "H-8120");
    oldBranch(w, "A");
    expect(cancelled(w).map((b) => b.id)).toEqual(["H-8120"]);
  });

  it("после expand выключение флага ничего не отменяет; contract убирает флаг", () => {
    const w = world();
    seed(w, [["H-8117", "paid"]]);
    expand(w);
    toggle(w, true);
    writeNew(w, "H-8119");
    toggle(w, false);
    oldBranch(w, "A");
    expect(cancelled(w)).toEqual([]);
    expect(w.events.some((e) => e.kind === "keep")).toBe(true);
    contract(w);
    expect(w.contracted).toBe(true);
  });
});
