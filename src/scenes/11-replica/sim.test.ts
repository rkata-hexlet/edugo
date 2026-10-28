import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, buildSteps } from "./script";
import {
  ask, book, bookings, crowd, down, flood, head, primaryLamp, read, replayLsn, seesLamp, tick, wentBack, world,
  type EventKind, type Route, type World,
} from "./sim";

const sale = (route: Route, lags: [number, number] = [3000, 3000]): World => {
  const w = world();
  w.clock = 60_000;
  w.route = route;
  w.replicas[1].lag = lags[0];
  w.replicas[2].lag = lags[1];
  flood(w, 12, 4000);
  return w;
};

describe("модель чтения с реплик", () => {
  it("норма: реплика проигрывает бронь за миллисекунды", () => {
    const w = world();
    book(w);
    tick(w, 100);
    expect(read(w, "B", 1)).toEqual({ from: 1, seen: 1, mine: 1 });
  });

  it("лаг 3 с: реплика отвечает без ошибки, но из прошлого; через 3 с — видит", () => {
    const w = sale("replica");
    book(w);
    expect(read(w, "B", 1).seen).toBe(0);
    expect(seesLamp(w)).toBe("red");
    tick(w, 3000);
    expect(read(w, "B", 1).seen).toBe(1);
  });

  it("второе нажатие — две брони на primary", () => {
    const w = sale("replica");
    book(w);
    book(w);
    expect(bookings(w)).toBe(2);
  });

  it("всё с primary: гость видит, но листающие идут в primary", () => {
    const w = sale("primary");
    book(w);
    expect(read(w).from).toBe("primary");
    crowd(w);
    expect([seesLamp(w), primaryLamp(w)]).toEqual(["green", "red"]);
  });

  it("печать 2 с: пока горит — primary; погасла при лаге 3 с — реплика без брони", () => {
    const w = sale("seal");
    book(w);
    expect(read(w).from).toBe("primary");
    tick(w, 2500);
    expect(w.guest.sealUntil).toBeNull();
    expect(read(w, "B", 1)).toMatchObject({ from: 1, seen: 0 });
  });

  it("реплики с разным лагом: чтения идут назад во времени", () => {
    const w = sale("replica", [3000, 5000]);
    book(w);
    tick(w, 3500);
    read(w, "B", 1);
    read(w, "B", 2);
    expect(wentBack(w)).toBe(true);
  });

  it("метка LSN — конец ленты после COMMIT; читаем с реплики, что догнала, иначе primary", () => {
    const w = sale("lsn", [3000, 5000]);
    book(w);
    expect(w.guest.ticket).toBe(head(w));
    expect(read(w, "B", 1).from).toBe("primary"); // не догнала ни одна
    tick(w, 3500);
    expect(replayLsn(w, 1)).toBeGreaterThanOrEqual(w.guest.ticket!);
    expect(replayLsn(w, 2)).toBeLessThan(w.guest.ticket!);
    for (const id of [2, 1, 2] as const) expect(read(w, "B", id).from).toBe(1);
    expect(seesLamp(w)).toBe("green");
    expect(wentBack(w)).toBe(false);
  });

  it("отстающая реплика уверенно говорит «свободен» про занятый номер; primary — нет", () => {
    const w = sale("lsn", [3000, 5000]);
    book(w);
    expect(ask(w, "C", 2)).toBe(true);
    expect(ask(w, "C", "primary")).toBe(false);
  });

  it("remote_apply: COMMIT ждёт лаг синхронной реплики, с неё сразу видно, со второй — нет; легла — COMMIT висит", () => {
    const w = sale("sync", [3000, 5000]);
    w.replicas[1].sync = true;
    const t = w.clock;
    book(w);
    expect(w.clock - t).toBe(3000);
    expect(read(w, "B", 1)).toMatchObject({ from: 1, seen: 1 });
    expect(read(w, "B", 2)).toMatchObject({ from: 2, seen: 0 }); // асинхронная отстаёт по-прежнему
    expect(seesLamp(w)).toBe("red");
    down(w, 1);
    book(w);
    expect(w.guest.saving).toBe(true);
  });
});

