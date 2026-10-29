import { describe, expect, it } from "vitest";
import { ACT, buildSteps } from "./script";
import {
  BATCH, CHEAP, LAST_PAGE, behind, dupLamp, dups, exportPage, listing, fastLamp, insert, lost, lostLamp, next, nextSql, offsetTotal,
  PRICEY, remove, reprice, shown, world, type Mode, type World,
} from "./sim";

const fresh = (mode: Mode): World => {
  const w = world();
  w.mode = mode;
  next(w);
  return w;
};

describe("модель листания", () => {
  it("норма: две страницы OFFSET подряд, без повторов и дыр", () => {
    const w = fresh("offset");
    next(w);
    expect(shown(w)).toEqual([4414, 4419, 4417, 4413, 4415, 4418, 4412, 4421, 4420, 4416]);
    expect([lostLamp(w), dupLamp(w)]).toEqual(["green", "green"]);
  });

  it("порядок даёт запрос, а не таблица: новая строка ложится в конец, первой её ставит следующий ORDER BY", () => {
    const w = fresh("offset");
    insert(w, CHEAP);
    expect([w.order, w.offers.at(-1)!.id]).toEqual(["table", 4422]);
    next(w);
    expect([w.order, listing(w)[0].id]).toEqual(["query", 4422]);
    expect(world().offers.map((o) => o.price)).not.toEqual([...world().offers.map((o) => o.price)].sort((a, b) => a - b));
  });

  it("хук: вставка сверху — вторая страница OFFSET начинается с «Причала» 4415", () => {
    const w = fresh("offset");
    insert(w, CHEAP);
    expect(next(w)[0]).toBe(4415);
    expect(dupLamp(w)).toBe("red");
  });

  it("OFFSET и продажа с первой страницы: «Лагуна» 4418 проваливается в щель", () => {
    const w = fresh("offset");
    remove(w, 4419);
    expect(next(w)[0]).toBe(4412);
    expect(lost(w)).toEqual([4418]);
  });

  it("OFFSET и UPDATE цены: «Бриз» 4417 дорожает — «Лагуна» в щели, «Бриз» второй раз", () => {
    const w = fresh("offset");
    reprice(w, PRICEY.id, PRICEY.price);
    expect([w.order, w.offers.findIndex((o) => o.id === 4417), w.sql[0]]).toEqual(["table", 5, "UPDATE offers SET price = 6000\nWHERE id = 4417"]);
    next(w);
    expect([lost(w), dups(w)]).toEqual([[4418], [4417]]);
  });

  it("DELETE: строка остаётся в кадре на месте, из выдачи уходит", () => {
    const w = fresh("offset");
    remove(w, 4419);
    expect([w.order, w.sql[0], listing(w).some((o) => o.id === 4419)]).toEqual(["table", "DELETE FROM offers\nWHERE id = 4419", false]);
  });

  it("закладка price >: продажа не сдвигает, но ничья глотает 4418", () => {
    const w = fresh("gt");
    remove(w, 4419);
    expect(next(w)[0]).toBe(4412);
    expect([lostLamp(w), dupLamp(w)]).toEqual(["red", "green"]);
  });

  it("закладка price >=: близнецы 4413 и 4415 приходят второй раз", () => {
    const w = fresh("gte");
    next(w);
    expect(dups(w)).toEqual([4413, 4415]);
    expect([lostLamp(w), dupLamp(w)]).toEqual(["green", "red"]);
  });

  it("закладка (price, id): после продажи страница 2 открывается 4418, всё ровно раз", () => {
    const w = fresh("pair");
    expect(w.mark).toEqual({ price: 4900, id: 4415 });
    remove(w, 4419);
    expect(next(w)[0]).toBe(4418);
    expect([lostLamp(w), dupLamp(w)]).toEqual(["green", "green"]);
  });

  it("закладка (price, id) и UPDATE: «Бриз» сам сменил ключ и приходит второй раз, стоявшие на месте — ровно раз", () => {
    const w = fresh("pair");
    reprice(w, PRICEY.id, PRICEY.price);
    expect(next(w)[0]).toBe(4418);
    expect([lost(w), dups(w)]).toEqual([[], [4417]]);
  });

  it("закладка не снимок: новая карточка позади закладки не придёт, стоявшие на месте — ровно раз", () => {
    const w = fresh("pair");
    insert(w, CHEAP);
    next(w);
    expect(behind(w)).toEqual([4422]);
    expect(shown(w)).not.toContain(4422);
    expect([lostLamp(w), dupLamp(w)]).toEqual(["green", "green"]);
  });

  it("попытки закладкой сортируют так же, как OFFSET: ORDER BY price, id — неполна закладка, а не сортировка", () => {
    for (const mode of ["gt", "gte", "pair"] as Mode[]) expect(nextSql(fresh(mode)), mode).toContain("ORDER BY price, id");
  });

  it("флажок стоит у закладки, по которой искал запрос, а не у конца новой страницы", () => {
    const w = fresh("gt");
    next(w);
    expect(w.mark).toEqual({ price: 4900, id: 4415 });
  });

  it("выгрузка: OFFSET на последней странице читает 2 000 000, закладка — 1 000", () => {
    const w = world();
    exportPage(w, "offset", LAST_PAGE);
    expect([w.export!.read, w.export!.sent]).toEqual([2_000_000, BATCH]);
    expect(fastLamp(w)).toBe("red");
    exportPage(w, "pair", LAST_PAGE);
    expect([w.export!.read, fastLamp(w)]).toEqual([BATCH, "green"]);
    expect(Math.round(offsetTotal() / 1e9)).toBe(2);
  });
});

