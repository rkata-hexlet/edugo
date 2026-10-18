import type { Pen } from "../engine/contract";
import { icon } from "./icons";
import { COLOR, FONT } from "./theme";

// Персонажи серии в примитивах Pen (прямоугольники со скруглением, пути). Эмоцию и взгляд выбирает
// эпизод по состоянию кадра — персонаж только рисует то, что ему сказали.

export type Mood = "idle" | "work" | "wait" | "won" | "lost" | "frozen" | "talk";

/** Куда смотрят зрачки: −1…1 по каждой оси (влево/вверх — минус). */
export type Look = { x: number; y: number };

/** Размер «боба» без антенны: тело + ножки. */
export const BOB = { w: 64, h: 64 };

/**
 * Под-«боб»: тело с брюшком и буквой, антенна-индикатор, глаза со зрачками, ножки. (x, y) — левый
 * верхний угол тела; антенна торчит на 16 выше. `ghost` — упал: только призрачный контур.
 */
export function bob(
  pen: Pen, key: string,
  o: { x: number; y: number; color: string; tint: string; letter: string; mood: Mood; look: Look; ghost?: boolean; dashed?: boolean },
): void {
  const { color, tint, mood } = o;
  const frozen = mood === "frozen";
  const body = frozen ? "#3a4058" : color;
  pen.group(key, o.x, o.y, () => {
    if (o.ghost) {
      pen.rect(`${key}:body`, { width: 64, height: 58, rx: 26, fill: "none", stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "6 5" });
      [22, 42].forEach((cx, i) => icon(pen, `${key}:x${i}`, "cross", cx - 6, 16, 12, COLOR.faint));
      return;
    }
    // Антенна: горит, когда под работает; жёлтая — ждёт; погашена — завис.
    const lamp = frozen ? COLOR.faint : mood === "wait" ? COLOR.warn : mood === "work" || mood === "won" ? COLOR.ok : COLOR.muted;
    pen.line(`${key}:ant`, { x1: 32, y1: 0, x2: 32, y2: -10, stroke: body, "stroke-width": 3, "stroke-linecap": "round" });
    pen.rect(`${key}:bulb`, { x: 27, y: -17, width: 10, height: 10, rx: 5, fill: lamp });
    [14, 42].forEach((lx, i) => pen.rect(`${key}:leg${i}`, { x: lx, y: 54, width: 9, height: 10, rx: 4, fill: body }));
    pen.rect(`${key}:shadow`, { x: 0, y: 4, width: 64, height: 54, rx: 26, fill: COLOR.shadow });
    pen.rect(`${key}:body`, {
      width: 64, height: 56, rx: 26, fill: body,
      ...(o.dashed ? { stroke: COLOR.ink, "stroke-width": 2, "stroke-dasharray": "6 5" } : {}),
    });
    // Лицо — тёмная «маска», на ней глаза: читается на любом цвете тела.
    pen.rect(`${key}:face`, { x: 9, y: 9, width: 46, height: 24, rx: 12, fill: tint });
    eyes(pen, key, mood, o.look);
    mouth(pen, key, mood);
    pen.text(`${key}:letter`, {
      x: 32, y: 52, "text-anchor": "middle", "font-family": FONT.sans, "font-size": 18, "font-weight": 800, fill: frozen ? COLOR.muted : COLOR.bg,
    }, o.letter);
  });
}

function eyes(pen: Pen, key: string, mood: Mood, look: Look): void {
  [22, 42].forEach((cx, i) => {
    const k = `${key}:eye${i}`;
    if (mood === "frozen") {
      pen.path(k, { d: `M ${cx - 5} 21 Q ${cx} 24 ${cx + 5} 21`, stroke: COLOR.muted, "stroke-width": 2.5, "stroke-linecap": "round" });
      return;
    }
    if (mood === "won") {
      // Глаза-дуги «довольно щурится».
      pen.path(k, { d: `M ${cx - 5} 23 Q ${cx} 16 ${cx + 5} 23`, stroke: COLOR.ink, "stroke-width": 3, "stroke-linecap": "round" });
      return;
    }
    pen.group(k, 0, 0, () => {
      pen.rect(`${k}:w`, { x: cx - 6.5, y: 14, width: 13, height: 14, rx: 6.5, fill: COLOR.ink });
      pen.rect(`${k}:p`, { x: cx - 3.5 + look.x * 3, y: 17.5 + look.y * 3, width: 7, height: 7, rx: 3.5, fill: COLOR.bg });
      // Ждёт — веки опущены до половины.
      if (mood === "wait") pen.rect(`${k}:lid`, { x: cx - 7.5, y: 13, width: 15, height: 8, rx: 3, fill: "#1a2140" });
      if (mood === "lost") pen.line(`${k}:brow`, { x1: cx - 6, y1: i ? 12 : 10, x2: cx + 6, y2: i ? 10 : 12, stroke: COLOR.ink, "stroke-width": 2.5, "stroke-linecap": "round" });
    });
  });
}

