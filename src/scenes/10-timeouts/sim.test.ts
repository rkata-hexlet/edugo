import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, buildSteps, clock } from "./script";
import {
  OUR_REF, POOL, SUP_CAP, backlog, book, bookingsOf, closeBreaker, fastLamp, freeSlots, giveUp, guestLamp, halfOpen,
  resumeLamp, retryWave, search, searchLamp, serve, supplierLamp, timeout, world, type EventKind, type PodId, type World,
} from "./sim";

const slow = (timeout: number | null = null): World => {
  const w = world();
  w.supplier.latency = 30_000;
  w.bookFlow = 1.5;
  w.policy.timeout = timeout;
  backlog(w, 3);
  return w;
};
const fill = (w: World) => (["A", "B", "C", "A", "B", "C"] as PodId[]).forEach((id) => book(w, id));

describe("модель таймаутов и повторов", () => {
  it("быстрый поставщик: слот взят и сразу возвращён, гостю «забронировано»", () => {
    const w = world();
    book(w, "A");
    expect(freeSlots(w)).toBe(POOL);
    expect(w.replies.at(-1)!.status).toBe("ok");
    expect(bookingsOf(w)).toBe(1);
  });

  it("медленный поставщик внутри транзакции: брони держат все слоты, поиск встаёт в очередь", () => {
    const w = slow();
    fill(w);
    expect(freeSlots(w)).toBe(0);
    expect(search(w, "A").status).toBe("wait");
    expect(w.searchQueue).toBe(1);
    expect(searchLamp(w)).toBe("red");
    expect(guestLamp(w)).toBe("red");
  });

  it("таймаут возвращает слот, но карточка остаётся у поставщика — и бронь у него появится", () => {
    const w = slow(3000);
    book(w, "A");
    timeout(w, "A");
    expect(freeSlots(w)).toBe(POOL);
    expect(w.supplier.queue.find((c) => c.from === "A")!.abandoned).toBe(true);
    expect(w.replies.at(-1)!.status).toBe("unknown");
    serve(w, w.supplier.queue.length);
    expect(bookingsOf(w)).toBe(1);
    expect(searchLamp(w)).toBe("yellow"); // 1,5 брони/с × 3 с = 4,5 слота из 6
    expect(guestLamp(w)).toBe("yellow");
  });

  it("вызов вне транзакции слот не держит", () => {
    const w = slow(3000);
    w.policy.inTx = false;
    fill(w);
    expect(freeSlots(w)).toBe(POOL);
    expect(searchLamp(w)).toBe("green");
  });

  it("повтор без номера — вторая бронь; с нашим номером — та же", () => {
    for (const key of [false, true]) {
      const w = slow(3000);
      w.policy.key = key;
      book(w, "A");
      timeout(w, "A");
      book(w, "A", { retry: true });
      serve(w, w.supplier.queue.length);
      expect(bookingsOf(w), `key=${key}`).toBe(key ? 1 : 2);
      if (key) expect(w.supplier.rows[0].ref).toBe(OUR_REF);
    }
  });

  it("волна повторов: сразу и backoff бьют синхронно выше ёмкости; jitter разносит в пределах ёмкости", () => {
    expect(supplierLamp(retryWave("now", 3))).toBe("red");
    expect(supplierLamp(retryWave("backoff", 3))).toBe("red");
    expect(Math.max(...retryWave("jitter", 3))).toBeLessThanOrEqual(SUP_CAP);
    expect(supplierLamp(retryWave("jitter", 3))).toBe("yellow");
    expect(retryWave("jitter", 3).reduce((a, b) => a + b)).toBe(9); // повторов столько же — разнесены
    expect(supplierLamp(null)).toBe("green");
  });

  it("рубильник: три отказа подряд — размыкается, звонков нет; пробный прошёл — замыкается", () => {
    const w = slow(3000);
    w.supplier.latency = null;
    w.pods.A.breaker = "closed";
    for (let i = 0; i < 3; i++) {
      book(w, "A");
      timeout(w, "A");
    }
    expect(w.pods.A.breaker).toBe("open");
    const calls = w.supplier.queue.length;
    book(w, "A");
    expect(w.supplier.queue.length).toBe(calls);
    expect(w.replies.at(-1)!.status).toBe("later");
    w.supplier.latency = 200;
    w.supplier.queue = [];
    expect(resumeLamp(w)).toBe("red");
    halfOpen(w, "A");
    book(w, "A");
    closeBreaker(w, "A");
    expect(w.pods.A.breaker).toBe("closed");
    expect(resumeLamp(w)).toBe("green");
  });

  it("попытки кончились — гостю ошибка вместо «проверяем»", () => {
    const w = slow(3000);
    book(w, "A");
    timeout(w, "A");
    giveUp(w, "A");
    expect(w.replies.filter((r) => r.kind === "book").map((r) => r.status)).toEqual(["error"]);
    expect(fastLamp(w)).toBe("red");
  });

  it("таймаут без ожидания и бронь без слота — ошибка сценария", () => {
    expect(() => timeout(world(), "A")).toThrow();
    const w = slow();
    fill(w);
    expect(() => book(w, "A")).toThrow();
  });
});

