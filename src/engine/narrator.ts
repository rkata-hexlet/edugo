import { Takes } from "./takes";

/**
 * Закадровый голос: дубль живого диктора (`Takes`), а без дубля — Web Speech API (speechSynthesis).
 * Без синтеза или русского голоса — молча выжидает расчётное время фразы, чтобы автопроигрывание
 * шло в том же темпе. Синтез читает всё одним русским голосом: он лишь черновик, озвучивает пользователь.
 */
/** Сколько ждать начала звука дубля, прежде чем читать фразу синтезом. */
const LOAD_TIMEOUT_MS = 4000;

export class Narrator {
  muted = false;
  /** Дубли сцены; пусто — всё синтезом. */
  takes = new Takes("");
  /** Словарь произношения сцены; длинные ключи раньше коротких («FOR UPDATE» до «UPDATE»). */
  pronounce: Record<string, string> = {};
  private generation = 0;
  private timer: number | undefined;
  private cues: number[] = [];
  private audio: HTMLAudioElement | null = null;

  constructor() {
    // Голоса подгружаются асинхронно: запрос запускает загрузку к первой фразе.
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }

  /**
   * Проговорить текст; onEnd — когда фраза кончилась (или оборвана новой). onPhrase(i) — диктор
   * начал i-й кусок `phrases(text)`: по нему субтитр идёт в такт голосу.
   */
  speak(text: string, rate: number, onEnd: () => void, onPhrase: (i: number) => void = () => {}): void {
    this.cut(false);
    const gen = this.generation;
    let fired = false;
    const done = () => {
      if (gen !== this.generation || fired) return;
      fired = true;
      onEnd();
    };
    const take = this.takes.duration(text);
    const cue = () => {
      this.cues = phraseStarts(text, take).map((ms, i) => setTimeout(() => gen === this.generation && onPhrase(i), ms / rate));
    };
    const wait = () => {
      cue();
      this.timer = setTimeout(done, (take ?? estimateMs(text)) / rate);
    };
    const synthesize = () => {
      const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
      const voices = synth?.getVoices() ?? [];
      const voice = pickVoice(voices, "ru");
      if (this.muted || !synth || !voice) return wait();
      const parts = speechParts(text, this.pronounce);
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part.text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = rate;
        u.onstart = () => gen === this.generation && onPhrase(part.phrase);
        if (i === parts.length - 1) {
          u.onend = done;
          u.onerror = done;
        }
        synth.speak(u);
      });
      // Страховка: если синтез так и не сообщил о конце — не держать автопроигрывание вечно.
      // С запасом на медленный голос (~1.2 слова/с) и паузы между предложениями.
      this.timer = setTimeout(done, (estimateMs(text) * 2.1 + 1500 * parts.length) / rate);
    };
    if (take === undefined || this.muted) return take === undefined ? synthesize() : wait();

    // Дубль: субтитр — по расчётным началам кусков, растянутым на длину дубля, с начала звука; конец — по файлу.
    const audio = (this.audio = new Audio(this.takes.url(text)));
    audio.playbackRate = rate;
    audio.onended = done;
    // Файла нет, не декодируется или запуск отклонён — фраза звучит синтезом, а не тишиной.
    const fallback = () => {
      if (gen !== this.generation || this.audio !== audio) return;
      clearTimeout(this.timer);
      this.audio = null;
      audio.pause();
      synthesize();
    };
    audio.onerror = fallback;
    audio.onplaying = () => {
      if (gen !== this.generation || this.cues.length) return;
      cue();
      clearTimeout(this.timer);
      // Страховка: конец так и не пришёл — не держать автопроигрывание.
      this.timer = setTimeout(done, take / rate + 3000);
    };
    audio.play().catch(fallback);
    // Звук так и не начался (сеть повисла) — не ждать молча.
    this.timer = setTimeout(fallback, LOAD_TIMEOUT_MS);
  }

  /** Оборвать текущую фразу (перемотка, пауза, mute). force=false — гасить синтез, только если он занят:
   *  в Chrome cancel() вплотную перед speak() может уронить новую фразу. */
  cut(force = true): void {
    this.generation++;
    clearTimeout(this.timer);
    for (const c of this.cues) clearTimeout(c);
    this.cues = [];
    this.audio?.pause();
    this.audio = null;
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (force || synth.speaking || synth.pending) synth.cancel();
  }
}