const steps = buildSteps();
const frames = (act: string) => steps.filter((s) => s.act === act).map((s) => s.state);

describe("сценарий не врёт", () => {
  it("детерминирован", () => {
    expect(JSON.stringify(buildSteps())).toBe(JSON.stringify(steps));
  });

  it("арка v2: 29 кадров + итог из двух", () => {
    expect(steps.length).toBe(31);
    expect(frames(ACT.summary)).toHaveLength(2);
  });

  it("хук: вторая страница начинается с уже виденной карточки", () => {
    const after = frames(ACT.offset)[1];
    expect(after.guest.pages[1][0]).toBe(4415);
    expect(dups(after)).toEqual([4415]);
  });

  it("табло не врёт: каждая зажжённая лампа сверена с моделью кадра", () => {
    let checked = 0;
    for (const s of steps) {
      const e = s.state.events.find((x) => x.kind === "verdict");
      if (!e) continue;
      const w = s.state;
      // Кадр проверяет либо выдачу гостю (лампы 1–2), либо выгрузку (лампа 3).
      const model = w.export ? [null, null, fastLamp(w)] : [lostLamp(w), dupLamp(w), null];
      e.lamps!.forEach((l, i) => {
        if (!l) return;
        checked++;
        expect(l, `${s.act}: лампа ${i + 1}`).toBe(model[i]);
      });
    }
    expect(checked).toBe(12);
  });

  it("все беды OFFSET — до закладки: к концу кейса 1 три красные лампы, к концу кейса 2 — три зелёные", () => {
    const end = (no: number) => steps.filter((s) => s.state.chapter === no).at(-1)!.state.board!;
    expect(end(1).attempts.map((a) => a.lamps)).toEqual([["red", "red", "red"]]);
    expect(end(2).attempts.at(-1)!.lamps).toEqual(["green", "green", "green"]);
    const firstMark = steps.findIndex((s) => s.state.mark);
    const lastOffset = steps.map((s) => s.state.chapter).lastIndexOf(1);
    expect(firstMark).toBeGreaterThan(lastOffset);
  });

  it("SQL в кадре совпадает с моделью: LIMIT 5 у гостя, LIMIT 1000 в выгрузке", () => {
    const sql = steps.flatMap((s) => s.state.sql).join("\n");
    expect(sql).toContain("LIMIT 5 OFFSET 5");
    expect(sql).toContain("WHERE price > 4900\nORDER BY price, id");
    expect(sql).toContain("WHERE (price, id) > (4900, 4415)");
    expect(sql).toContain(`LIMIT 1000 OFFSET ${(LAST_PAGE - 1) * BATCH}`);
    expect(sql).toContain("WHERE (created_at, id) > ($1, $2)");
  });

  it("не обещаем лишнего и не путаем с SQL-курсором", () => {
    const all = steps.map((s) => s.narration ?? "").join(" ");
    for (const bad of [/курсор/i, /cursor/i, /пропускает/i, /всегда медлен/i, /гарантирует/i, /в конец выгрузки/i]) expect(all).not.toMatch(bad);
  });

  it("закадр — не больше одного тире на кадр", () => {
    expect(steps.filter((s) => (s.narration ?? "").split(" — ").length > 2).map((s) => s.narration!.slice(0, 40))).toEqual([]);
  });

  it("реплики персонажей короткие", () => {
    expect(steps.map((s) => s.state.db).filter((t) => t && t.length > 37)).toEqual([]);
    expect(steps.map((s) => s.state.guest.say).filter((t) => t && t.length > 24)).toEqual([]);
  });

  it("ярлык акта появляется вместе со своей механикой", () => {
    const mechanic: Record<string, (w: World) => boolean> = {
      "Offset pagination": (w) => w.mode === "offset" && dups(w).length > 0,
      "Deep pagination": (w) => !!w.export && w.export.read > w.export.sent,
      "Keyset pagination": (w) => !!w.mark && w.mode === "gt",
      "Tie-breaker": (w) => !!w.mark && w.mode === "pair",
    };
    for (const [term, shownNow] of Object.entries(mechanic)) {
      const all = steps.filter((s) => s.state.term === term);
      expect(all.length, term).toBeGreaterThan(0);
      expect(shownNow(all[0].state), term).toBe(true);
    }
    const bare = [ACT.intro, ACT.case1, ACT.root, ACT.case2, ACT.seek, ACT.cost, ACT.summary] as string[];
    expect(steps.filter((s) => bare.includes(s.act)).every((s) => s.state.term === null)).toBe(true);
  });
});
