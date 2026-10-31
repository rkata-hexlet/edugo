// Правило серии для всех эпизодов: голос начинает эпизод с контекста (где мы, кто что делает, что происходит),
// а отсылка к прошлому ролику — не раньше второго кадра. Чек-лист `docs/reviews/06-recurring-mistakes.md`, п. 8a;
// нарушено дважды (12 MVP 29.10, 07 — 31.10).

import { describe, expect, it } from "vitest";
import type { Scene } from "../engine/contract";

const scenes = Object.entries(import.meta.glob<Record<string, unknown>>("./*/index.ts", { eager: true })).map(
  ([path, mod]) => [path, Object.values(mod).find((v): v is Scene<unknown> => !!v && typeof v === "object" && "steps" in v)!] as const,
);

/** Начало-воспоминание: «Помните…», «Вспомним…», «В ролике про…», «Как мы видели…». */
const RECALL = /^(помни|вспомн|в ролике|в прошл|как мы (уже )?видели|как (вы )?помните)/i;

describe("начало эпизода — с контекста", () => {
  it("эпизоды найдены", () => expect(scenes.length).toBeGreaterThan(0));

  for (const [path, scene] of scenes) {
    it(`${path}: первый кадр не вспоминает прошлый ролик`, () => {
      const [first] = scene.steps();
      expect(first.narration ?? "").not.toMatch(RECALL);
      expect(String((first.state as { stamp?: unknown }).stamp ?? "")).not.toMatch(/^⟲/);
    });
  }
});
