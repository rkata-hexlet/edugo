import type { Step } from "./contract";
import { POST_VOICE_MS, VOICE_DELAY_MS, estimateMs } from "./narrator";

/** Сколько показывать кадр при автопроигрывании: заданное сценой или база + время на чтение подписи. */
export const frameMs = (step: Step<unknown>, speed: number): number =>
  (step.hold !== undefined ? step.hold * 1000 : 1500 + step.caption.length * 35) / speed;

/** Обложка и финальная карточка в записи, с. */
export const COVER_S = 2.5;
export const OUTRO_S = 4;

/**
 * Длительность кадра при скорости 1×, с: дольше из времени кадра и голоса диктора (пауза перед
 * голосом + расчётная длина фразы + пауза после) — так же листает автопроигрывание без звука.
 */
export function frameSeconds(step: Step<unknown>): number {
  const voice = step.narration ? VOICE_DELAY_MS + estimateMs(step.narration) + POST_VOICE_MS : 0;
  return Math.max(frameMs(step, 1), voice) / 1000;
}

/** Шкала записи: обложка, кадры подряд, финальная карточка. starts[i] — начало кадра i, с. */
export function timeline(steps: Step<unknown>[]): { starts: number[]; end: number; total: number } {
  const starts: number[] = [];
  let t = COVER_S;
  for (const step of steps) {
    starts.push(t);
    t += frameSeconds(step);
  }
  return { starts, end: t, total: t + OUTRO_S };
}

/** Индекс кадра, который идёт в момент t (внутри [starts[0], end)). */
export function frameAt(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
