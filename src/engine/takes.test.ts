import { describe, expect, it } from "vitest";
import { Takes, firstLine, script, takeKey } from "./takes";

const step = (narration?: string) => ({ act: "a", caption: "", state: null, narration });

describe("дубли диктора", () => {
  it("ключ — от текста: тот же текст — тот же дубль, правка текста — новый", () => {
    expect(takeKey("Под A берёт задачу.")).toBe(takeKey(" Под A берёт задачу. "));
    expect(takeKey("Под A берёт задачу.")).not.toBe(takeKey("Под B берёт задачу."));
    expect(takeKey("x")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("дубль находится по тексту, а не по номеру кадра", () => {
    const takes = new Takes("01", { [takeKey("Раз.")]: 1200 });
    expect(takes.duration("Раз.")).toBe(1200);
    expect(takes.duration("Два.")).toBeUndefined();
    expect(takes.url("Раз.")).toBe(`/voice/01/${takeKey("Раз.")}.ogg`);
  });

  it("суфлёр читает кадры с закадром, затем финал; начинает с первого без дубля или с кадра по ссылке", () => {
    const lines = script([step("Раз."), step(), step("Два.")], "Итог.");
    expect(lines).toEqual([{ index: 0, text: "Раз." }, { index: 2, text: "Два." }, { index: 3, text: "Итог." }]);
    const takes = new Takes("01", { [takeKey("Раз.")]: 900 });
    expect(firstLine(lines, takes)).toBe(1);
    expect(firstLine(lines, takes, 1)).toBe(1); // кадр без закадра — следующий с закадром
    takes.set("Два.", 800);
    takes.set("Итог.", 700);
    expect(firstLine(lines, takes)).toBe(0); // всё записано — с начала
  });
});
