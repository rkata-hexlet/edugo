import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, PRONOUNCE, buildSteps } from "./script";
import {
  active, book, capture, charge, claim, crash, doneLamp, evenLamp, hold, insert, logged, net, nextStep, noRefundLamp, onceLamp,
  openLog, press, refund, release, settle, spawn, world, type EventKind, type World,
} from "./sim";

const fresh = (free = 3, keyed = false): World => {
  const w = world();
  w.supplier.free = free;
  w.keyed = keyed;
  press(w);
  return w;
};

describe("модель саги брони", () => {
  it("в лоб, нет мест: списано, брони нет, строка висит в pending", () => {
    const w = fresh(0);
    insert(w, "A");
    charge(w, "A");
    expect(book(w, "A")).toBe("full");
    expect([net(w), active(w).length, w.booking!.status]).toEqual([1, 0, "pending"]);
    expect([evenLamp(w), noRefundLamp(w)]).toEqual(["red", "green"]);
  });

  it("компенсация: возврат — новая строка выписки, списание не стирается", () => {
    const w = fresh(0);
    insert(w, "A");
    charge(w, "A");
    book(w, "A");
    refund(w, "A");
    settle(w, "A", "cancelled");
    expect(w.gateway.statement).toEqual(["charge", "refund"]);
    expect([evenLamp(w), noRefundLamp(w)]).toEqual(["green", "red"]);
  });

  it("холд → нет мест → снять холд: выписка пустая, деньги не уходили", () => {
    const w = fresh(0);
    insert(w, "A");
    hold(w, "A");
    expect(w.gateway.frozen).toBe(true);
    book(w, "A");
    release(w, "A");
    expect([w.gateway.statement, w.gateway.frozen]).toEqual([[], false]);
  });

  it("холд → бронь → списание холда: одна строка списания, бронь есть", () => {
    const w = fresh(1);
    insert(w, "A");
    hold(w, "A");
    expect(book(w, "A")).toBe("ok");
    capture(w, "A");
    expect([w.gateway.statement, active(w).length, w.gateway.frozen]).toEqual([["charge"], 1, false]);
  });

  it("сага в памяти: под упал — память пропала, строка в pending", () => {
    const w = fresh();
    spawn(w, "A");
    insert(w, "A");
    hold(w, "A");
    book(w, "A");
    expect(w.pods.A.memory).toBe(3);
    crash(w, "A");
    expect([w.pods.A.memory, w.pods.A.down, doneLamp(w)]).toEqual([null, true, "red"]);
  });

  it("журнал без ключа: под умер между бронью и записью — повтор создаёт вторую бронь", () => {
    const w = fresh();
    openLog(w, "A");
    logged(w, "A", "старт", () => insert(w, "A"));
    logged(w, "A", "холд", () => hold(w, "A"));
    logged(w, "A", "бронь", () => book(w, "A"), true);
    claim(w, "B");
    expect(nextStep(w)).toBe("бронь");
    book(w, "B");
    expect(active(w).map((b) => b.ref)).toEqual(["R-1042", "R-1043"]);
    expect(onceLamp(w)).toBe("red");
  });

  it("с ключом поставщик узнаёт повтор и возвращает ту же бронь", () => {
    const w = fresh(3, true);
    insert(w, "A");
    book(w, "A");
    book(w, "B");
    expect(active(w).length).toBe(1);
    expect(w.events.map((e) => e.kind)).toContain("same");
  });

  it("снятие холда спотыкается failNext раз и проходит повтором", () => {
    const w = fresh(0, true);
    insert(w, "A");
    hold(w, "A");
    w.gateway.failNext = 2;
    expect([release(w, "A"), release(w, "A"), release(w, "A")]).toEqual([false, false, true]);
    expect(w.gateway.frozen).toBe(false);
  });
});

