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
}
