import { STAGE, type Attrs, type Pen } from "../../engine/contract";
import { bob, elephant, mailFace, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, once, panel, pill } from "../../kit/widgets";
import { CREW, type Focus, type Who, type World } from "./sim";

// Отрисовка «Внутренней кухни» — MVP фазы 0: серые фигуры и подписи, без полировки (CLAUDE.md, «Процесс эпизода»).
// Раскладка: верх — площадка и ящик клиента; середина — график и вставка артефакта (или печати трюков);
// низ — съёмочная группа. Хлопушка, «СТОП!», титул и титры — поверх всего.

const CAST: Record<Who, { letter: string; name: string; color: string; tint: string; x: number }> = {
  director: { letter: "Р", name: "режиссёр", color: "#ffd166", tint: "#5a4a1c", x: 80 },
  arch: { letter: "А", name: "архитектор", color: ACTOR.C.color, tint: ACTOR.C.tint, x: 250 },
  method: { letter: "М", name: "методист", color: COLOR.ok, tint: "#164a36", x: 420 },
  exec: { letter: "И", name: "исполнитель", color: ACTOR.A.color, tint: ACTOR.A.tint, x: 590 },
  stunt: { letter: "К", name: "каскадёр", color: COLOR.error, tint: "#5a1f2a", x: 760 },
};
const CREW_Y = 492;

const sans = (size: number, weight = 600) => ({ "font-family": FONT.sans, "font-size": size, "font-weight": weight });
const mono = (size: number) => ({ "font-family": FONT.mono, "font-size": size });

/** Приглушить то, о чём кадр не говорит. */
function lit(w: World, ...what: Focus[]): Attrs {
  return !w.focus || what.some((f) => w.focus!.includes(f)) ? {} : { opacity: DIM };
}

export function render(pen: Pen, w: World): void {
  pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg });
  if (w.stage.on) stage(pen, w);
  if (w.inbox.on) inbox(pen, w);
  if (w.chart.on) chart(pen, w);
  if (w.seals.length) seals(pen, w);
  if (w.art) art(pen, w);
  crew(pen, w);
  counters(pen, w);
  pen.layer("top", () => {
    if (w.clap) clapper(pen, w);
    if (w.stop) stopStamp(pen, w);
    if (w.title) titleCard(pen, w);
    if (w.credits) credits(pen, w);
  });
}

/** Площадка: слон-Postgres, очередь задач, обработчики, хозяин-сосед. */
function stage(pen: Pen, w: World): void {
  const s = w.stage;
  pen.group("stage", 40, 70, () => {
    panel(pen, "stage:p", { x: 0, y: 0, w: 900, h: 220, fill: COLOR.bg2 });
    elephant(pen, "stage:pg", { x: 24, y: 40, talking: false, scale: 1.3 });
    if (s.sale) pill(pen, "stage:sale", "распродажа", { x: 300, y: 178, fill: COLOR.alarmBg, color: COLOR.warn, size: SIZE.min });
    // Очередь jobs: строки сверху вниз, первая — голова.
    for (let i = 0; i < s.queue; i++) {
      pen.rect(`stage:row${i}`, { x: 130, y: 14 + i * 30, width: 110, height: 26, rx: 5, fill: COLOR.surface2, stroke: COLOR.line });
      pen.text(`stage:rowt${i}`, { x: 140, y: 33 + i * 30, fill: COLOR.muted, ...mono(SIZE.min) }, `job ${i + 1}`);
    }
    if (s.tail) pen.text("stage:tail", { x: 130, y: 210, fill: COLOR.warn, ...sans(SIZE.body, 700) }, s.tail);
    // Обработчики: без SKIP LOCKED все целятся в первую строку, работает один; со SKIP LOCKED — у каждого своя.
    const perRow = s.workers > 8 ? 8 : 4;
    for (let i = 0; i < s.workers; i++) {
      const x = 300 + (i % perRow) * (s.workers > 8 ? 52 : 80);
      const y = 22 + Math.floor(i / perRow) * 90;
      const row = s.spread ? i % s.queue : 0;
      const busy = s.spread || i === 0;
      pen.line(`stage:aim${i}`, {
        x1: x, y1: y + 16, x2: 240, y2: 27 + row * 30,
        stroke: busy ? COLOR.ok : COLOR.faint, "stroke-width": 1.5, ...(busy ? {} : { "stroke-dasharray": "4 4" }),
      });
      pen.group(`stage:w${i}`, x, y, () =>
        bob(pen, `stage:wb${i}`, { x: 0, y: 0, color: COLOR.muted, tint: COLOR.surface2, letter: String(i + 1), mood: busy ? "work" : "wait", look: { x: -1, y: 0 } }),
      {}, { scale: 0.55 });
    }
    if (s.host !== "none") {
      const frozen = s.host === "frozen";
      pen.group("stage:host", 780, 40, () =>
        bob(pen, "stage:hostb", { x: 0, y: 0, color: COLOR.redis, tint: "#5a2440", letter: "П", mood: frozen ? "frozen" : "work", look: { x: -1, y: 0 } }));
      pen.text("stage:hostt", { x: 812, y: 140, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.min, 500) }, frozen ? "заморожен" : "хозяин площадки");
      if (frozen) icon(pen, "stage:ice", "sleep", 830, 20, 24, COLOR.mail);
    }
  }, lit(w, "stage"));
}