const steps = buildSteps();
const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("25 кадров раскадровки + кадр мира + чтения в одну базу + оценка первой попытки + итог по образам", () => {
    expect(steps.length).toBe(30);
  });

  it("хук: «Мои брони» пусто, хотя бронь на primary; после второго нажатия — две", () => {
    const [, , empty, two] = frames(ACT.hook);
    expect(empty.guest.page).toBe(0);
    expect(bookings(empty)).toBe(1);
    expect(two.guest.page).toBe(2);
    expect(kinds(two)).toContain("dup");
  });

  it("табло не врёт: лампы кадра оценки сверены с моделью", () => {
    let checked = 0;
    for (const s of steps) {
      const e = s.state.events.find((x) => x.kind === "verdict");
      if (!e) continue;
      checked++;
      const model = [seesLamp(s.state), primaryLamp(s.state)];
      e.lamps!.forEach((l, i) => l && expect(l, `${s.act}: лампа ${i + 1}`).toBe(model[i]));
    }
    expect(checked).toBe(7);
  });

  it("monotonic reads: в кадре с ярлыком чтения идут назад, с меткой LSN — нет", () => {
    const flicker = steps.find((s) => s.state.term === "Monotonic reads")!.state;
    expect(wentBack(flicker)).toBe(true);
    expect(frames(ACT.lsn).every((w) => !wentBack(w))).toBe(true);
  });

  it("граница: реплика говорит «Свободен!» о номере, который на primary уже занят", () => {
    const w = frames(ACT.lsn).find((x) => x.replicas[2].say === "Свободен!")!;
    expect(w.pods.C.acts).toContainEqual({ kind: "ask", from: 2 });
    expect(bookings(w)).toBe(1);
  });

  it("диктор есть во всех кадрах и не читает код", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/INSERT|SELECT|\.Exec|\.Query/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; «пропала» — не говорит рассказчик", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[ABC](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес/i.test(s.narration ?? "") || /собес/i.test(s.state.plate ?? ""))).toEqual([]);
    expect(steps.filter((s) => /пропал/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("не обещаем лишнего", () => {
    const all = steps.map((s) => s.narration ?? "").join(" ");
    for (const bad of [/всегда увидит/i, /никогда не/i, /sticky session/i, /linearizab/i, /strong consistency/i, /master/i, /slave/i, /failover/i]) {
      expect(all).not.toMatch(bad);
    }
  });

  it("реплики персонажей короткие", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
    const says = steps.flatMap((s) => [s.state.replicas[1].say, s.state.replicas[2].say, s.state.guest.thought]);
    expect(says.filter((t) => t && t.length > 20)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, (w: World) => boolean> = {
      "Read replica": (w) => w.crowd === "replicas",
      "Replication lag": (w) => w.replicas[1].lag >= 1000 && kinds(w).includes("flood"),
      "Read-your-writes": (w) => kinds(w).includes("seal"),
      "Monotonic reads": (w) => wentBack(w),
      "Synchronous replication": (w) => w.replicas[1].sync && kinds(w).includes("commit"),
    };
    for (const [term, shown] of Object.entries(mechanic)) {
      const i = steps.findIndex((s) => s.state.term === term);
      expect(i, term).toBeGreaterThanOrEqual(0);
      expect(shown(steps[i].state), term).toBe(true);
      const act = steps[i].act;
      expect(steps.slice(i).filter((s) => s.act === act).every((s) => s.state.term === term), term).toBe(true);
    }
    const bare = [ACT.case1, ACT.case2, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });

  it("часы не идут назад внутри сцены (кроме итога)", () => {
    for (let i = 1; i < steps.length; i++) {
      const s = steps[i];
      if (s.state.scene !== steps[i - 1].state.scene || s.act === ACT.summary) continue;
      expect(s.state.clock, `кадр ${i + 1}`).toBeGreaterThanOrEqual(steps[i - 1].state.clock);
    }
  });
});