/** Голос языка: сетевые голоса Google звучат живее локальных — их первыми. */
function pickVoice(voices: SpeechSynthesisVoice[], lang: "ru"): SpeechSynthesisVoice | undefined {
  const of = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return of.find((v) => /google/i.test(v.name)) ?? of[0];
}

export interface SpeechPart {
  text: string;
  /** Номер куска `phrases(text)`, к которому относится часть. */
  phrase: number;
}

/** Длиннее — субтитр не влезает в строку и залезает выше SAFE_BOTTOM: на табло и SQL-панель. */
export const MAX_PHRASE = 64;

/**
 * Куски закадра для субтитра и синтеза: по предложениям, а длинное предложение — ещё и по паузе
 * ближе к середине: запятая или двоеточие, иначе тире, перед союзом, по пробелу. Кусок — строка
 * субтитра; голос читает куски подряд.
 */
export function phrases(text: string): string[] {
  const split = (t: string): string[] => {
    if (t.length <= MAX_PHRASE) return [t];
    const inside = (i: number) => i > 15 && i < t.length - 15;
    const marks = (re: RegExp, shift: number) => [...t.matchAll(re)].map((m) => m.index! + shift).filter(inside);
    // Тире — только без запятой: «два слова — SKIP LOCKED» не рвём.
    const cuts = [marks(/[,:] /g, 1), marks(/ — /g, 2), marks(/ (?:и|а|но|или|чтобы|пока|поэтому|потому что) /g, 0), marks(/ /g, 0)]
      .find((c) => c.length) ?? [];
    if (!cuts.length) return [t];
    const at = cuts.reduce((a, b) => (Math.abs(b - t.length / 2) < Math.abs(a - t.length / 2) ? b : a));
    return [...split(t.slice(0, at).trim()), ...split(t.slice(at).trim())];
  };
  const sentences = text.match(/[^.!?…]+[.!?…]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
  return sentences.flatMap(split);
}

/**
 * Начало каждого куска `phrases(text)` от начала голоса, мс, по расчётному темпу; с длиной дубля
 * `totalMs` — тот же расклад, растянутый на дубль.
 */
export function phraseStarts(text: string, totalMs?: number): number[] {
  const scale = totalMs === undefined ? 1 : totalMs / Math.max(1, estimateMs(text));
  let at = 0;
  return phrases(text).map((p) => {
    const start = at;
    at += estimateMs(p) * scale;
    return start;
  });
}

/** Английское в верхнем регистре (SKIP LOCKED) — строчными, чтобы голос не читал его по буквам; аббревиатуры (API) — как есть. */
const CAPS = /\b[A-Z][A-Z0-9']{3,}\b/g;

/**
 * Фраза для синтеза — по куску `phrases` на часть, со словарём сцены (исключения вроде букв подов).
 * Режем по кускам: онлайн-голоса Chrome обрывают фразу длиннее ~15 с и не присылают onend, а
 * субтитр меняется в начале куска.
 */
export function speechParts(text: string, pronounce: Record<string, string>): SpeechPart[] {
  return phrases(text)
    .map((original, phrase) => ({ text: speakable(original, pronounce).replace(CAPS, (m) => m.toLowerCase()).trim(), phrase }))
    .filter((p) => /[\p{L}\p{N}]/u.test(p.text));
}

/** Текст для синтеза: подставить произношение по словарю, целыми словами. */
export function speakable(text: string, pronounce: Record<string, string>): string {
  const keys = Object.keys(pronounce).sort((a, b) => b.length - a.length);
  return keys.reduce((t, k) => t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"), pronounce[k]), text);
}

/** Пауза перед голосом диктора, мс (при скорости 1×): взгляд успевает увидеть новое состояние кадра. */
export const VOICE_DELAY_MS = 500;
/** Пауза после голоса, мс: последний результат кадра успевает быть увиденным до смены кадра. */
export const POST_VOICE_MS = 700;

/** Разговорный темп ~2.5 слова/с — столько же ждём, когда голоса нет. */
export function estimateMs(text: string): number {
  return (text.split(/\s+/).filter(Boolean).length / 2.5) * 1000;
}