/** Ящик клиента: письма и повторы. */
function inbox(pen: Pen, w: World): void {
  const b = w.inbox;
  const alarm = b.repeats > 0;
  pen.group("inbox", 970, 70, () => {
    panel(pen, "inbox:p", { x: 0, y: 0, w: 270, h: 220, fill: COLOR.bg2, stroke: alarm ? COLOR.error : COLOR.line });
    mailFace(pen, "inbox:face", { x: 30, y: 34, mood: alarm ? "alarm" : b.letters ? "relieved" : "asleep" });
    pen.text("inbox:h", { x: 90, y: 42, fill: COLOR.ink, ...sans(SIZE.body, 700) }, "ящик клиента");
    const shown = Math.min(b.letters, 10);
    for (let i = 0; i < shown; i++)
      icon(pen, `inbox:l${i}`, "mail", 20 + (i % 5) * 46, 80 + Math.floor(i / 5) * 40, 32, i > 0 && alarm ? COLOR.error : COLOR.mail);
    pen.text("inbox:n", { x: 20, y: 196, fill: b.letters ? COLOR.ink : COLOR.muted, ...sans(SIZE.body) },
      b.letters ? `писем: ${b.letters}` : "пусто");
    if (alarm) pen.text("inbox:r", { x: 140, y: 196, fill: COLOR.error, ...sans(SIZE.body, 700) }, `повторов: ${b.repeats}`);
  }, lit(w, "inbox"));
}

/** График «самая старая задача ждёт N с». */
function chart(pen: Pen, w: World): void {
  const c = w.chart;
  const W = 560;
  const H = 120;
  pen.group("chart", 40, 310, () => {
    panel(pen, "chart:p", { x: 0, y: 0, w: W + 40, h: H + 50, fill: COLOR.bg2 });
    pen.text("chart:h", { x: 20, y: 28, fill: COLOR.muted, ...sans(SIZE.min, 500) }, "самая старая задача ждёт, с");
    const step = W / Math.max(c.points.length - 1, 1);
    const d = c.points.map((p, i) => `${i ? "L" : "M"} ${20 + i * step} ${40 + H - p * H}`).join(" ");
    pen.path("chart:line", { d, fill: "none", stroke: c.alert ? COLOR.error : COLOR.ok, "stroke-width": 3, class: "fx-draw" });
    if (c.alert) pill(pen, "chart:alert", "алерт", { x: W - 60, y: 40, fill: COLOR.error, color: COLOR.bg, size: SIZE.min });
  }, lit(w, "chart"));
}

