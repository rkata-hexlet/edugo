import type { Step } from "./contract";

/**
 * Дубли живого диктора: один файл на текст кадра. Ключ — хэш текста, поэтому правка закадра сама
 * делает дубль устаревшим, а сдвиг номеров кадров ему не мешает. Файлы и справочник длительностей —
 * `public/voice/<сцена>/` (пишет dev-сервер при записи, `scripts/voice.mjs`).
 */
export class Takes {
  constructor(
    readonly scene: string,
    /** Ключ → длительность дубля, мс (после обрезки тишины). */
    private ms: Record<string, number> = {},
  ) {}

  /** Длительность дубля текста, мс; нет дубля — undefined. */
  duration(text: string): number | undefined {
    return this.ms[takeKey(text)];
  }

  url(text: string): string {
    return `${import.meta.env.BASE_URL}voice/${this.scene}/${takeKey(text)}.ogg`;
  }

  /** Записан новый дубль. */
  set(text: string, ms: number): void {
    this.ms[takeKey(text)] = ms;
  }
}

/** Справочник дублей сцены; нет файла — пустой (голос — синтезом). */
export async function loadTakes(scene: string): Promise<Takes> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}voice/${scene}/takes.json`, { cache: "no-store" });
    return new Takes(scene, res.ok ? await res.json() : {});
  } catch {
    return new Takes(scene, {});
  }
}

/** FNV-1a 32 бит по тексту без крайних пробелов: короткое стабильное имя файла. */
export function takeKey(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Что читать диктору: кадры с закадром по порядку, затем финальная фраза. */
export interface Line {
  /** Индекс кадра; финальная фраза — steps.length. */
  index: number;
  text: string;
}

export function script(steps: Step<unknown>[], outro: string): Line[] {
  const lines = steps.flatMap((s, index) => (s.narration ? [{ index, text: s.narration }] : []));
  return [...lines, { index: steps.length, text: outro }];
}

/** С какой строки начинать запись: с кадра по ссылке, иначе с первой без дубля (всё записано — с начала). */
export function firstLine(lines: Line[], takes: Takes, linked?: number): number {
  if (linked !== undefined) return Math.max(0, lines.findIndex((l) => l.index >= linked));
  return Math.max(0, lines.findIndex((l) => takes.duration(l.text) === undefined));
}
