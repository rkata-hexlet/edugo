import { describe, expect, it } from "vitest";
import { MAX_PHRASE, estimateMs, phraseStarts, phrases, speechParts } from "./narrator";

describe("speechParts: куски фразы для синтеза", () => {
  it("кусок — целиком одним голосом, английское не отделяется", () => {
    expect(speechParts("Это классический race condition: сосед вклинился.", {}).map((p) => p.text)).toEqual([
      "Это классический race condition: сосед вклинился.",
    ]);
  });

  it("словарь сцены: буквы подов по-русски; капс — строчными, аббревиатуры — как есть", () => {
    const pods = { A: "а", B: "бэ" };
    expect(speechParts("Под A делает COMMIT, а B ждёт API.", pods).map((p) => p.text)).toEqual(["Под а делает commit, а бэ ждёт API."]);
  });

  it("предложения — отдельными кусками (онлайн-голоса обрывают длинные фразы)", () => {
    expect(speechParts("Раз. Два!", {}).map((p) => p.text)).toEqual(["Раз.", "Два!"]);
  });
});

describe("phrases: субтитр по кускам", () => {
  it("предложение длиннее MAX_PHRASE делится по запятой ближе к середине; куски — в части речи", () => {
    const long = "Пока транзакция пода A не завершится, никто другой не сможет эту строку изменить или так же заблокировать, такие запросы будут ждать.";
    const cut = phrases(`${long} Под A запирает первую строку.`);
    expect(cut.every((p) => p.length <= MAX_PHRASE)).toBe(true);
    expect(cut.join(" ")).toBe(`${long} Под A запирает первую строку.`);
    expect(cut.length).toBeGreaterThanOrEqual(3);
    const parts = speechParts(`${long} Под A запирает первую строку.`, { A: "а" });
    expect([...new Set(parts.map((p) => p.phrase))]).toEqual(cut.map((_, i) => i));
  });

  it("с дублем куски растягиваются на его длину", () => {
    const text = "Раз два. Три четыре пять.";
    const est = phraseStarts(text);
    const take = phraseStarts(text, 2 * estimateMs(text));
    expect(take).toEqual(est.map((ms) => ms * 2));
  });

  it("начала кусков растут от нуля", () => {
    const starts = phraseStarts("Раз два. Три четыре пять.");
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeGreaterThan(0);
  });
});
