import type { Pen } from "../engine/contract";
import { icon } from "./icons";
import { lock } from "./props";
import { COLOR, FONT } from "./theme";

// Персонажи серии в примитивах Pen (прямоугольники со скруглением, пути). Эмоцию и взгляд выбирает
// эпизод по состоянию кадра — персонаж только рисует то, что ему сказали.

export type Mood = "idle" | "work" | "wait" | "won" | "lost" | "frozen" | "talk";

/** Куда смотрят зрачки: −1…1 по каждой оси (влево/вверх — минус). */
export type Look = { x: number; y: number };

/**
 * Руки пода: `crossed` — скрещены на брюшке («ждём друг друга»), `open` — ладони по бокам. `locks` — сколько замков
 * держит под (висят у боков, справа первый; цвет — `lockColor`): «замок в руках» до COMMIT; 0 при `open` — пустые руки.
 */
export type Hands = { pose: "crossed" | "open"; locks: number; lockColor: string };

/** Размер «боба» без антенны: тело + ножки. */
export const BOB = { w: 64, h: 64 };

/**
 * Под-«боб»: тело с брюшком и буквой, антенна-индикатор, глаза со зрачками, ножки. (x, y) — левый
 * верхний угол тела; антенна торчит на 16 выше. `ghost` — упал: только призрачный контур.
 */
export function bob(
  pen: Pen, key: string,
  o: { x: number; y: number; color: string; tint: string; letter: string; mood: Mood; look: Look; ghost?: boolean; dashed?: boolean; hands?: Hands },
): void {
  const { color, tint, mood } = o;
  const frozen = mood === "frozen";
  // Проиграл — тело тускнеет: «проиграл» не должен выглядеть как «ничего не делает».
  const body = frozen ? "#343a52" : mood === "lost" ? mix(color, "#3a4058", 0.35) : color;
  pen.group(key, o.x, o.y, () => {
    if (o.ghost) {
      pen.rect(`${key}:body`, { width: 64, height: 58, rx: 26, fill: "none", stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "6 5" });
      [22, 42].forEach((cx, i) => icon(pen, `${key}:x${i}`, "cross", cx - 6, 16, 12, COLOR.faint));
      return;
    }
    // Антенна: горит, когда под работает; жёлтая — ждёт; погашена — завис.
    const lamp = frozen ? COLOR.faint : mood === "wait" ? COLOR.warn : mood === "work" || mood === "won" ? COLOR.ok : COLOR.muted;
    pen.line(`${key}:ant`, { x1: 32, y1: 0, x2: 32, y2: -10, stroke: body, "stroke-width": 3, "stroke-linecap": "round" });
    if (mood === "work" || mood === "won") pen.rect(`${key}:halo`, { x: 24, y: -20, width: 16, height: 16, rx: 8, fill: lamp, opacity: 0.35 });
    pen.rect(`${key}:bulb`, { x: 27, y: -17, width: 10, height: 10, rx: 5, fill: lamp });
    if (mood === "wait") icon(pen, `${key}:hg`, "hourglass", 40, -26, 18, COLOR.warn);
    [14, 42].forEach((lx, i) => pen.rect(`${key}:leg${i}`, { x: lx, y: 54, width: 9, height: 10, rx: 4, fill: body }));
    pen.rect(`${key}:shadow`, { x: 0, y: 3, width: 64, height: 54, rx: 26, fill: COLOR.shadow });
    pen.rect(`${key}:body`, {
      width: 64, height: 56, rx: 26, fill: body,
      ...(o.dashed ? { stroke: COLOR.ink, "stroke-width": 2, "stroke-dasharray": "6 5" } : frozen ? { stroke: "#6b7aa8", "stroke-width": 1.5 } : {}),
    });
    // Лицо — тёмная «маска», на ней глаза: читается на любом цвете тела.
    // Маска лица: глаза и рот внутри неё, буква — на брюшке ниже.
    pen.rect(`${key}:face`, { x: 7, y: 5, width: 50, height: 34, rx: 15, fill: tint });
    eyes(pen, key, mood, o.look);
    mouth(pen, key, mood);
    // Руки — под буквой: скрещённые на брюшке не должны закрывать, кто это.
    if (o.hands) hands(pen, `${key}:hands`, body, o.hands);
    pen.text(`${key}:letter`, {
      x: 32, y: 54, "text-anchor": "middle", "font-family": FONT.sans, "font-size": 18, "font-weight": 800, fill: frozen ? COLOR.muted : COLOR.bg,
    }, o.letter);
  });
}

