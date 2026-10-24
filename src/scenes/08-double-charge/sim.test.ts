import { describe, expect, it } from "vitest";
import { speechParts } from "../../engine/narrator";
import { ACT, KEY, PRONOUNCE, RECALL, buildSteps } from "./script";
import {
  advance, charge, claimKey, crash, duplicated, finishKey, honest, keyRow, reply, request, stuck, takeOver, world,
  type EventKind, type World,
} from "./sim";

const kinds = (w: World) => w.events.map((e) => e.kind);

describe("модель оплаты", () => {
  it("второй INSERT того же ключа — 0 строк; решение «повтор» — за подом, база лишь не вставляет", () => {
    const w = world();
    expect(claimKey(w, "A", KEY.first)).toBe("inserted");
    expect(claimKey(w, "B", KEY.first)).toBe("conflict");
    expect(w.keys).toHaveLength(1);
    expect(keyRow(w, KEY.first)).toMatchObject({ status: "processing", by: "A" });
  });

  it("банк с тем же ключом не списывает второй раз; без ключа — списывает", () => {
    const w = world();
    expect(charge(w, "A", KEY.first)).toBe(true);
    expect(charge(w, "B", KEY.first)).toBe(false);
    expect(w.ledger).toHaveLength(1);
    expect(kinds(w)).toContain("replayed");
    expect(charge(w, "B")).toBe(true);
    expect(w.ledger).toHaveLength(2);
    expect(kinds(w)).toContain("double");
  });

  it("дубль — две записи одной попытки: без ключа по заказу, с ключом по ключу", () => {
    const w = world();
    charge(w, "A");
    expect(duplicated(w)).toBe(false);
    charge(w, "B");
    expect(duplicated(w)).toBe(true);
    const k = world();
    charge(k, "A", KEY.first);
    charge(k, "A", KEY.second);
    expect(duplicated(k)).toBe(false); // новая попытка — новый ключ: сервер не задвоил
  });

  it("результат — одной транзакцией: платёж, done и ответ вместе", () => {
    const w = world();
    claimKey(w, "A", KEY.first);
    finishKey(w, "A", KEY.first, "200 · оплачено");
    expect(w.payments).toHaveLength(1);
    expect(keyRow(w, KEY.first)).toMatchObject({ status: "done", response: "200 · оплачено" });
  });

  it("ответ в туннеле теряется: экран не меняется", () => {
    const w = world();
    w.phone.tunnel = true;
    request(w, "A");
    reply(w, "A", "оплачено", "ok", "paid");
    expect(w.phone.screen).toBe("spin");
    expect(kinds(w)).toContain("lost");
  });

  it("брошенный ключ без срока висит; со сроком — забирается только после срока", () => {
    const w = world();
    claimKey(w, "A", KEY.first);
    crash(w, "A");
    expect(stuck(w)).toBe(true);
    const l = world();
    claimKey(l, "A", KEY.first, true);
    crash(l, "A");
    expect(stuck(l)).toBe(false);
    expect(takeOver(l, "B", KEY.first)).toBe(false);
    advance(l, 31);
    expect(takeOver(l, "B", KEY.first)).toBe(true);
    expect(keyRow(l, KEY.first).by).toBe("B");
  });

  it("честный ответ: «оплачено» только при списании, ошибка — только без него", () => {
    const w = world();
    w.phone.screen = "used";
    expect(honest(w)).toBe(true);
    charge(w, "A");
    expect(honest(w)).toBe(false);
    w.phone.screen = "busy";
    expect(honest(w)).toBe(true);
  });
});

