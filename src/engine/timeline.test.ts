import { describe, expect, it } from "vitest";
import { VOICE_DELAY_MS } from "./narrator";
import { COVER_S, OUTRO_S, frameAt, frameSeconds, lastPhrase, phraseAt, timeline } from "./timeline";

const step = (narration?: string, hold?: number) => ({ act: "a", caption: "", state: null, hold, narration });

describe("шкала записи", () => {
  it("кадр длится дольше из своего времени и голоса диктора", () => {
    expect(frameSeconds(step(undefined, 3))).toBe(3);
    // 10 слов при 2.5 слова/с = 4 с + 0.5 до голоса + 0.7 после.
    expect(frameSeconds(step("раз два три четыре пять шесть семь восемь девять десять", 2))).toBeCloseTo(5.2);
  });

  it("с дублем диктора кадр держится по его настоящей длине; финал — не короче своей фразы", () => {
    const voiceMs = (t: string) => (t === "дубль" ? 6000 : 1000);
    expect(frameSeconds(step("дубль", 2), voiceMs)).toBeCloseTo(7.2);
    expect(timeline([step("дубль")], voiceMs, "дубль").total).toBeCloseTo(COVER_S + 7.2 + 7.2);
    expect(timeline([step("дубль")], voiceMs, "фраза").total).toBeCloseTo(COVER_S + 7.2 + OUTRO_S);
  });

  it("обложка, кадры подряд, финальная карточка", () => {
    const tl = timeline([step(undefined, 2), step(undefined, 3)]);
    expect(tl.starts).toEqual([COVER_S, COVER_S + 2]);
    expect(tl.end).toBe(COVER_S + 5);
    expect(tl.total).toBe(COVER_S + 5 + OUTRO_S);
  });

  it("кадр в момент t — последний начавшийся", () => {
    const starts = [2.5, 4.5, 7.5];
    expect(frameAt(starts, 2.5)).toBe(0);
    expect(frameAt(starts, 4.49)).toBe(0);
    expect(frameAt(starts, 4.5)).toBe(1);
    expect(frameAt(starts, 100)).toBe(2);
  });

  it("кусок закадра в момент кадра: до голоса — первый, дальше — по темпу, растянутому на дубль", () => {
    // Два предложения по 5 слов: при 2.5 слова/с — по 2 с; дубль 8 с растягивает каждое до 4 с.
    const two = step("Раз два три четыре пять. Шесть семь восемь девять десять.");
    expect(lastPhrase(two)).toBe(1);
    expect(lastPhrase(step())).toBe(0);
    expect(phraseAt(two, 100)).toEqual({ phrase: 0, since: 100 });
    expect(phraseAt(two, VOICE_DELAY_MS + 1999).phrase).toBe(0);
    expect(phraseAt(two, VOICE_DELAY_MS + 2100)).toEqual({ phrase: 1, since: 100 });
    expect(phraseAt(two, VOICE_DELAY_MS + 3000, () => 8000).phrase).toBe(0);
    expect(phraseAt(two, VOICE_DELAY_MS + 4100, () => 8000)).toEqual({ phrase: 1, since: 100 });
    expect(phraseAt(step(), 5000)).toEqual({ phrase: 0, since: 5000 });
  });
});
