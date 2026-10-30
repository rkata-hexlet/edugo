import type { Attrs, Pen, TextContent } from "../engine/contract";
import { COLOR, FONT, SIZE } from "./theme";
import { pill } from "./widgets";

// Предметы мира серии (motion-designer, эпизод 05): кружка, покупатель, навес витрины, кнопка «Купить»,
// замок с дужкой; эпизод 09 — бирка замка, корона лидера; эпизод 13 — флажок закладки; эпизод 03 — банка-копилка. Только примитивы Pen; (x, y) — левый верхний угол; анимацию вешает эпизод классом fx-*.

/** Размер кружки без пара: корпус и ручка. */
export const MUG = { w: 54, h: 36 };

/**
 * Кружка: корпус, ручка, пар. `ghost` — кружки нет, а подтверждение есть: только красный пунктир контура
 * (лишний заказ). `steam` — пар над свежей кружкой на витрине.
 */
export function mug(pen: Pen, key: string, o: { x: number; y: number; ghost?: boolean; steam?: boolean; attrs?: Attrs }): void {
  const line: Attrs = o.ghost ? { fill: "none", stroke: COLOR.error, "stroke-width": 2.5, "stroke-dasharray": "5 4" } : { fill: COLOR.mug };
  pen.group(key, o.x, o.y, () => {
    pen.path(`${key}:handle`, {
      d: "M 38 8 Q 54 8 54 18 Q 54 28 38 28", fill: "none",
      stroke: o.ghost ? COLOR.error : COLOR.mug, "stroke-width": o.ghost ? 2.5 : 5, ...(o.ghost ? { "stroke-dasharray": "5 4" } : {}),
    });
    pen.rect(`${key}:body`, { x: 0, y: 0, width: 40, height: 36, rx: 8, ...line });
    if (!o.ghost) pen.rect(`${key}:rim`, { x: 4, y: 4, width: 32, height: 5, rx: 2.5, fill: COLOR.mugRim });
    if (o.steam) [10, 24].forEach((sx, i) =>
      pen.path(`${key}:steam${i}`, { d: `M ${sx} -4 q -5 -6 0 -12 q 5 -6 0 -12`, fill: "none", stroke: COLOR.muted, "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0.5 }));
  }, o.attrs);
}

export type PersonMood = "idle" | "happy" | "sad";

/** Размер покупателя: голова и плечи. */
export const PERSON = { w: 44, h: 46 };

/** Покупатель: голова, плечи в цвете пода (цвет = кто), глаза смотрят на `look`; грустный — брови домиком. */
export function person(
  pen: Pen, key: string,
  o: { x: number; y: number; shirt: string; mood: PersonMood; look?: { x: number; y: number }; attrs?: Attrs },
): void {
  const lx = (o.look?.x ?? 0) * 2;
  const ly = (o.look?.y ?? 0) * 2;
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:body`, { x: 0, y: 24, width: 44, height: 22, rx: 11, fill: o.shirt });
    pen.rect(`${key}:head`, { x: 9, y: 0, width: 26, height: 26, rx: 13, fill: COLOR.skin });
    [16, 28].forEach((ex, i) => pen.rect(`${key}:eye${i}`, { x: ex - 2 + lx, y: 10 + ly, width: 4, height: 4, rx: 2, fill: COLOR.bg }));
    const mouth = o.mood === "happy" ? "M 17 18 Q 22 23 27 18" : o.mood === "sad" ? "M 17 21 Q 22 17 27 21" : "M 18 19 L 26 19";
    pen.path(`${key}:mouth`, { d: mouth, fill: "none", stroke: COLOR.bg, "stroke-width": 2, "stroke-linecap": "round" });
    if (o.mood === "sad") [[12, 9, 18, 7], [32, 9, 26, 7]].forEach(([x1, y1, x2, y2], i) =>
      pen.line(`${key}:brow${i}`, { x1, y1, x2, y2, stroke: COLOR.bg, "stroke-width": 2, "stroke-linecap": "round" }));
  }, o.attrs);
}

/** Навес витрины: полукруглые «зубцы» двух цветов во всю ширину. */
export function awning(pen: Pen, key: string, o: { x: number; y: number; w: number; teeth?: number }): void {
  const n = o.teeth ?? 8;
  const tw = o.w / n;
  pen.group(key, o.x, o.y, () => {
    for (let i = 0; i < n; i++) {
      pen.path(`${key}:t${i}`, {
        d: `M ${i * tw} 0 h ${tw} v 14 a ${tw / 2} ${tw / 2} 0 0 1 ${-tw} 0 z`,
        fill: i % 2 ? COLOR.awning2 : COLOR.browser,
      });
    }
  });
}

/** Кнопка покупки («Купить» по умолчанию; `label`, `w` — своя надпись и ширина): нажатая — темнее и ниже на 2 px. */
export function buyButton(pen: Pen, key: string, o: { x: number; y: number; pressed: boolean; label?: string; w?: number; attrs?: Attrs }): void {
  const dy = o.pressed ? 2 : 0;
  const w = o.w ?? 96;
  pen.group(key, o.x, o.y, () => {
    if (!o.pressed) pen.rect(`${key}:sh`, { x: 0, y: 3, width: w, height: 32, rx: 9, fill: COLOR.shadow });
    pen.rect(`${key}:bg`, { x: 0, y: dy, width: w, height: 32, rx: 9, fill: o.pressed ? COLOR.awning2 : COLOR.browser });
    pen.text(`${key}:t`, {
      x: w / 2, y: dy + 22, "font-family": FONT.sans, "font-size": SIZE.body, "font-weight": 700, fill: COLOR.bg, "text-anchor": "middle",
    }, o.label ?? "Купить");
  }, o.attrs);
}

/** Размер замка: тело и дужка над ним. */
export const LOCK = { w: 22, h: 24 };

/**
 * Замок: тело в цвете владельца и дужка отдельной группой `${key}:sh` — её анимирует эпизод
 * (`fx-lock` — защёлкнулся, `fx-unlock` — открылся). Открытый — дужка поднята и повёрнута.
 */
export function lock(pen: Pen, key: string, o: { x: number; y: number; color: string; open?: boolean; shackle?: Attrs; attrs?: Attrs }): void {
  pen.group(key, o.x, o.y, () => {
    pen.group(`${key}:sh`, 0, o.open ? -5 : 0, () =>
      pen.path(`${key}:sh:p`, { d: "M 5 10 V 6 a 6 6 0 0 1 12 0 V 10", fill: "none", stroke: o.color, "stroke-width": 3, "stroke-linecap": "round" }),
    o.shackle, o.open ? { rotate: -25, origin: [5, 10] } : {});
    pen.rect(`${key}:body`, { x: 0, y: 9, width: 22, height: 15, rx: 3, fill: o.color });
    pen.rect(`${key}:hole`, { x: 9.5, y: 13, width: 3, height: 6, rx: 1.5, fill: COLOR.bg });
  }, o.attrs);
}

/**
 * Бирка замка (эпизод 09): замок ×1.4 и метка на подложке 92×44, чтобы провод под ней не резал корпус;
 * (x, y) — центр. `open` — замок отпущен: дужка открывается, бирка гаснет; `fresh` — только что взят.
 */
export function lockTag(pen: Pen, key: string, o: { x: number; y: number; color: string; label: string; open?: boolean; fresh?: boolean }): void {
  pen.group(key, o.x - 40, o.y - 22, () => {
    pen.rect(`${key}:bg`, { width: 92, height: 44, rx: 10, fill: COLOR.bg2, stroke: o.color, "stroke-width": 2 });
    pen.group(`${key}:l`, 8, 6, () => lock(pen, `${key}:lk`, {
      x: 0, y: 0, color: o.color, open: o.open, shackle: o.open ? { class: "fx-unlock" } : o.fresh ? { class: "fx-lock" } : {},
    }), {}, { scale: 1.4 });
    pen.text(`${key}:n`, { x: 44, y: 29, "font-family": FONT.mono, "font-size": SIZE.body, fill: COLOR.ink, "font-weight": 700 }, o.label);
  }, o.open ? { class: "fx-fade", opacity: 0.5 } : o.fresh ? { class: "fx-pop" } : {});
}

/** Размер короны лидера. */
export const CROWN = { w: 48, h: 26 };

/** Корона (эпизод 09: под уверен, что он лидер): три зубца с жемчужинами и обод; (x, y) — левый верхний угол. */
export function crown(pen: Pen, key: string, o: { x: number; y: number; color: string; attrs?: Attrs }): void {
  pen.group(key, o.x, o.y, () => {
    pen.path(`${key}:b`, { d: "M2 26 L0 6 L12 14 L24 2 L36 14 L48 6 L46 26 Z", fill: o.color, stroke: COLOR.bg, "stroke-width": 2 });
    [[0, 6], [24, 2], [48, 6]].forEach(([cx, cy], i) =>
      pen.rect(`${key}:p${i}`, { x: cx - 4, y: cy - 4, width: 8, height: 8, rx: 4, fill: o.color, stroke: COLOR.bg, "stroke-width": 1.5 }));
  }, o.attrs);
}

/** Флажок закладки: ножка BOOKMARK.h, вымпел, от ножки до пилюли — BOOKMARK.gap. */
export const BOOKMARK = { h: 30, flag: 24, gap: 32 };

/**
 * Закладка (эпизод 13: «запомнили, на чём остановились»): флажок у строки и пилюля со значением справа; (x, y) — основание
 * ножки по x и середина строки по y. Ключ один на всю сцену — при смене y флажок переезжает. `label` — кусками, если частей
 * несколько (цена ярко, id тусклее). `fresh` — только что воткнули: ножка прорисовывается, вымпел и пилюля выскакивают.
 */
export function bookmark(
  pen: Pen, key: string,
  o: { x: number; y: number; label: TextContent; color?: string; fill?: string; fresh?: boolean; attrs?: Attrs },
): void {
  const color = o.color ?? COLOR.ok;
  const top = -BOOKMARK.h / 2;
  pen.group(key, o.x, o.y, () => {
    pen.line(`${key}:pole`, { x1: 0, y1: -top, x2: 0, y2: top, stroke: color, "stroke-width": 3, "stroke-linecap": "round", ...(o.fresh ? { pathLength: 1, class: "fx-draw" } : {}) });
    pen.path(`${key}:flag`, { d: `M 0 ${top} L ${BOOKMARK.flag} ${top + 8} L 0 ${top + 16} Z`, fill: color, ...(o.fresh ? { class: "fx-pop d1" } : {}) });
    const h = Math.round(SIZE.body * 1.8);
    pill(pen, `${key}:t`, o.label, { x: BOOKMARK.gap, y: -h / 2, fill: o.fill ?? COLOR.doneBg, color, stroke: color, mono: true, attrs: o.fresh ? { class: "fx-pop d1" } : {} });
  }, o.attrs);
}

/** Размер банки-копилки: крышка с прорезью и корпус. */
export const JAR = { w: 34, h: 32 };

/**
 * Банка-копилка (эпизод 03: под копит клики и сбрасывает их пачкой): корпус, крышка с прорезью, уровень `fill` 0…1
 * цветом `color`. Уровень меняется плавно (`.tw`): сброс — заливка уходит вниз. (x, y) — левый верхний угол крышки.
 */
export function jar(pen: Pen, key: string, o: { x: number; y: number; fill: number; color?: string; attrs?: Attrs }): void {
  const level = Math.max(0, Math.min(1, o.fill));
  const h = 18 * level;
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:f`, { x: 5, y: 28 - h, width: 24, height: h, rx: 2, fill: o.color ?? COLOR.warn, class: "tw" });
    pen.path(`${key}:b`, { d: "M 2 8 h 30 v 18 q 0 5 -5 5 h -20 q -5 0 -5 -5 z", fill: "none", stroke: COLOR.ink, "stroke-width": 2, "stroke-linejoin": "round" });
    pen.rect(`${key}:lid`, { x: 0, y: 2, width: 34, height: 6, rx: 3, fill: COLOR.ink });
    pen.line(`${key}:slot`, { x1: 10, y1: 5, x2: 24, y2: 5, stroke: COLOR.bg, "stroke-width": 2, "stroke-linecap": "round" });
  }, o.attrs);
}