const steps = buildSteps();
const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("хук: пул забит бронями, поиск в очереди, база при этом свободна от работы", () => {
    const w = frames(ACT.hook).at(-1)!;
    expect(w.pool.every((s) => s?.kind === "book")).toBe(true);
    expect(w.searchQueue).toBeGreaterThan(0);
  });

  it("кейс 2 открывается бронью у поставщика после нашего таймаута", () => {
    const [left, served] = frames(ACT.answer);
    expect(bookingsOf(left)).toBe(0);
    expect(kinds(left)).toContain("timeout");
    expect(bookingsOf(served)).toBe(1);
  });

  it("табло не врёт: лампы кадра оценки сверены с моделью", () => {
    const lamp = (w: World): [string | null, string | null] => {
      if (w.chapter === 1) return [searchLamp(w), guestLamp(w)];
      if (w.chapter === 2) return [bookingsOf(w) === 1 ? "green" : "red", supplierLamp(w.wave)];
      return [fastLamp(w), resumeLamp(w)];
    };
    let checked = 0;
    for (const s of steps) {
      const e = s.state.events.find((x) => x.kind === "verdict");
      if (!e) continue;
      checked++;
      const model = lamp(s.state);
      e.lamps!.forEach((l, i) => l && expect(l, `${s.act}: лампа ${i + 1}`).toBe(model[i]));
    }
    expect(checked).toBe(13);
  });

  it("диктор есть во всех кадрах и не читает код", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/BeginTx|INSERT|UPDATE|supplier\.Book/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; «не вышло» — только мысль пода", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[ABC](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес/i.test(s.narration ?? "") || /собес/i.test(s.state.plate ?? ""))).toEqual([]);
    expect(steps.filter((s) => /Не вышло/.test(s.narration ?? ""))).toEqual([]);
  });

  it("не обещаем лишнего", () => {
    const all = steps.map((s) => s.narration ?? "").join(" ");
    for (const bad of [/всегда пройд/i, /никогда/i, /спасает от каскада/i, /thundering herd/i, /load shedding/i, /exactly-once/i, /metastable/i]) {
      expect(all).not.toMatch(bad);
    }
  });

  it("реплика Postgres — до 37 знаков, мысль пода — короткая", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
    expect(steps.flatMap((s) => Object.values(s.state.pods).map((p) => p.thought)).filter((t) => t && t.length > 26)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.hook]: "jam", [ACT.timeout]: "timeout", [ACT.now]: "dup", [ACT.key]: "found", [ACT.backoff]: "wave",
      [ACT.jitter]: "spread", [ACT.open]: "trip", [ACT.half]: "probe",
    };
    for (const [act, kind] of Object.entries(mechanic)) {
      const fs = frames(act);
      const first = fs.findIndex((w) => w.term !== null);
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(fs.slice(0, first + 1).some((w) => kinds(w).includes(kind)), act).toBe(true);
      expect(fs.slice(first).every((w) => w.term === fs[first].term), act).toBe(true);
    }
    const bare = [ACT.intro, ACT.case1, ACT.case2, ACT.case3, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });

  it("часы не идут назад внутри сцены (кроме перемотки и итога)", () => {
    for (let i = 1; i < steps.length; i++) {
      const s = steps[i];
      if (s.act !== steps[i - 1].act || s.act === ACT.summary || s.state.stamp?.startsWith("⟲ Вернёмся")) continue;
      expect(s.state.clock, `кадр ${i + 1}`).toBeGreaterThanOrEqual(steps[i - 1].state.clock);
    }
    expect(clock(61_000)).toBe("12:01:01");
  });
});
