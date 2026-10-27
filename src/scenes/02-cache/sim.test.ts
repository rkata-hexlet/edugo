import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, buildSteps, clock } from "./script";
import {
  HOT, NEW, OLD, addRedis, click, commit, crash, del, entry, get, l1get, nodeLoads, overloaded, peakLoad, pocket, publish,
  select, set, update, world, type EventKind, type World,
} from "./sim";

const cachedWorld = (): World => {
  const w = world();
  addRedis(w);
  w.redis!.entries.push({ key: HOT, value: OLD, expiresAt: 3600, ttl: 3600 });
  return w;
};

describe("модель кэша", () => {
  it("cache-aside: промах → база → SET; следующий клик — попадание, база не тронута", () => {
    const w = world();
    addRedis(w);
    click(w, "A");
    expect(w.actors.A.acts.map((a) => a.kind)).toEqual(["get", "select", "set"]);
    click(w, "B");
    expect(w.actors.B.acts.map((a) => a.kind)).toEqual(["get"]);
    expect(w.clicks.map((c) => c.url)).toEqual([OLD, OLD]);
  });

  it("чтение не ждёт чужую транзакцию: видит последнее закоммиченное, автор — свою правку", () => {
    const w = world();
    update(w, "A", NEW);
    expect(select(w, "B")).toBe(OLD);
    expect(select(w, "A")).toBe(NEW);
    commit(w, "A");
    expect(select(w, "B")).toBe(NEW);
  });

  it("старый адрес до COMMIT — не враньё; после COMMIT — враньё", () => {
    const w = cachedWorld();
    update(w, "A", NEW);
    expect(click(w, "B").stale).toBe(false);
    commit(w, "A");
    expect(click(w, "C").stale).toBe(true);
  });

  it("просроченную запись Redis не отдаёт; DEL сообщает, сколько удалил", () => {
    const w = cachedWorld();
    w.clock = 3600;
    expect(entry(w)).toBeNull();
    expect(get(w, "A")).toBeNull();
    expect(del(w, "A")).toBe(0);
    w.clock = 0;
    w.redis!.entries.push({ key: HOT, value: OLD, expiresAt: 10, ttl: 10 });
    expect(del(w, "A")).toBe(1);
  });

  it("удалить, потом база: читатель в щели кладёт старое на весь TTL", () => {
    const w = cachedWorld();
    del(w, "A");
    update(w, "A", NEW);
    click(w, "B"); // промах → база → старое (не закоммичено) → SET
    commit(w, "A");
    expect(entry(w)!.value).toBe(OLD);
    expect(entry(w)!.expiresAt - w.clock).toBe(3600);
    expect(click(w, "C").stale).toBe(true);
  });

  it("база, потом удалить: следующий промах берёт свежее", () => {
    const w = cachedWorld();
    update(w, "A", NEW);
    commit(w, "A");
    del(w, "A");
    expect(click(w, "B").url).toBe(NEW);
    expect(click(w, "C").stale).toBe(false);
  });

  it("под упал после COMMIT: правка в базе, ключ в кэше; незакоммиченная правка откатилась бы", () => {
    const w = cachedWorld();
    update(w, "A", NEW);
    commit(w, "A");
    crash(w, "A");
    expect(w.links[0].url).toBe(NEW);
    expect(entry(w)!.value).toBe(OLD);
    const v = cachedWorld();
    update(v, "A", NEW);
    crash(v, "A");
    expect([v.links[0].url, v.links[0].draft, v.links[0].lockedBy]).toEqual([OLD, null, null]);
  });

  it("нагрузка: без кэша база за потолком; с кэшем — спокойна; горячий ключ топит свой узел", () => {
    const w = world();
    w.flow = 20_000;
    expect(overloaded(w)).toBe(true);
    addRedis(w);
    expect(overloaded(w)).toBe(false);
    w.flow = 200_000;
    addRedis(w, 4, 3);
    const loads = nodeLoads(w);
    expect(loads[2]).toBeGreaterThan(1);
    expect(loads.filter((_, i) => i !== 2).every((x) => x > 0 && x < 0.6)).toBe(true); // соседи не пусты
    addRedis(w, 6, 5);
    expect(nodeLoads(w)[4]).toBeGreaterThan(1);
    w.l1 = true;
    expect(peakLoad(w)).toBeLessThan(0.6);
  });

  it("L1: живой карман отвечает без Redis; истёкший — идёт в Redis; рассылка чистит чужие карманы", () => {
    const w = cachedWorld();
    w.l1 = true;
    w.actors.B.hand = OLD;
    pocket(w, "B", 2);
    expect(l1get(w, "B")).toBe(OLD);
    w.clock = 2;
    w.actors.B.acts = [];
    click(w, "B");
    expect(w.actors.B.acts.map((a) => a.kind)).toEqual(["l1", "get"]);
    w.actors.C.hand = OLD;
    pocket(w, "C", 5);
    publish(w, "A");
    expect(w.actors.C.l1).toBeNull();
  });

  it("SET без значения в руках — ошибка сценария, а не тихая запись", () => {
    const w = world();
    addRedis(w);
    expect(() => set(w, "A")).toThrow();
  });
});