const steps = buildSteps();
const kinds = (w: World): EventKind[] => w.events.map((e) => e.kind);
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("раскадровка v1 со слияниями: 28 кадров + итог из 6 образов", () => {
    expect(steps.length).toBe(34);
  });

  it("хук: деньги ушли, брони нет, строка висит в pending", () => {
    const after = frames(ACT.hook)[1];
    expect([net(after), active(after).length, after.booking!.status, after.guest.site]).toEqual([1, 0, "pending", "error"]);
  });

  it("табло не врёт: лампы кадра оценки сверены с моделью кейса", () => {
    let checked = 0;
    for (const s of steps) {
      const e = s.state.events.find((x) => x.kind === "verdict");
      if (!e) continue;
      checked++;
      const w = s.state;
      const model = w.chapter === 1 ? [evenLamp(w), noRefundLamp(w)] : [doneLamp(w), onceLamp(w)];
      e.lamps!.forEach((l, i) => l && expect(l, `${s.act}: лампа ${i + 1}`).toBe(model[i]));
    }
    expect(checked).toBe(7);
  });

  it("журнал без ключа даёт дубль, с ключом — одну бронь", () => {
    const dup = frames(ACT.journal).at(-1)!;
    expect(active(dup).length).toBe(2);
    const keyed = frames(ACT.keyed)[0];
    expect([active(keyed).length, keyed.booking!.status]).toEqual([1, "confirmed"]);
  });

  it("компенсация — стрелка вперёд: ⟲ в эпизоде один раз, на холде", () => {
    expect(steps.filter((s) => s.state.stamp?.includes("⟲")).map((s) => s.act)).toEqual([ACT.tcc]);
    expect(steps.filter((s) => s.narration?.includes("⟲"))).toEqual([]);
  });

  it("диктор есть во всех кадрах и не читает код", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/INSERT INTO|UPDATE bookings|\.Exec|\.Charge|\.Book/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; «откатываем» не говорим", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[ABC](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес/i.test(s.narration ?? "") || /собес/i.test(s.state.plate ?? ""))).toEqual([]);
    expect(steps.filter((s) => /откатыва/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("не обещаем лишнего", () => {
    const all = steps.map((s) => s.narration ?? "").join(" ");
    for (const bad of [/атомарн/i, /exactly.once/i, /ровно один раз/i, /гарантирует/i]) expect(all).not.toMatch(bad);
  });

  it("реплики персонажей короткие", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
    const says = steps.flatMap((s) => [s.state.gateway.say, s.state.supplier.say]);
    // Пузырь внешнего сервиса — в рамке шириной 360: длиннее 22 знаков вылезает за край кадра.
    expect(says.filter((t) => t && t.length > 22)).toEqual([]);
    expect(steps.map((s) => s.state.guest.thought).filter((t) => t && t.length > 32)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики и держится до конца акта", () => {
    const mechanic: Record<string, (w: World) => boolean> = {
      "Compensating transaction": (w) => kinds(w).includes("refund"),
      Saga: (w) => w.chain === "pairs",
      "Try-Confirm-Cancel": (w) => kinds(w).includes("hold") && kinds(w).includes("capture"),
      "Saga log": (w) => !!w.saga && kinds(w).includes("log"),
      "Idempotency key": (w) => w.keyed && kinds(w).includes("same"),
    };
    for (const [term, shown] of Object.entries(mechanic)) {
      const i = steps.findIndex((s) => s.state.term === term);
      expect(i, term).toBeGreaterThanOrEqual(0);
      expect(shown(steps[i].state), term).toBe(true);
      // Держится до конца акта или до следующего ярлыка того же акта (Saga сменяет Compensating transaction).
      const act = steps[i].act;
      const rest = steps.slice(i).filter((s) => s.act === act);
      const until = rest.findIndex((s) => s.state.term !== term && s.state.term! in mechanic);
      expect(rest.slice(0, until < 0 ? undefined : until).every((s) => s.state.term === term), term).toBe(true);
    }
    const bare = [ACT.case1, ACT.case2, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });

  it("отказ и компенсацию журнал помнит так же, как шаги (кадры «вперёд или исправлять»)", () => {
    const fixes = steps.filter((s) => s.act !== ACT.summary && (s.state.fork === "fix" || s.state.fork === "retry"));
    expect(fixes).toHaveLength(2);
    for (const s of fixes) {
      const state = Object.fromEntries(s.state.saga!.entries.map((e) => [e.step, e.state]));
      expect(state).toMatchObject({ холд: "отменён", бронь: "отказ" });
    }
  });
});
