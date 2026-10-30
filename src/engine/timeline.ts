import type { Step } from "./contract";
import { POST_VOICE_MS, VOICE_DELAY_MS, estimateMs, phraseStarts, phrases } from "./narrator";

/** Сколько показывать кадр при автопроигрывании: заданное сценой или база + время на чтение подписи. */
export const frameMs = (step: Step<unknown>, speed: number): number =>
  (step.hold !== undefined ? step.hold * 1000 : 1500 + step.caption.length * 35) / speed;

/** Обложка и финальная карточка в записи, с. */
export const COVER_S = 2.5;
export const OUTRO_S = 4;

/** Длина голоса диктора, мс: дубль живого диктора или расчётный темп синтеза. */
export type VoiceMs = (text: string) => number;

/** Время голоса в кадре, мс: пауза перед ним + сама фраза + пауза после. */
const voiced = (text: string, voiceMs: VoiceMs) => VOICE_DELAY_MS + voiceMs(text) + POST_VOICE_MS;

/**
 * Длительность кадра при скорости 1×, с: дольше из времени кадра и голоса диктора — так же листает
 * автопроигрывание.
 */
export function frameSeconds(step: Step<unknown>, voiceMs: VoiceMs = estimateMs): number {
  return Math.max(frameMs(step, 1), step.narration ? voiced(step.narration, voiceMs) : 0) / 1000;
}

/**
 * Шкала записи: обложка, кадры подряд, финальная карточка (не короче её фразы голосом).
 * starts[i] — начало кадра i, с; end — начало финальной карточки.
 */
export function timeline(
  steps: Step<unknown>[],
  voiceMs: VoiceMs = estimateMs,
  outro?: string,
): { starts: number[]; end: number; total: number } {
  const starts: number[] = [];
  let t = COVER_S;
  for (const step of steps) {
    starts.push(t);
    t += frameSeconds(step, voiceMs);
  }
  return { starts, end: t, total: t + Math.max(OUTRO_S, outro ? voiced(outro, voiceMs) / 1000 : 0) };
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

/** Последний кусок закадра — полная картинка кадра без голоса (перемотка, ссылка, снимок). */
export const lastPhrase = (step: Step<unknown>): number => Math.max(0, phrases(step.narration ?? "").length - 1);

/**
 * Кусок закадра, который диктор читает через `ms` от начала кадра (как в плеере: голос — после паузы), и
 * сколько мс прошло с его начала; до голоса — кусок 0 и время от начала кадра.
 */
export function phraseAt(step: Step<unknown>, ms: number, voiceMs: VoiceMs = estimateMs): { phrase: number; since: number } {
  if (!step.narration) return { phrase: 0, since: ms };
  const starts = phraseStarts(step.narration, voiceMs(step.narration));
  const phrase = frameAt(starts, ms - VOICE_DELAY_MS);
  return { phrase, since: phrase === 0 ? ms : ms - VOICE_DELAY_MS - starts[phrase] };
}
