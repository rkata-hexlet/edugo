import type { Attrs, Pen } from "../engine/contract";

// Иконки вместо эмодзи: эмодзи разные на каждой платформе и не красятся в цвет пода.
// Каждая — пути на сетке 24×24, обводка 2 (как у значков плеера).

type Part = { d: string; fill?: boolean };
const stroke = (d: string): Part => ({ d });
const solid = (d: string): Part => ({ d, fill: true });

const ICONS = {
  lock: [solid("M6 11h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 6 11z"), stroke("M8 11V7.5a4 4 0 0 1 8 0V11")],
  ticket: [
    solid("M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4z"),
  ],
  hourglass: [stroke("M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"), solid("M9.5 19.5h5L12 16.5z")],
  check: [stroke("M5 12.5l4.5 4.5L19 7.5")],
  cross: [stroke("M6 6l12 12M18 6L6 18")],
  mail: [stroke("M4 6.5h16v11H4z"), stroke("M4.5 7l7.5 6 7.5-6")],
  key: [stroke("M14.5 9.5a4 4 0 1 1-1.2 2.9L4 21.5M7 18.5l2.5 2.5M9.5 16l2 2"), solid("M15.5 8.5a1.2 1.2 0 1 0 0.01 0z")],
  replay: [stroke("M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9")],
  clock: [stroke("M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2")],
  sleep: [stroke("M4 9h5l-5 6h5M12 4h4l-4 5h4M17 13h3.5l-3.5 4.5h3.5")],
  question: [stroke("M8.5 9a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3V15.5"), solid("M12 18.2a1.3 1.3 0 1 0 0.01 0z")],
} satisfies Record<string, Part[]>;

export type IconName = keyof typeof ICONS;

/** Иконка `name` размером `size` с левым верхним углом в (x, y). */
export function icon(pen: Pen, key: string, name: IconName, x: number, y: number, size: number, color: string, attrs: Attrs = {}): void {
  pen.group(key, x, y, () => {
    ICONS[name].forEach((part: Part, i) =>
      pen.path(`${key}:${i}`, part.fill
        ? { d: part.d, fill: color, stroke: "none" }
        : { d: part.d, stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    );
  }, attrs, { scale: size / 24 });
}
