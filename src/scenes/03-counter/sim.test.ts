import { describe, expect, it } from "vitest";
import { ACT, buildSteps } from "./script";
import {
  ACTORS, POOL, click, contended, dbLoad, doubled, drain, flood, flush, kill, lost, pending, restart, shard, sigterm, spawn, stop, world,
  type World,
} from "./sim";
import { flashbackState } from "./view";

const batching = (): World => {
  const w = world();
  w.mode = "batch";
  click(w, "A", 100);
  return w;
};

describe("модель счётчика", () => {
  it("+1 на клик: счёт точный, но поток выше потолка строки — очередь, пулы забиты, чужие ссылки ждут", () => {
    const w = world();
    click(w, "A");
    click(w, "B");
    expect(w.rows[0].clicks).toBe(w.clicked);
    flood(w, 10_000);
    expect(contended(w)).toBe(true);
    expect(ACTORS.every((id) => w.actors[id].waiting === POOL)).toBe(true);
    expect(w.starved).toBeGreaterThan(0);
  });

  it("go func(): ответ сразу, прибавки в фоне; рестарт теряет их — клик был, а в счёте его нет", () => {
    const w = world();
    w.mode = "async";
    click(w, "A", 50);
    expect(pending(w)).toBe(50);
    expect(lost(w)).toBe(0);
    drain(w, "A", 10);
    expect(w.rows[0].clicks).toBe(1_052);
    restart(w, "A");
    expect(lost(w)).toBe(40);
  });

  it("шарды: сумма та же, очереди к строке нет, но поток коммитов прежний — база занята", () => {
    const w = world();
    shard(w);
    expect(w.rows[0].shards!.reduce((a, b) => a + b, 0)).toBe(w.rows[0].clicks);
    click(w, "A", 5);
    expect(w.rows[0].shards!.reduce((a, b) => a + b, 0)).toBe(w.rows[0].clicks);
    flood(w, 10_000);
    expect(contended(w)).toBe(false);
    expect(dbLoad(w)).toBeGreaterThan(0.6);
    expect(dbLoad(w)).toBeLessThanOrEqual(1);
  });

  it("батч: клики в копилке, база спокойна, сброс одним UPDATE", () => {
    const w = batching();
    w.flow = 10_000;
    expect(dbLoad(w)).toBeLessThan(0.01);
    expect(w.rows[0].clicks).toBe(1_042);
    flush(w, "A");
    expect(w.rows[0].clicks).toBe(w.clicked);
    expect(w.actors.A.jar).toBe(0);
  });

  it("деплой без мягкой остановки теряет копилку; SIGTERM → сброс → гаснет — без потерь", () => {
    const w = batching();
    stop(w, "A");
    spawn(w, "A");
    expect(lost(w)).toBe(100);
    const v = batching();
    sigterm(v, "A");
    expect(() => click(v, "A")).toThrow();
    flush(v, "A");
    stop(v, "A");
    expect(lost(v)).toBe(0);
  });

  it("ответ потерялся после COMMIT: повтор без номера прибавляет батч дважды", () => {
    const w = batching();
    flush(w, "A", { lostReply: true });
    expect(w.actors.A.unsure).toBe(true);
    expect(w.actors.A.jar).toBe(100); // под не знает, дошло ли
    expect([lost(w), doubled(w)]).toEqual([0, 0]); // до повтора счёт верен
    flush(w, "A");
    expect(doubled(w)).toBe(100);
    expect(w.adds.at(-1)!.dup).toBe(true);
  });

  it("номер батча в той же транзакции: повтор база узнаёт и не прибавляет", () => {
    const w = batching();
    w.keyed = true;
    flush(w, "A", { lostReply: true });
    flush(w, "A");
    expect(doubled(w)).toBe(0);
    expect(lost(w)).toBe(0);
    expect(w.flushes).toEqual(["A · 17"]);
    expect(w.actors.A.seq).toBe(18);
  });

  it("kill -9 уносит копилку даже с номером батча", () => {
    const w = batching();
    w.keyed = true;
    kill(w, "A");
    expect(lost(w)).toBe(100);
  });
});