const steps = buildSteps();
const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("хук: все клики идут в базу, база за потолком, страницы грузятся медленно", () => {
    const w = steps[0].state;
    expect(w.redis).toBeNull();
    expect(overloaded(w)).toBe(true);
    expect(w.clicks.every((c) => c.slow)).toBe(true);
  });

  it("каждая попытка кейса 1 стартует одинаково: свежий стол, правка — в первом кадре попытки", () => {
    for (const act of [ACT.hour, ACT.short, ACT.delFirst, ACT.dbFirst]) {
      const k = kinds(frames(act)[0]);
      expect(k[0], act).toBe("page");
      expect(k, act).toContain("update");
    }
  });

  it("рассылка — строго после COMMIT и DEL", () => {
    const k = frames(ACT.pubsub).flatMap(kinds); // шаги разнесены по кадрам акта — порядок по всему акту
    expect(k.indexOf("commit")).toBeLessThan(k.indexOf("del"));
    expect(k.indexOf("del")).toBeLessThan(k.indexOf("publish"));
    expect(k).toContain("publish");
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    steps.forEach((step, i) => {
      const w = step.state;
      if (!kinds(w).includes("verdict")) return;
      checked++;
      const n = w.board!.attempts.length;
      const t = w.board!.attempts[n - 1];
      const attempt = steps.slice(0, i + 1).map((s) => s.state).filter((s) => s.chapter === w.chapter && s.board?.attempts.length === n);
      const lied = attempt.some((s) => s.clicks.some((c) => c.stale));
      const peak = Math.max(...attempt.map(peakLoad));
      const loadLamp = peak > 1 ? "red" : peak > 0.6 ? "yellow" : "green";
      const [fresh, calm] = t.lamps!;
      if (fresh) expect(fresh === "green", `${t.name}: свежесть`).toBe(!lied);
      if (calm) expect(calm, `${t.name}: нагрузка`).toBe(loadLamp);
    });
    expect(checked).toBe(10);
  });

  it("диктор есть во всех кадрах и не читает команды целиком", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/SELECT|WHERE|BEGIN|EX \d/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски (одиночной латинской буквы синтез не читает); о собеседованиях не говорим", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[ABC](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес/i.test(s.narration ?? "") || /собес/i.test(s.state.plate ?? ""))).toEqual([]);
  });

  it("реплика Postgres — до 37 знаков (пузырь не наезжает на значок кейса)", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.intro]: "hit", [ACT.hour]: "stale", [ACT.delFirst]: "stale", [ACT.dbFirst]: "del",
      [ACT.lost]: "expire", [ACT.hot]: "overload", [ACT.local]: "l1hit", [ACT.pubsub]: "publish",
    };
    for (const [act, kind] of Object.entries(mechanic)) {
      const fs = frames(act);
      const first = fs.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(fs.slice(0, first + 1).some((w) => kinds(w).includes(kind)), act).toBe(true);
      expect(fs.slice(first).every((w) => w.term === fs[first].term), act).toBe(true);
    }
    const bare = [ACT.hook, ACT.case1, ACT.case2, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });

  it("часы не идут назад внутри сцены (кроме перемотки и итога)", () => {
    for (let i = 1; i < steps.length; i++) {
      const s = steps[i];
      if (s.act !== steps[i - 1].act || s.act === ACT.summary || s.state.stamp?.startsWith("⟲ Вернёмся")) continue;
      expect(s.state.clock, `кадр ${i + 1}`).toBeGreaterThanOrEqual(steps[i - 1].state.clock);
    }
    expect(clock(3600 + 61)).toBe("13:01:01");
  });
});