/** Печати трюков: ЗАСЧИТАН / СОРВАН. */
function seals(pen: Pen, w: World): void {
  const x = 660;
  const y = w.stage.on ? 310 : 70;
  pen.group("seals", x, y, () => {
    const rows = w.seals.slice(-6);
    panel(pen, "seals:p", { x: 0, y: 0, w: 580, h: 30 + rows.length * 58, fill: COLOR.bg2 });
    rows.forEach((s, i) => {
      const last = i === rows.length - 1;
      const [key, fx] = once(`seals:r${i}`, w.frame, last && w.events.some((e) => e.kind === "seal") ? "fx-stamp" : null);
      pen.group(key, 16, 18 + i * 58, () => {
        pen.text(`${key}:n`, { x: 0, y: 20, fill: COLOR.ink, ...sans(SIZE.body, 700) }, s.name);
        pen.text(`${key}:d`, { x: 0, y: 44, fill: COLOR.muted, ...sans(SIZE.min, 400) }, s.note);
        pill(pen, `${key}:s`, s.ok ? "ЗАСЧИТАН" : "СОРВАН", {
          x: 400, y: 4, fill: s.ok ? COLOR.doneBg : COLOR.alarmBg, color: s.ok ? COLOR.ok : COLOR.error,
          stroke: s.ok ? COLOR.ok : COLOR.error, size: SIZE.min,
        });
      }, fx);
    });
  }, lit(w, "seals"));
}

/** Вставка настоящего артефакта: моноширинные строки в окне терминала. */
function art(pen: Pen, w: World): void {
  const a = w.art!;
  const left = w.seals.length && !w.stage.on ? 40 : 660;
  const font = mono(SIZE.min);
  const width = Math.max(560, ...a.lines.map((l) => pen.measure(l, font).width + 40));
  const x = Math.min(left, STAGE.w - 40 - width);
  pen.group(`art:fx${w.frame}`, x, w.stage.on ? 310 : 120, () => {
    panel(pen, "art:p", { x: 0, y: 0, w: width, h: 50 + a.lines.length * 28, fill: "#0a0d1a" });
    pen.text("art:h", { x: 20, y: 28, fill: COLOR.muted, ...sans(SIZE.min, 500) }, a.title);
    a.lines.forEach((l, i) => pen.text(`art:l${i}`, { x: 20, y: 60 + i * 28, fill: COLOR.ink, ...font }, l));
    if (w.needle) {
      // Иголка в водопаде: поток строк, нужной не видно.
      pen.rect("art:fall", { x: width - 120, y: 40, width: 90, height: 18 + a.lines.length * 28, rx: 8, fill: COLOR.mail, opacity: 0.25, class: "fx-slide" });
      pen.text("art:needle", { x: width - 75, y: 60 + a.lines.length * 14, "text-anchor": "middle", fill: COLOR.warn, ...sans(SIZE.min, 700) }, "игла?");
    }
  }, { class: "fx-pop", ...lit(w, "art") });
}

/** Съёмочная группа внизу: кто в кадре, реплики, поклоны. */
function crew(pen: Pen, w: World): void {
  for (const k of CREW) {
    const m = w.crew[k];
    if (!m.on) continue;
    const c = CAST[k];
    const mood: Mood = m.mood;
    pen.group(`crew:${k}`, c.x, CREW_Y, () => {
      bob(pen, `crew:${k}:b`, { x: 0, y: 0, color: c.color, tint: c.tint, letter: c.letter, mood, look: { x: 0, y: -0.5 } });
      pen.text(`crew:${k}:n`, { x: 32, y: 90, "text-anchor": "middle", fill: COLOR.muted, ...sans(SIZE.min, 500) }, c.name);
    }, lit(w, k), m.bow ? { rotate: 22, origin: [32, 64] } : undefined);
    if (m.say) {
      pen.layer("front", () =>
        bubble(pen, `say:${k}:${w.frame}`, m.say!, { x: c.x + 32, y: CREW_Y - 26, tail: "down", attrs: { class: "fx-pop" } }));
    }
  }
}

/** Счётчики появляются только в кадре, где меняются. */
function counters(pen: Pen, w: World): void {
  if (w.failsShown)
    pill(pen, `fails:${w.frame}`, `сорвано дублей: ${w.fails}`, { x: 40, y: 18, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, size: SIZE.min, attrs: { class: "fx-pop" } });
  if (w.tricks && w.events.some((e) => e.kind === "tricks"))
    pill(pen, `tricks:${w.frame}`, `трюков: ${w.tricks.honest} честных · ${w.tricks.fake} ложных`, { x: 860, y: 18, fill: COLOR.surface2, color: COLOR.ink, size: SIZE.min, attrs: { class: "fx-pop" } });
}