/** Руки и замки в них: поверх тела; замки висят снаружи, у боков. */
function hands(pen: Pen, key: string, body: string, h: Hands): void {
  const arm = { fill: "none", stroke: mix(body, "#ffffff", 0.18), "stroke-width": 6, "stroke-linecap": "round" };
  pen.group(key, 0, 0, () => {
    if (h.pose === "crossed") {
      pen.path(`${key}:l`, { d: "M 2 34 Q 24 46 46 36", ...arm });
      pen.path(`${key}:r`, { d: "M 62 34 Q 40 46 18 36", ...arm });
    } else {
      pen.path(`${key}:l`, { d: "M 3 30 Q -6 36 -6 44", ...arm });
      pen.path(`${key}:r`, { d: "M 61 30 Q 70 36 70 44", ...arm });
    }
    // Замки: справа, затем слева — у кисти открытой руки или у локтя скрещённой.
    [[64, 38], [-18, 38]].slice(0, h.locks).forEach(([lx, ly], i) =>
      lock(pen, `${key}:lock${i}`, { x: lx, y: ly, color: h.lockColor }));
  });
}

function eyes(pen: Pen, key: string, mood: Mood, look: Look): void {
  [21, 43].forEach((cx, i) => {
    const k = `${key}:eye${i}`;
    if (mood === "frozen") {
      pen.path(k, { d: `M ${cx - 5} 18 Q ${cx} 21 ${cx + 5} 18`, stroke: COLOR.muted, "stroke-width": 2.5, "stroke-linecap": "round" });
      return;
    }
    if (mood === "won") {
      // Глаза-дуги «довольно щурится».
      pen.path(k, { d: `M ${cx - 6} 21 Q ${cx} 12 ${cx + 6} 21`, stroke: COLOR.ink, "stroke-width": 3.5, "stroke-linecap": "round" });
      return;
    }
    const h = mood === "work" ? 16 : 15;
    pen.group(k, 0, 0, () => {
      pen.rect(`${k}:w`, { x: cx - 7.5, y: 10, width: 15, height: h, rx: 7.5, fill: COLOR.ink });
      // Зрачок ходит почти до края белка: взгляд на цель читается и на мелком кадре.
      pen.rect(`${k}:p`, { x: cx - 4 + look.x * 3.5, y: 10 + h / 2 - 4 + look.y * 3, width: 8, height: 8, rx: 4, fill: COLOR.bg });
      const brow = (x1: number, y1: number, x2: number, y2: number) =>
        pen.line(`${k}:brow`, { x1, y1, x2, y2, stroke: COLOR.ink, "stroke-width": 3, "stroke-linecap": "round" });
      // Ждёт — брови домиком; проиграл — сведены и опущены к переносице.
      if (mood === "wait") (i ? brow(cx - 6, 5, cx + 6, 7) : brow(cx - 6, 7, cx + 6, 5));
      if (mood === "lost") (i ? brow(cx - 5, 9, cx + 7, 4) : brow(cx - 7, 4, cx + 5, 9));
    });
  });
}

function mouth(pen: Pen, key: string, mood: Mood): void {
  const k = `${key}:mouth`;
  const style = { stroke: COLOR.ink, "stroke-width": 2.5, "stroke-linecap": "round" };
  if (mood === "talk") pen.rect(k, { x: 27, y: 28, width: 10, height: 8, rx: 4, fill: COLOR.ink });
  else if (mood === "wait") pen.rect(k, { x: 29, y: 29, width: 6, height: 6, rx: 3, fill: COLOR.ink });
  else if (mood === "won" || mood === "work") pen.path(k, { d: "M 25 29 Q 32 36 39 29", ...style });
  else if (mood === "lost") pen.path(k, { d: "M 26 35 Q 32 28 38 35", ...style, "stroke-width": 3 });
  else pen.line(k, { x1: 28, y1: 32, x2: 36, y2: 32, ...style });
}

