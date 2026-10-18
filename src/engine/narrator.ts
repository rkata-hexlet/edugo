/**
 * Закадровый голос через Web Speech API (speechSynthesis). Без синтеза или русского голоса —
 * молча выжидает расчётное время фразы, чтобы автопроигрывание шло в том же темпе.
 */
export class Narrator {
  muted = false;
  /** Словарь произношения сцены; длинные ключи раньше коротких («FOR UPDATE» до «UPDATE»). */
  pronounce: Record<string, string> = {};
  private generation = 0;
  private timer: number | undefined;

  constructor() {
    // Голоса подгружаются асинхронно: запрос запускает загрузку к первой фразе.
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }

  /** Проговорить текст; onEnd — когда фраза кончилась (или оборвана новой). */
  speak(text: string, rate: number, onEnd: () => void): void {
    this.cut();
    const gen = this.generation;
    let fired = false;
    const done = () => {
      if (gen !== this.generation || fired) return;
      fired = true;
      onEnd();
    };
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    const voice = synth?.getVoices().find((v) => v.lang.toLowerCase().startsWith("ru"));
    if (this.muted || !synth || !voice) {
      this.timer = setTimeout(done, estimateMs(text) / rate);
      return;
    }
    // По предложению: онлайн-голоса Chrome обрывают фразу длиннее ~15 с и не присылают onend.
    const spoken = speakable(text, this.pronounce);
    const parts = spoken.match(/[^.!?…]+[.!?…]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [spoken];
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = rate;
      if (i === parts.length - 1) {
        u.onend = done;
        u.onerror = done;
      }
      synth.speak(u);
    });
    // Страховка: если синтез так и не сообщил о конце — не держать автопроигрывание вечно.
    this.timer = setTimeout(done, (estimateMs(text) * 1.6 + 2000) / rate);
  }

  /** Оборвать текущую фразу (перемотка, пауза, mute). */
  cut(): void {
    this.generation++;
    clearTimeout(this.timer);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}

/** Текст для синтеза: подставить произношение по словарю, целыми словами. */
export function speakable(text: string, pronounce: Record<string, string>): string {
  const keys = Object.keys(pronounce).sort((a, b) => b.length - a.length);
  return keys.reduce((t, k) => t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"), pronounce[k]), text);
}

/** Разговорный темп ~2.5 слова/с — столько же ждём, когда голоса нет. */
export function estimateMs(text: string): number {
  return (text.split(/\s+/).filter(Boolean).length / 2.5) * 1000;
}