/** Хлопушка «Сцена N, дубль M». */
function clapper(pen: Pen, w: World): void {
  const c = w.clap!;
  pen.group(`clap:${w.frame}`, 440, 170, () => {
    pen.rect("clap:shadow", { x: 0, y: 8, width: 400, height: 240, rx: 12, fill: COLOR.shadow });
    pen.rect("clap:body", { x: 0, y: 40, width: 400, height: 200, rx: 12, fill: "#1a1a1a", stroke: COLOR.ink, "stroke-width": 3 });
    pen.group("clap:stick", 0, 0, () => {
      pen.rect("clap:bar", { x: 0, y: 0, width: 400, height: 40, rx: 6, fill: COLOR.ink });
      for (let i = 0; i < 6; i++) pen.path(`clap:z${i}`, { d: `M ${20 + i * 66} 0 L ${50 + i * 66} 0 L ${30 + i * 66} 40 L ${0 + i * 66} 40 Z`, fill: "#1a1a1a" });
    }, { class: "fx-stamp" }, { rotate: -8, origin: [0, 40] });
    pen.text("clap:s", { x: 30, y: 120, fill: COLOR.ink, ...mono(SIZE.title) }, `СЦЕНА  ${c.scene}`);
    pen.text("clap:t", { x: 30, y: 180, fill: COLOR.ink, ...mono(SIZE.title) }, `ДУБЛЬ  ${c.take}`);
  }, { class: "fx-pop" });
}

/** Красный штамп «СТОП!» и причина. */
function stopStamp(pen: Pen, w: World): void {
  pen.group(`stop:${w.frame}`, 640, 250, () => {
    // Подложка: штамп ложится поверх панелей и должен читаться на любом фоне.
    pen.rect("stop:under", { x: -210, y: -70, width: 420, height: 150, rx: 16, fill: COLOR.bg, opacity: 0.94 });
    pen.rect("stop:bg", { x: -200, y: -60, width: 400, height: 130, rx: 14, fill: "none", stroke: COLOR.error, "stroke-width": 8 });
    pen.text("stop:t", { x: 0, y: 10, "text-anchor": "middle", fill: COLOR.error, ...sans(SIZE.plate, 900) }, "СТОП!");
    pen.text("stop:r", { x: 0, y: 50, "text-anchor": "middle", fill: COLOR.error, ...sans(SIZE.accent, 700) }, w.stop!);
  }, { class: "fx-stamp" }, { rotate: -8 });
}

function titleCard(pen: Pen, w: World): void {
  const t = w.title!;
  pen.rect("title:bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg });
  pen.text("title:h", { x: STAGE.w / 2, y: 200, "text-anchor": "middle", fill: COLOR.muted, "letter-spacing": 6, ...sans(SIZE.title, 600) }, t.head.toUpperCase());
  pen.text("title:t", { x: STAGE.w / 2, y: 290, "text-anchor": "middle", fill: COLOR.ink, class: "fx-rise", ...sans(40, 700) }, t.text);
  pen.text("title:s", { x: STAGE.w / 2, y: 520, "text-anchor": "middle", fill: COLOR.warn, ...sans(SIZE.accent, 600) }, "Как мы снимали один сюжет");
}

function credits(pen: Pen, w: World): void {
  pen.group("credits", 340, 90, () => {
    panel(pen, "credits:p", { x: 0, y: 0, w: 600, h: 70 + w.credits!.length * 44, fill: COLOR.bg2 });
    pen.text("credits:h", { x: 300, y: 44, "text-anchor": "middle", fill: COLOR.muted, "letter-spacing": 4, ...sans(SIZE.body, 600) }, "ЗА КАДРОМ");
    w.credits!.forEach((l, i) => pen.text(`credits:l${i}`, { x: 300, y: 92 + i * 44, "text-anchor": "middle", fill: COLOR.ink, ...sans(SIZE.accent, 700) }, l));
  }, { class: "fx-rise" });
}
