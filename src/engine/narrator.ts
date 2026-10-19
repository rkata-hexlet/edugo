/**
 * Закадровый голос через Web Speech API (speechSynthesis). Без синтеза или русского голоса —
 * молча выжидает расчётное время фразы, чтобы автопроигрывание шло в том же темпе.
 * Английские слова читает английский голос (как говорят бэкендеры), остальное — русский.
 */
export class Narrator {
  muted = false;
  /** Словарь произношения сцены; длинные ключи раньше коротких («FOR UPDATE» до «UPDATE»). */
  pronounce: Record<string, string> = {};
  private generation = 0;
  private timer: number | undefined;
  private cues: number[] = [];

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
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    const voices = synth?.getVoices() ?? [];
    const voice = pickVoice(voices, "ru");
    if (this.muted || !synth || !voice) {
      const starts = phraseStarts(text);
      this.cues = starts.map((ms, i) => setTimeout(() => gen === this.generation && onPhrase(i), ms / rate));
      this.timer = setTimeout(done, estimateMs(text) / rate);
      return;
    }
    // Нет английского голоса — английское читает русский: хуже, но фраза не теряется.
    const byLang = { ru: voice, en: pickVoice(voices, "en") ?? voice };
    const parts = speechParts(text, this.pronounce);
    parts.forEach((part, i) => {
      const v = byLang[part.lang];
      const u = new SpeechSynthesisUtterance(part.text);
      u.voice = v;
      u.lang = v.lang;
      u.rate = rate;
      if (i === 0 || parts[i - 1].phrase !== part.phrase) u.onstart = () => gen === this.generation && onPhrase(part.phrase);
      if (i === parts.length - 1) {
        u.onend = done;
        u.onerror = done;
      }
      synth.speak(u);
    });
    // Страховка: если синтез так и не сообщил о конце — не держать автопроигрывание вечно.
    // С запасом на медленный голос (~1.2 слова/с) и паузы между предложениями.
    this.timer = setTimeout(done, (estimateMs(text) * 2.1 + 1500 * parts.length) / rate);
  }

  /** Оборвать текущую фразу (перемотка, пауза, mute). force=false — гасить синтез, только если он занят:
   *  в Chrome cancel() вплотную перед speak() может уронить новую фразу. */
  cut(force = true): void {
    this.generation++;
    clearTimeout(this.timer);
    for (const c of this.cues) clearTimeout(c);
    this.cues = [];
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (force || synth.speaking || synth.pending) synth.cancel();
  }
}

/** Голос языка: сетевые голоса Google звучат живее локальных — их первыми. */
function pickVoice(voices: SpeechSynthesisVoice[], lang: "ru" | "en"): SpeechSynthesisVoice | undefined {
  const of = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return of.find((v) => /google/i.test(v.name) && (lang !== "en" || /us/i.test(v.lang))) ?? of.find((v) => /google/i.test(v.name)) ?? of[0];
}

export interface SpeechPart {
  text: string;
  lang: "ru" | "en";
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

/** Начало каждого куска `phrases(text)` от начала голоса, мс, по расчётному темпу (запись без голоса). */
export function phraseStarts(text: string): number[] {
  let at = 0;
  return phrases(text).map((p) => {
    const start = at;
    at += estimateMs(p);
    return start;
  });
}

/** Латинские слова подряд (через пробел или дефис) — один английский кусок: «race condition», «FOR UPDATE». */
const LATIN = /[A-Za-z][A-Za-z0-9']*(?:[ -][A-Za-z][A-Za-z0-9']*)*/g;

/**
 * Фраза для синтеза — куски по языкам: сначала словарь сцены (исключения вроде букв подов), затем
 * латиница → английский голос. Режем и по кускам `phrases`: онлайн-голоса Chrome обрывают фразу
 * длиннее ~15 с и не присылают onend, а субтитр меняется в начале куска. Английский в верхнем
 * регистре (SKIP LOCKED) — строчными, чтобы голос не читал его по буквам; аббревиатуры (API) — как есть.
 */
export function speechParts(text: string, pronounce: Record<string, string>): SpeechPart[] {
  const parts: SpeechPart[] = [];
  let phrase = 0;
  const push = (t: string, lang: SpeechPart["lang"]) => {
    if (/[\p{L}\p{N}]/u.test(t)) parts.push({ text: t.trim(), lang, phrase });
  };
  for (const [i, original] of phrases(text).entries()) {
    phrase = i;
    const sentence = speakable(original, pronounce);
    let at = 0;
    for (const m of sentence.matchAll(LATIN)) {
      push(sentence.slice(at, m.index), "ru");
      push(m[0].length > 3 && m[0] === m[0].toUpperCase() ? m[0].toLowerCase() : m[0], "en");
      at = m.index! + m[0].length;
    }
    // Хвост с точкой — к последнему куску, чтобы голос сделал паузу конца предложения.
    const tail = sentence.slice(at);
    if (/[\p{L}\p{N}]/u.test(tail)) push(tail, "ru");
    else if (parts.at(-1)?.phrase === i && tail.trim()) parts[parts.length - 1].text += tail.trim();
  }
  return parts;
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
