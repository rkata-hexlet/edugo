import type { Sound, Voice, Wave } from "./contract";

/**
 * Sound поверх Web Audio. AudioContext создаётся лениво — по первому жесту пользователя
 * (браузеры не дают звук без него). Пока выключен или контекста нет — тишина.
 * С готовым `OfflineAudioContext` (рендер в mp4) звук пишется в буфер: `at` отсчитывается от `base`.
 */
export class WebAudioSound implements Sound {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  /** Множитель громкости бормотания: под голосом диктора персонажи звучат тише. */
  babbleGain = 1;
  /** Офлайн-рендер: начало текущего кадра на шкале буфера, с. */
  base = 0;
  private offline = false;

  /** Офлайн-рендер: звуки — в буфер контекста, а не в динамики. */
  static offline(ctx: OfflineAudioContext): WebAudioSound {
    const s = new WebAudioSound();
    s.ctx = ctx;
    s.offline = true;
    s.master = ctx.createGain();
    s.master.gain.value = 0.5;
    s.master.connect(ctx.destination);
    return s;
  }

  /** Офлайн-рендер: звуки следующих вызовов — в кадре [start, end), после end — тишина (как cut() в плеере). */
  segment(start: number, end: number): void {
    const ctx = this.ctx!;
    this.base = start;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.5, 0);
    this.master.gain.setValueAtTime(0.5, end);
    this.master.gain.linearRampToValueAtTime(0, end + 0.01);
    this.master.connect(ctx.destination);
  }

  /** Вызывать из обработчика клика/клавиши. */
  unlock(): void {
    if (this.offline) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void (this.ctx as AudioContext).resume();
  }

  /** Оборвать звуки предыдущего кадра (перемотка, быстрое листание). */
  cut(): void {
    if (!this.ctx || !this.master || this.offline) return;
    this.master.disconnect();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  tone(o: { freq: number; to?: number; dur: number; wave?: Wave; gain?: number; at?: number }): void {
    const out = this.out();
    if (!out) return;
    const { ctx, t0 } = out;
    const start = t0 + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? "sine";
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, start + o.dur);
    osc.connect(this.envelope(start, o.dur, o.gain ?? 0.3));
    osc.start(start);
    osc.stop(start + o.dur + 0.05);
  }

  noise(o: { dur: number; freq?: number; q?: number; gain?: number; at?: number }): void {
    const out = this.out();
    if (!out) return;
    const { ctx, t0 } = out;
    const start = t0 + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = o.freq ?? 1000;
    filter.Q.value = o.q ?? 1;
    src.connect(filter).connect(this.envelope(start, o.dur, o.gain ?? 0.3));
    src.start(start);
    src.stop(start + o.dur + 0.05);
  }

  babble(voice: Voice, text: string, at = 0): void {
    for (const s of syllables(voice, text)) {
      this.tone({ freq: s.freq, to: s.freq * 0.9, dur: s.dur, wave: voice.wave, gain: voice.gain * this.babbleGain, at: at + s.at });
    }
  }

  private out(): { ctx: BaseAudioContext; t0: number } | null {
    if (this.offline) return { ctx: this.ctx!, t0: this.base };
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== "running") return null;
    return { ctx: this.ctx, t0: this.ctx.currentTime + 0.02 };
  }

  private envelope(start: number, dur: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    env.connect(this.master!);
    return env;
  }

  private noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Детерминированный шум (LCG): одинаковый на каждом запуске.
    let x = 1;
    for (let i = 0; i < data.length; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (x / 0x3fffffff) - 1;
    }
    return (this.noiseBuf = buf);
  }
}

/** Слоги бормотания: по слогу на 2 символа (≤ 14), высота — из кода символа, детерминированно. */
export function syllables(voice: Voice, text: string): { freq: number; dur: number; at: number }[] {
  const chars = [...text.replace(/\s+/g, "")];
  const count = Math.min(14, Math.max(1, Math.ceil(chars.length / 2)));
  const step = 1 / voice.rate;
  return Array.from({ length: count }, (_, i) => {
    const code = chars[i * 2]?.codePointAt(0) ?? 0;
    const semis = ((code % 7) / 6 - 0.5) * 2 * voice.spread;
    const last = i === count - 1;
    return {
      freq: voice.pitch * 2 ** (semis / 12) * (last && text.trim().endsWith("?") ? 1.25 : 1),
      dur: step * 0.8,
      at: i * step,
    };
  });
}
