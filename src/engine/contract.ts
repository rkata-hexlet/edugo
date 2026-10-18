// Контракт сцены — leaf: импортируется и каркасом, и сценами, сам ничего не импортирует.

/** Размер сцены в единицах SVG viewBox. */
export const STAGE = { w: 1280, h: 720 } as const;

export type Attrs = Record<string, string | number>;

/**
 * Узкий порт отрисовки. Элементы адресуются ключами: тот же ключ в следующем кадре —
 * тот же DOM-узел, поэтому перемещение группы анимируется само.
 */
export interface Pen {
  rect(key: string, attrs: Attrs): void;
  /** `\n` в content — перенос строки. */
  text(key: string, attrs: Attrs, content: string): void;
  /** Группа со смещением; при смене x/y между кадрами — плавный переезд. */
  group(key: string, x: number, y: number, children: () => void): void;
}

export type Wave = "sine" | "square" | "sawtooth" | "triangle";

/** Голос персонажа для бормотания без слов. */
export interface Voice {
  pitch: number; // базовая высота, Гц
  rate: number; // слогов в секунду
  wave: Wave;
  spread: number; // разброс высоты слогов, полутонов
  gain: number; // громкость 0..1
}

/**
 * Узкий порт звука: процедурные примитивы. Время `at` и `dur` — в секундах от начала кадра.
 * Реализация решает про громкость, mute и разрешение браузера на звук.
 */
export interface Sound {
  tone(o: { freq: number; to?: number; dur: number; wave?: Wave; gain?: number; at?: number }): void;
  noise(o: { dur: number; freq?: number; q?: number; gain?: number; at?: number }): void;
  babble(voice: Voice, text: string, at?: number): void;
}

/** Один кадр: просчитанное состояние симуляции и подпись для зрителя. */
export interface Step<S> {
  act: string;
  caption: string;
  state: S;
}

/** Сцена = заранее просчитанная последовательность кадров + отрисовка любого из них. */
export interface Scene<S> {
  id: string;
  title: string;
  steps(): Step<S>[];
  render(pen: Pen, state: S): void;
  /** Озвучить кадр. Плеер зовёт при шаге вперёд и при старте воспроизведения. */
  sound?(sound: Sound, state: S): void;
}