/** Слон-Postgres: голова с ухом, хоботом и очками. (x, y) — левый верхний угол квадрата 56×56; scale — крупнее. */
/**
 * Слон-Postgres. `look` — куда смотрят зрачки (на строку, на поды); `frown` — нахмурен (отказ, 0 строк).
 * Без них — прежний слон эпизодов 01–02.
 */
export function elephant(pen: Pen, key: string, o: { x: number; y: number; talking: boolean; scale?: number; look?: Look; frown?: boolean }): void {
  const skin = "#8ea4d6";
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:ear`, { x: 22, y: 4, width: 34, height: 40, rx: 17, fill: "#6d82b3" });
    pen.rect(`${key}:head`, { x: 0, y: 2, width: 44, height: 44, rx: 22, fill: skin });
    // Хобот — вниз и вперёд; когда говорит — приподнят.
    pen.path(`${key}:trunk`, {
      d: o.talking ? "M 10 34 Q 2 44 -6 36" : "M 10 34 Q 4 50 -4 54",
      stroke: skin, "stroke-width": 9, "stroke-linecap": "round",
    });
    // Очки: две оправы и перемычка.
    [8, 24].forEach((ex, i) => pen.rect(`${key}:lens${i}`, { x: ex, y: 15, width: 13, height: 12, rx: 6, fill: "#e8edff", stroke: COLOR.bg, "stroke-width": 2 }));
    pen.line(`${key}:bridge`, { x1: 21, y1: 21, x2: 24, y2: 21, stroke: COLOR.bg, "stroke-width": 2 });
    const px = (o.look?.x ?? 0) * 3;
    const py = (o.look?.y ?? 0) * 2.5;
    [14.5, 30.5].forEach((ex, i) => pen.rect(`${key}:pupil${i}`, { x: ex - 2.5 + px, y: 19 + py, width: 5, height: 5, rx: 2.5, fill: COLOR.bg }));
    if (o.frown) [[8, 10, 19, 14], [36, 10, 25, 14]].forEach(([x1, y1, x2, y2], i) =>
      pen.line(`${key}:brow${i}`, { x1, y1, x2, y2, stroke: COLOR.bg, "stroke-width": 3, "stroke-linecap": "round" }));
  }, {}, { scale: o.scale ?? 1 });
}

export type MailMood = "calm" | "alarm" | "relieved" | "asleep";

/** Лицо Почты (для заголовка ящика): спит, спокойна, тревога (дубль), облегчение (повтор погашен). */
export function mailFace(pen: Pen, key: string, o: { x: number; y: number; mood: MailMood }): void {
  const c = o.mood === "alarm" ? COLOR.error : o.mood === "relieved" ? COLOR.ok : COLOR.mail;
  const style = { stroke: c, "stroke-width": 3, "stroke-linecap": "round" };
  pen.group(key, o.x, o.y, () => {
    [0, 30].forEach((ex, i) => {
      if (o.mood === "asleep") pen.path(`${key}:e${i}`, { d: `M ${ex - 6} 0 Q ${ex} 4 ${ex + 6} 0`, ...style });
      else pen.rect(`${key}:e${i}`, { x: ex - 6, y: -6, width: 12, height: o.mood === "alarm" ? 15 : 12, rx: 6, fill: c });
    });
    const d = o.mood === "alarm" ? "M 3 22 Q 15 13 27 22"
      : o.mood === "relieved" ? "M 2 14 Q 15 26 28 14"
      : o.mood === "calm" ? "M 7 16 Q 15 21 23 16"
      : "M 9 17 L 21 17";
    pen.path(`${key}:m`, { d, ...style });
  });
}

/** Смешать два цвета #rrggbb: t = 0 — первый, 1 — второй. */
function mix(a: string, b: string, t: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, "0")).join("");
}
