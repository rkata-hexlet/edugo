// Контракт сцены — leaf: импортируется и каркасом, и сценами, сам ничего не импортирует.

/** Размер сцены в единицах SVG viewBox. */
export const STAGE = { w: 1280, h: 720 } as const;

export type Attrs = Record<string, string | number>;

/** Кусок текста со своими атрибутами (цвет, жирность) — для подсветки SQL и акцентов в реплике. */
export interface Span {
  text: string;
  attrs?: Attrs;
}

/** Строка или куски; `\n` в тексте — перенос строки. */
export type TextContent = string | Span[];

/**
 * Слои снизу вверх. Внутри слоя порядок наложения = порядок рисования в кадре;
 * слой позволяет нарисовать элемент поверх, не переставляя код (стрелка пода — под репликой).
 */
export const LAYERS = ["back", "main", "front", "top"] as const;
export type Layer = (typeof LAYERS)[number];

/** Сдвиг, поворот и масштаб группы; меняются плавно, как и x/y. */
export interface Transform {
  /** Градусы по часовой. */
  rotate?: number;
  scale?: number;
  /** Точка, вокруг которой вращать и масштабировать, — в координатах группы. По умолчанию 0,0. */
  origin?: [number, number];
}

/**
 * Узкий порт отрисовки. Элементы адресуются ключами: тот же ключ в следующем кадре —
 * тот же DOM-узел, поэтому перемещение группы анимируется само. Элемент, которого нет в новом
 * кадре, плавно гаснет (при перемотке — исчезает сразу).
 */
export interface Pen {
  rect(key: string, attrs: Attrs): void;
  text(key: string, attrs: Attrs, content: TextContent): void;
  /** Линия x1,y1 → x2,y2; `marker: "arrow"` — наконечник на конце. */
  line(key: string, attrs: Attrs): void;
  /** Кривая по `d` (SVG path); `marker: "arrow"` — наконечник на конце. */
  path(key: string, attrs: Attrs): void;
  /** Группа со смещением; при смене x/y/transform между кадрами — плавный переезд. attrs — например, opacity. */
  group(key: string, x: number, y: number, children: () => void, attrs?: Attrs, transform?: Transform): void;
  /** Нарисовать children в слое `layer` — в координатах сцены, вне текущей группы. Без вызова — слой "main". */
  layer(layer: Layer, children: () => void): void;
  /**
   * Размер текста, как его нарисует `text` с теми же attrs: для подгонки рамки под реплику.
   * Шрифт, унаследованный от группы, не учитывается — передавать все шрифтовые атрибуты в attrs.
   */
  measure(content: TextContent, attrs: Attrs): { width: number; height: number };
}

/** Высота строки многострочного текста, в долях кегля. Общая для отрисовки и `measure`. */
export const LINE_HEIGHT = 1.3;

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
  /** Сколько секунд держать кадр при автопроигрывании; нет — по длине подписи. */
  hold?: number;
  /** Текст диктора за кадром. Плеер проговаривает его и не листает дальше, пока фраза не кончится. */
  narration?: string;
}

/** Паспорт эпизода — для обложки и финальной карточки плеера. */
export interface SceneMeta {
  /** Номер эпизода в серии. */
  episode: number;
  /** Название без номера: «Конкурентная обработка задач». */
  title: string;
  /** О чём эпизод, одной фразой — подзаголовок обложки. */
  tagline: string;
  /** Последняя фраза финальной карточки — что унести с собой. */
  outro: string;
}

/** Сцена = заранее просчитанная последовательность кадров + отрисовка любого из них. */
export interface Scene<S> {
  id: string;
  meta: SceneMeta;
  steps(): Step<S>[];
  /**
   * Нарисовать кадр. `phrase` — номер куска закадра (`phrases(narration)`), который сейчас читает диктор:
   * сцена может менять картинку в такт голосу. Пока голос не начался — 0; кадр без голоса (перемотка,
   * ссылка, суфлёр) — последний кусок, полная картинка. Сцена, которой такт не нужен, параметр не берёт.
   */
  render(pen: Pen, state: S, phrase: number): void;
  /** Озвучить кадр. Плеер зовёт при шаге вперёд и при старте воспроизведения. */
  sound?(sound: Sound, state: S): void;
  /** Как произносить написанное латиницей в тексте диктора: «COMMIT» → «коммит». Экран не меняется. */
  pronounce?: Record<string, string>;
}