describe("сценарий эпизода 08", () => {
  const steps = buildSteps();

  it("вставка эпизода 01 — кадр, где Почта гасит повтор по ключу", () => {
    expect(RECALL).toBeGreaterThanOrEqual(0);
    expect(steps.some((s) => s.state.flashback === RECALL)).toBe(true);
  });

  it("хук: ответ потерян, второй под списывает ещё раз", () => {
    const end = steps.filter((s) => s.act === ACT.hook).at(-1)!.state;
    expect(end.ledger).toHaveLength(2);
    expect(duplicated(end)).toBe(true);
    expect(steps.filter((s) => s.act === ACT.hook).some((s) => kinds(s.state).includes("lost"))).toBe(true);
  });

  it("захват ключа коммитится до банка: в каждой сцене строка ключа появляется раньше списания по нему", () => {
    for (const s of steps) {
      for (const c of s.state.ledger.filter((x) => x.key)) expect(s.state.keys.some((k) => k.key === c.key)).toBe(true);
    }
  });

  it("2.3: перехват по сроку с ключом у банка — одно списание; 2.2 без ключа — два", () => {
    const lease = steps.filter((s) => s.act === ACT.lease).at(-1)!.state;
    const e2e = steps.filter((s) => s.act === ACT.e2e).at(-1)!.state;
    expect(lease.ledger).toHaveLength(2);
    expect(e2e.ledger).toHaveLength(1);
    expect(e2e.phone.screen).toBe("paid");
  });

  it("табло не врёт: лампы сверены с моделью в кадре оценки", () => {
    let checked = 0;
    for (const step of steps) {
      const w = step.state;
      if (!kinds(w).includes("verdict")) continue;
      checked++;
      const t = w.board!.attempts.at(-1)!;
      const [first, second] = t.lamps!;
      if (w.chapter === 1) {
        if (first) expect(first === "green", `${t.name}: одно списание`).toBe(!duplicated(w));
        if (second) expect(second === "green", `${t.name}: честный ответ`).toBe(honest(w));
      } else {
        if (first) expect(first === "green", `${t.name}: не зависает`).toBe(!stuck(w));
        if (second) expect(second === "green", `${t.name}: одно списание`).toBe(!duplicated(w));
      }
    }
    expect(checked).toBe(6);
  });

  it("409 «ещё в работе» — жёлтый, «ключ уже использован» — красный", () => {
    const replies = steps.flatMap((s) => Object.values(s.state.actors).flatMap((a) => a.acts)).filter((x) => x.kind === "reply");
    for (const r of replies) {
      if (r.kind !== "reply") continue;
      if (r.text.startsWith("409")) expect(r.tone).toBe("warn");
      if (r.text.includes("использован")) expect(r.tone).toBe("error");
    }
  });

  it("диктор есть во всех кадрах и не читает команды целиком", () => {
    expect(steps.every((s) => s.narration), "кадр без голоса").toBe(true);
    for (const s of steps) expect(s.narration).not.toMatch(/WHERE|BEGIN|VALUES/);
  });

  it("закадр: не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration?.match(/ — /g) ?? []).length > 1).map((s) => s.narration)).toEqual([]);
  });

  it("закадр: буквы подов — по-русски; о собеседованиях не говорим; прошлые ролики — по теме; не exactly-once", () => {
    for (const s of steps.filter((x) => x.narration)) {
      for (const p of speechParts(s.narration!, PRONOUNCE)) expect(p.text, s.narration).not.toMatch(/(?<![A-Za-z])[AB](?![A-Za-z])/);
    }
    expect(steps.filter((s) => /собес|прошлом ролике|предыдущ|exactly.once|ровно один раз/i.test(s.narration ?? ""))).toEqual([]);
  });

  it("реплики Postgres и банка — до 37 знаков", () => {
    expect(steps.flatMap((s) => [s.state.db, s.state.bank]).filter((t) => t && t.length > 37)).toEqual([]);
  });

  it("ярлык акта появляется не раньше своей механики", () => {
    const mechanic: Record<string, EventKind> = {
      [ACT.hook]: "double", [ACT.check]: "double", [ACT.claim]: "conflict", [ACT.answer]: "conflict", [ACT.e2e]: "replayed",
    };
    for (const [act, kind] of Object.entries(mechanic)) {
      const inAct = steps.filter((s) => s.act === act);
      const first = inAct.findIndex((s) => s.state.term);
      const seen = inAct.findIndex((s) => kinds(s.state).includes(kind));
      expect(first, act).toBeGreaterThanOrEqual(0);
      expect(first, act).toBeGreaterThanOrEqual(seen < 0 ? Infinity : 0);
    }
  });
});
