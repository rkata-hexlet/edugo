import "./motion.css";

// Визуальный язык серии (ADR-0002, разбор motion-designer v4.3): цвет = кто, форма = что,
// красный/зелёный = итог. Эпизоды берут цвета и кегли отсюда, а не задают свои.

export const COLOR = {
  bg: "#0e1325",
  bg2: "#161d38",
  surface: "#1b2342",
  surface2: "#242e55",
  line: "#34406e",
  ink: "#eef1ff",
  muted: "#8f9ac4",
  faint: "#5d6894",
  ok: "#3ddc97",
  error: "#ff5c6c",
  warn: "#ffd166",
  /** Предметы мира. */
  postgres: "#7f93bd",
  mail: "#5cc8d6",
  shadow: "#080b18",
} as const;

/** Персонажи-поды: у каждого свой цвет на всю серию. tint — заливка «его» вещей (строка, талон). */
export const ACTOR = {
  A: { color: "#4da3ff", tint: "#1d3a66" },
  B: { color: "#ffb84d", tint: "#5a4120" },
  C: { color: "#b98cff", tint: "#3d2e66" },
} as const;

export const FONT = {
  sans: "Inter, system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

/** Кегли на кадре 1280×720. Меньше `min` не бывает: не влезает — убрать, а не уменьшить. */
export const SIZE = {
  plate: 56,
  title: 26,
  say: 20,
  body: 18,
  min: 18,
} as const;

/** Цвета подсветки SQL. */
export const SQL_COLOR = {
  keyword: "#7cc4ff",
  string: "#ffd28a",
  number: "#ff9ec7",
  fn: "#9de0b8",
  plain: COLOR.ink,
  note: COLOR.muted,
} as const;

/** Насколько гасить то, о чём диктор сейчас не говорит. */
export const DIM = 0.45;

/** Низ кадра, куда плеер кладёт подпись и субтитры: контенту сцены туда нельзя. */
export const SAFE_BOTTOM = 655;