const steps = buildSteps();
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);
/** Кадр, где загорелась лампа попытки. */
const verdict = (act: string, nth = -1) => frames(act).filter((w) => w.events.some((e) => e.kind === "verdict")).at(nth)!;
const lamps = (w: World) => w.board!.attempts.at(-1)!.lamps;

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("закадр у каждого кадра; ярлык акта — не на первом кадре (механика сначала показана), но в акте есть", () => {
    expect(steps.every((s) => s.narration)).toBe(true);
    for (const act of [ACT.direct, ACT.async, ACT.sharded, ACT.batch, ACT.graceful, ACT.retry, ACT.keyed]) {
      expect(frames(act)[0].term, act).toBeNull();
      expect(frames(act).some((w) => w.term), act).toBe(true);
    }
  });

  it("кейс 1: табло «счёт точный / держим поток» сверено с моделью", () => {
    const direct = verdict(ACT.direct);
    expect([contended(direct), lost(direct), lamps(direct)]).toEqual([true, 0, ["green", "red"]]);
    const asyncJam = verdict(ACT.async, 0);
    // go func(): браузеры не ждут (ответ сразу), ждут фоновые горутины — пул забит.
    expect([asyncJam.starved, asyncJam.actors.A.waiting, lost(asyncJam), lamps(asyncJam)]).toEqual([0, POOL, 0, ["green", "red"]]);
    const asyncLost = verdict(ACT.async);
    expect(lost(asyncLost)).toBeGreaterThan(0);
    expect(lamps(asyncLost)).toEqual(["yellow", "red"]);
    const sh = verdict(ACT.sharded);
    expect([contended(sh), lost(sh), dbLoad(sh) > 0.6 && dbLoad(sh) <= 1, lamps(sh)]).toEqual([false, 0, true, ["green", "yellow"]]);
    const b = verdict(ACT.batch);
    expect([dbLoad(b) < 0.6, lost(b), pending(b) > 0, lamps(b)]).toEqual([true, 0, true, ["yellow", "green"]]);
  });

  it("кейс 2: табло «не теряем / не считаем дважды» сверено с моделью", () => {
    const dep = verdict(ACT.deploy);
    expect([lost(dep) > 0, doubled(dep), lamps(dep)]).toEqual([true, 0, ["red", "green"]]);
    const gr = verdict(ACT.graceful);
    expect([lost(gr), doubled(gr), lamps(gr)]).toEqual([0, 0, ["green", "green"]]);
    const re = verdict(ACT.retry);
    expect([lost(re), doubled(re) > 0, lamps(re)]).toEqual([0, true, ["green", "red"]]);
    const key = verdict(ACT.keyed, 0);
    expect([lost(key), doubled(key), lamps(key)]).toEqual([0, 0, ["green", "green"]]);
    const k9 = verdict(ACT.keyed);
    expect([lost(k9) > 0, doubled(k9), lamps(k9)]).toEqual([true, 0, ["yellow", "green"]]);
  });

  it("повтор батча: в журнале два одинаковых +N от одного пода — рифма «одна строка done, два письма»", () => {
    const w = verdict(ACT.retry);
    const [a, b] = w.adds.slice(-2);
    expect([a.by, a.n, a.dup, b.by, b.n, b.dup]).toEqual(["A", b.n, false, "A", a.n, true]);
  });

  it("отсылки к эпизоду 01 находят свои кадры", () => {
    const backs = steps.flatMap((s) => (s.state.flashback ? [s.state.flashback.voice] : []));
    expect(backs).toHaveLength(2);
    for (const v of backs) expect(() => flashbackState(v)).not.toThrow();
  });

  it("закадр: тире не больше одного на кадр, без разметки (синтез читает её вслух)", () => {
    const bad = steps.flatMap((s, i) => {
      const t = s.narration ?? "";
      return (t.match(/ — /g) ?? []).length > 1 || /[`*_#]/.test(t) ? [`кадр ${i + 1}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it("итог — повтор уже виденного", () => {
    const recap = frames(ACT.summary);
    expect(recap).toHaveLength(4);
    expect(recap.every((w) => w.replay)).toBe(true);
  });
});