function mouth(pen: Pen, key: string, mood: Mood): void {
  const k = `${key}:mouth`;
  const style = { stroke: COLOR.bg, "stroke-width": 2.5, "stroke-linecap": "round" };
  if (mood === "talk") pen.rect(k, { x: 28, y: 35, width: 8, height: 7, rx: 3.5, fill: COLOR.bg });
  else if (mood === "won" || mood === "work") pen.path(k, { d: "M 26 36 Q 32 42 38 36", ...style });
  else if (mood === "lost") pen.path(k, { d: "M 26 41 Q 32 35 38 41", ...style });
  else pen.line(k, { x1: 28, y1: 38, x2: 36, y2: 38, ...style });
}

/** «Купол процесса» вокруг пода: то, что внутри (мьютекс), видно только этому поду. */
export function dome(pen: Pen, key: string, o: { x: number; y: number; w: number; h: number; color: string }): void {
  pen.rect(key, {
    x: o.x, y: o.y, width: o.w, height: o.h, rx: 28,
    fill: o.color, "fill-opacity": 0.08, stroke: o.color, "stroke-opacity": 0.7, "stroke-width": 1.5, "stroke-dasharray": "5 5",
  });
}

/** Слон-Postgres: голова с ухом, хоботом и очками. (x, y) — левый верхний угол квадрата 56×56. */
export function elephant(pen: Pen, key: string, o: { x: number; y: number; talking: boolean }): void {
  const skin = COLOR.postgres;
  pen.group(key, o.x, o.y, () => {
    pen.rect(`${key}:ear`, { x: 22, y: 4, width: 34, height: 40, rx: 17, fill: "#5f7299" });
    pen.rect(`${key}:head`, { x: 0, y: 2, width: 44, height: 44, rx: 22, fill: skin });
    // Хобот — вниз и вперёд; когда говорит — приподнят.
    pen.path(`${key}:trunk`, {
      d: o.talking ? "M 10 34 Q 2 44 -6 36" : "M 10 34 Q 4 50 -4 54",
      stroke: skin, "stroke-width": 9, "stroke-linecap": "round",
    });
    // Очки: две оправы и перемычка.
    [8, 24].forEach((ex, i) => pen.rect(`${key}:lens${i}`, { x: ex, y: 15, width: 13, height: 12, rx: 6, fill: "#e8edff", stroke: COLOR.bg, "stroke-width": 2 }));
    pen.line(`${key}:bridge`, { x1: 21, y1: 21, x2: 24, y2: 21, stroke: COLOR.bg, "stroke-width": 2 });
    [14.5, 30.5].forEach((ex, i) => pen.rect(`${key}:pupil${i}`, { x: ex - 2.5, y: 19, width: 5, height: 5, rx: 2.5, fill: COLOR.bg }));
  });
}

export type MailMood = "calm" | "alarm" | "relieved" | "asleep";

/** Лицо Почты (для заголовка ящика): спит, спокойна, тревога (дубль), облегчение (повтор погашен). */
export function mailFace(pen: Pen, key: string, o: { x: number; y: number; mood: MailMood }): void {
  const c = o.mood === "alarm" ? COLOR.error : o.mood === "relieved" ? COLOR.ok : COLOR.mail;
  const style = { stroke: c, "stroke-width": 2.5, "stroke-linecap": "round" };
  pen.group(key, o.x, o.y, () => {
    [0, 22].forEach((ex, i) => {
      if (o.mood === "asleep") pen.path(`${key}:e${i}`, { d: `M ${ex - 4} 0 Q ${ex} 3 ${ex + 4} 0`, ...style });
      else pen.rect(`${key}:e${i}`, { x: ex - 4, y: -4, width: 8, height: o.mood === "alarm" ? 10 : 8, rx: 4, fill: c });
    });
    const d = o.mood === "alarm" ? "M 3 16 Q 11 10 19 16" : o.mood === "relieved" ? "M 3 11 Q 11 18 19 11" : "M 5 13 L 17 13";
    pen.path(`${key}:m`, { d, ...style });
  });
}
