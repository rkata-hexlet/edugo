import { STAGE, type Pen, type Span } from "../../engine/contract";
import { BOB, bob, elephant, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, meter, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { buildSteps as episode03 } from "../03-counter/script";
import { render as render03 } from "../03-counter/view";
import type { World as World03 } from "../03-counter/sim";
import {
  ACTORS, BOXES, HOT, REAL_BOXES, YEAR, daySum, estimate, hash, leadingZeros, light, reported, streamVid, truth, union,
  type Act, type Actor, type ActorId, type Focus, type Probe, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки и мысли — только из состояния кадра (Actor.acts).
// Сетка (1280×720): шапка; слева база — таблица попытки (link_stats / visitors / регистры link_uniques / календарь
// дней) и «лаборатория» visitor ID (хэш → регистр → нули); в центре поды с set или регистрами; справа браузеры
// («людей было») и табло. Ниже SAFE_BOTTOM — пусто.

const POD_Y: Record<ActorId, number> = { A: 128, B: 244, C: 360 };
const POD = { x: 640, w: 250, h: 64 };
const LEFT = { x: 40, w: 560 };
const TABLE = { y: 124, rowH: 38, gap: 5 };
const BROWSERS = { x: 984, y: 130, w: 256, h: 300 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };
const NX = BOB.w + 14; // левый край подписи пода
const TABLE_END = LEFT.x + 380;
/** Регистры крупно: шаг, ширина, высота ступени максимума. */
const BOX = { pitch: 34, w: 26, unit: 10 };

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const rowY = (i: number) => TABLE.y + i * (TABLE.rowH + TABLE.gap);
const podMid = (id: ActorId) => POD_Y[id] + POD.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const about = (w: World, id: Focus, all = true) => (w.focus ? w.focus.includes(id) : all);
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const did = (a: Actor, kind: Act["kind"]) => a.acts.some((x) => x.kind === kind);
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// --- База слева ---

/** Таблица из колонок: заголовки и строки текста; горячие ячейки — с эффектом. */
function grid(pen: Pen, w: World, key: string, cols: { title: string; w: number }[], rows: { cells: string[]; hot?: boolean; color?: string; fx?: string | null }[]): void {
  let x = LEFT.x;
  const xs = cols.map((c) => ((x += c.w), x - c.w));
  cols.forEach((c, i) => pen.text(`${key}:h${i}`, { x: xs[i] + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted }, c.title));
  rows.forEach((r, i) => {
    const [k, fx] = once(`${key}:r${i}`, w.frame, r.fx ?? null);
    pen.group(k, 0, rowY(i), () => {
      cols.forEach((c, j) => {
        pen.rect(`${k}:c${j}`, { x: xs[j], width: c.w, height: TABLE.rowH, fill: COLOR.surface, stroke: r.color ?? COLOR.line, "stroke-width": 1.5 });
        pen.text(`${k}:t${j}`, { x: xs[j] + 12, y: 25, ...MONO, fill: r.hot ? COLOR.ink : COLOR.muted, "font-weight": r.hot ? 700 : 400 }, r.cells[j]);
      });
    }, fx);
  });
}

/** Попытка «set на каждом поде»: link_stats с колонкой uniques; расходится с «людей было» — красным. */
function drawCounter(pen: Pen, w: World): void {
  const wrong = w.uniques > truth(w);
  pen.group("counter", 0, 0, () => {
    grid(pen, w, "ls", [{ title: "code", w: 110 }, { title: "clicks", w: 150 }, { title: "uniques", w: 120 }], [{
      cells: [HOT, thousands(w.clicks), String(w.uniques)], hot: true, color: wrong ? COLOR.error : undefined,
      fx: happened(w, "flush") ? "fx-pop" : null,
    }]);
    pen.text("ls:more", { x: LEFT.x + 12, y: rowY(1) + 24, ...SANS, fill: COLOR.faint }, "… ещё миллионы ссылок");
  }, fade(w, "row", "table"));
}

/** Попытка «общий список»: visitors(code, vid), count(*) и вес. */
function drawList(pen: Pen, w: World): void {
  const vids = w.visitors.slice(0, 3);
  pen.group("list", 0, 0, () => {
    grid(pen, w, "vis", [{ title: "code", w: 110 }, { title: "vid", w: 120 }], vids.map((v, i) => ({
      cells: [HOT, v], hot: true, fx: happened(w, "insert") && i === vids.length - 1 ? "fx-slide" : null,
    })));
    let y = rowY(vids.length) + 24;
    if (w.bulk) {
      const [k, fx] = once("vis:bulk", w.frame, happened(w, "grow") ? "fx-cascade" : null);
      pen.group(k, 0, 0, () => {
        for (let i = 0; i < 3; i++) pen.rect(`${k}:s${i}`, { x: LEFT.x, y: y - 16 + i * 14, width: 230, height: 8, rx: 4, fill: COLOR.line });
        pen.text(`${k}:t`, { x: LEFT.x, y: y + 56, ...SANS, "font-weight": 700, fill: COLOR.warn }, `… ещё ${thousands(w.bulk)} строк`);
      }, fx);
      y += 84;
    }
    pen.text("vis:count", { x: LEFT.x, y: y + 12, ...MONO, "font-weight": 700, fill: COLOR.ink }, [
      { text: "count(*) = ", attrs: { fill: COLOR.muted } }, { text: thousands(reported(w)) },
    ]);
    if (about(w, "weight", false)) {
      pen.text("vis:w", { x: LEFT.x, y: y + 52, ...SANS, fill: COLOR.muted }, "вес");
      meter(pen, "vis:m", { x: LEFT.x + 120, y: y + 40, w: 220, h: 12, load: light(w) ? 0.1 : 1.2 });
      pen.text("vis:mb", { x: LEFT.x + 360, y: y + 52, ...SANS, "font-weight": 700, fill: COLOR.error }, "сотни МБ");
    }
  }, fade(w, "list", "table"));
}

/** 16 регистров: столбик — максимум ведущих нулей; регистр из «лаборатории» подсвечен. top — верх области столбиков. */
function drawBoxes(pen: Pen, w: World, regs: number[], o: { y: number; unit: number; title: string }): void {
  const base = o.y + 15 * o.unit;
  const last = w.probes.at(-1);
  const hit = last?.box;
  const grew = happened(w, "reg") || happened(w, "merge") || happened(w, "flood");
  pen.group(`boxes:${w.scene}`, 0, 0, () => {
    if (happened(w, "flood")) pen.rect("boxes:all", { x: LEFT.x - 8, y: o.y - 8, width: BOXES * BOX.pitch + 8, height: 15 * o.unit + 16, rx: 8, fill: "none", stroke: COLOR.warn, "stroke-width": 2, "stroke-dasharray": "8 6", class: "fx-pop" });
    pen.text("boxes:title", { x: LEFT.x, y: o.y - 14, ...MONO, fill: COLOR.muted }, o.title);
    regs.forEach((r, i) => {
      const x = LEFT.x + i * BOX.pitch;
      const on = i === hit;
      pen.rect(`boxes:b${i}`, { x, y: o.y, width: BOX.w, height: 15 * o.unit, rx: 4, fill: "none", stroke: on ? COLOR.warn : COLOR.line, "stroke-width": on ? 2.5 : 1.5 });
      const zeros = Math.max(0, r - 1);
      const h = r ? Math.max(4, zeros * o.unit) : 0;
      const [k, fx] = once(`boxes:f${i}`, w.frame, grew && on && last?.changed ? "fx-rise" : null);
      if (r) pen.group(k, 0, 0, () => pen.rect(`${k}:r`, { x: x + 3, y: base - h, width: BOX.w - 6, height: h, rx: 3, fill: on ? COLOR.warn : COLOR.postgres }), fx);
      if (i % 5 === 0 || on) pen.text(`boxes:n${i}`, { x: x + BOX.w / 2, y: base + 24, ...MONO, fill: on ? COLOR.warn : COLOR.faint, "text-anchor": "middle" }, String(i));
    });
  }, fade(w, "boxes"));
}

/** Оценка по регистрам (и «настоящий» HLL рядом, когда посчитан). */
function drawEstimate(pen: Pen, w: World, regs: number[], y: number): void {
  if (!about(w, "estimate", false) && !w.real) return;
  pen.group("est", 0, 0, () => {
    const t = w.days ? null : truth(w);
    const off = (e: number) => (t ? ` (${e >= t ? "+" : "−"}${(Math.abs(e / t - 1) * 100).toFixed(e / t > 0.9 && e / t < 1.1 ? 1 : 0).replace(".", ",")} %)` : "");
    const e16 = estimate(regs);
    pen.text("est:16", { x: LEFT.x, y, ...MONO, "font-weight": 700, fill: COLOR.ink }, [
      { text: `${BOXES} регистров ≈ `, attrs: { fill: COLOR.muted } }, { text: thousands(e16) },
      ...(w.real && t ? [{ text: off(e16), attrs: { fill: COLOR.warn } }] : []),
    ]);
    if (w.real) pen.text("est:real", { x: LEFT.x, y: y + 32, ...MONO, "font-weight": 700, fill: COLOR.ok }, [
      { text: `${thousands(REAL_BOXES)} регистра ≈ `, attrs: { fill: COLOR.muted } }, { text: thousands(w.real) },
      ...(t ? [{ text: off(w.real), attrs: { fill: COLOR.ok } }] : []),
    ]);
    if (w.real && about(w, "weight", false)) {
      pen.text("est:w", { x: LEFT.x, y: y + 72, ...SANS, fill: COLOR.muted }, "вес");
      meter(pen, "est:m", { x: LEFT.x + 60, y: y + 60, w: 220, h: 12, load: 0.05 });
      pen.text("est:kb", { x: LEFT.x + 300, y: y + 72, ...SANS, "font-weight": 700, fill: COLOR.ok }, "~12 КБ");
    }
  }, fade(w, "estimate"));
}

/** «Лаборатория»: visitor ID → 32 бита; первые 4 — регистр, ведущие нули остатка — его максимум. */
function drawProbes(pen: Pen, w: World, y: number): void {
  w.probes.slice(-2).forEach((p, i) => drawProbe(pen, w, p, i, y + i * 76));
}

function drawProbe(pen: Pen, w: World, p: Probe, i: number, y: number): void {
  if (w.hashOnly) {
    // Кадр хэша: только visitor ID → строка нулей и единиц, без регистров и разметки.
    const [k, fx] = once(`probe${i}`, w.frame, "fx-slide");
    pen.group(k, 0, 0, () => pen.text(`${k}:bits`, { x: LEFT.x, y: 260, ...MONO, "font-size": SIZE.accent, fill: COLOR.ink }, [
      { text: `${p.vid} → `, attrs: { "font-weight": 700 } },
      { text: `${p.bits.slice(0, 16).replace(/(.{4})/g, "$1 ")}…`, attrs: { fill: COLOR.muted } }, // хвост — за краем: не влезает к подам
    ]), fx);
    return;
  }
  const head = p.bits.slice(0, 4);
  const rest = p.bits.slice(4);
  const zeros = rest.slice(0, p.zeros);
  const one = rest.slice(p.zeros, p.zeros + 1);
  const tail = rest.slice(p.zeros + 1, 12);
  const spans: Span[] = [
    ...(p.by ? [{ text: `Pod ${p.by} · `, attrs: { fill: ACTOR[p.by].color, "font-weight": 700 } }] : []),
    { text: `${p.vid} → `, attrs: { fill: COLOR.ink } },
    { text: head, attrs: { fill: COLOR.warn, "font-weight": 700 } },
    { text: " " },
    { text: zeros, attrs: { fill: COLOR.ok, "font-weight": 700 } },
    { text: one + tail + "…", attrs: { fill: COLOR.faint } },
  ];
  const [k, fx] = once(`probe${i}`, w.frame, "fx-slide");
  pen.group(k, 0, 0, () => {
    pen.text(`${k}:bits`, { x: LEFT.x, y, ...MONO }, spans);
    pen.text(`${k}:what`, { x: LEFT.x, y: y + 32, ...SANS, fill: COLOR.muted }, [
      { text: `регистр ${p.box}`, attrs: { fill: COLOR.warn, "font-weight": 700 } },
      { text: " · ведущих нулей: " },
      { text: String(p.zeros), attrs: { fill: COLOR.ok, "font-weight": 700 } },
      { text: p.changed ? " · новый максимум" : " · максимум тот же", attrs: { fill: p.changed ? COLOR.ok : COLOR.warn } },
    ]);
  }, { ...fx, ...fade(w, "probe") });
}

/** Доля хэшей с k ведущими нулями: каждый второй, четвёртый… тридцать второй. */
function drawOdds(pen: Pen, w: World): void {
  pen.group("odds", 0, 0, () => {
    pen.text("odds:title", { x: LEFT.x, y: 150, ...SANS, fill: COLOR.muted }, "хэш начинается с");
    for (let k = 1; k <= 5; k++) {
      const last = k === 5;
      pen.text(`odds:${k}`, { x: LEFT.x, y: 150 + k * 44, ...MONO, "font-size": SIZE.accent, "font-weight": 700, class: "fx-slide" }, [
        { text: "0".repeat(k).padEnd(7, " "), attrs: { fill: COLOR.ok } },
        { text: `у каждого ${2 ** k}-го`, attrs: { fill: last ? COLOR.warn : COLOR.ink } },
      ]);
    }
  }, fade(w, "probe"));
}

const times = (r: number) => (Math.round(r) === 2 ? "вдвое" : `в ${Math.round(r)} раза`);

/** Опыт без регистров: строки хэшей потока (ведущие нули подсвечены, рекордсмен в рамке) и шаги «прошло N → k → 2^k». */
function drawTrial(pen: Pen, w: World): void {
  pen.group("trial", 0, 0, () => {
    // Строки: первые значения потока и обладатель максимума каждого шага (в рамке) — у кого самая длинная серия нулей.
    // Без строк потока (шаг «промах») — только обладатели максимумов новых шагов кадра, о которых говорит голос.
    const holders = new Set((w.stream ? w.trials : w.trials.slice(-2)).map((t) => t.holder));
    const rows = [...new Set([...Array.from({ length: w.stream }, (_, i) => streamVid(i)), ...holders])];
    rows.forEach((vid, i) => {
      const bits = hash(vid).toString(2).padStart(32, "0");
      const z = leadingZeros(vid);
      const top = holders.has(vid);
      const y = 124 + i * 30;
      if (top) pen.rect(`trial:box${i}`, { x: LEFT.x - 8, y: y - 22, width: 400, height: 30, rx: 6, fill: "none", stroke: COLOR.ok, "stroke-width": 2, class: "fx-pop" });
      pen.text(`trial:r${i}`, { x: LEFT.x, y, ...MONO }, [
        { text: vid.padEnd(6, " "), attrs: { fill: top ? COLOR.ink : COLOR.muted, "font-weight": 700 } },
        { text: bits.slice(0, z), attrs: { fill: COLOR.warn, "font-weight": 700 } },
        { text: `${bits.slice(z, 20)}…`, attrs: { fill: COLOR.faint } },
      ]);
    });
    const y0 = 124 + Math.max(rows.length, 1) * 30 + 34;
    pen.text("trial:h", { x: LEFT.x, y: y0, ...SANS, fill: COLOR.muted }, "прошло   ·   максимум нулей   ·   оценка 2^k");
    w.trials.forEach((t, i) => {
      const est = 2 ** t.k;
      const r = est / t.n;
      // Промах — только когда голос о нём говорит (фокус «оценка»): в первом шаге опыта он отвлекал бы от роста.
      const note = !about(w, "estimate", false) ? "" : r >= 1.9 ? `${times(r)} больше` : r <= 0.55 ? `${times(1 / r)} меньше` : "";
      const [k, fx] = once(`trial:t${i}`, w.frame, "fx-slide");
      pen.group(k, 0, 0, () => pen.text(`${k}:t`, { x: LEFT.x, y: y0 + 36 + i * 34, ...MONO, "font-size": SIZE.accent, "font-weight": 700 }, [
        { text: thousands(t.n).padStart(5, " "), attrs: { fill: COLOR.ink } },
        { text: `   ${String(t.k).padStart(2, " ")}   `, attrs: { fill: COLOR.warn } },
        { text: thousands(est).padStart(5, " "), attrs: { fill: COLOR.ok } },
        { text: note ? `  ${note}` : "", attrs: { fill: COLOR.error, "font-size": SIZE.body } },
      ]), fx);
    });
  }, fade(w, "probe"));
}

/** Кейс 2: календарь — первые дни, «…», последний; на карточке число дня или полоска регистров. */
function drawDays(pen: Pen, w: World): void {
  const days = w.days!;
  const shown = [0, 1, 2, YEAR - 1];
  const boxed = w.mode === "hll";
  pen.group("days", 0, 0, () => {
    pen.text("days:title", { x: LEFT.x, y: 112, ...MONO, fill: COLOR.muted }, boxed ? "link_uniques · по дням" : "уникальные по дням");
    shown.forEach((d, i) => {
      const x = LEFT.x + i * 132 + (i === 3 ? 0 : 0);
      const day = days[d];
      pen.group(`day:${d}`, x, 124, () => {
        panel(pen, `day:${d}:box`, { x: 0, y: 0, w: 120, h: 86, rx: 10, shadow: false });
        pen.text(`day:${d}:l`, { x: 12, y: 26, ...SANS, fill: COLOR.muted }, day.label);
        if (boxed) day.regs.forEach((r, j) => pen.rect(`day:${d}:r${j}`, { x: 12 + j * 6, y: 74 - Math.max(2, (r - 1) * 4), width: 4, height: Math.max(2, (r - 1) * 4), fill: COLOR.postgres }));
        else pen.text(`day:${d}:n`, { x: 12, y: 66, ...MONO, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.ink }, String(day.uniques));
      });
      if (i === 2) pen.text("days:more", { x: x + 124, y: 174, ...SANS, "font-weight": 700, fill: COLOR.faint }, "…");
    });
    if (!boxed) {
      const sum = daySum(w);
      pen.text("days:sum", { x: LEFT.x, y: 256, ...MONO, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.error, ...(happened(w, "sum") ? { class: "fx-pop" } : {}) }, [
        { text: `${days[0].uniques} + ${days[1].uniques} + … = `, attrs: { fill: COLOR.muted } }, { text: thousands(sum) },
      ]);
      pen.text("days:anya", { x: LEFT.x, y: 292, ...SANS, "font-weight": 700, fill: COLOR.error }, "из них Аня — 365 раз");
      return;
    }
    if (w.periods.length) {
      w.periods.forEach((p, i) => pen.text(`per:${p.n}`, { x: LEFT.x, y: 256 + i * 34, ...MONO, "font-weight": 700, fill: COLOR.ink, class: "fx-slide" }, [
        { text: `${p.n === 7 ? "неделя" : p.n === 30 ? "30 дней" : "год"} ≈ `, attrs: { fill: COLOR.muted } }, { text: thousands(p.real) },
      ]));
      return;
    }
    if (w.period) {
      const regs = union(w, w.period);
      drawBoxes(pen, w, regs, { y: 250, unit: 8, title: `слияние ${w.period} дней` });
      drawEstimate(pen, w, regs, 420);
    }
  }, fade(w, "days"));
}

function drawBase(pen: Pen, w: World): void {
  if (w.days) return drawDays(pen, w);
  if (w.mode === "counter") return drawCounter(pen, w);
  if (w.mode === "list") return drawList(pen, w);
  if (w.odds) return drawOdds(pen, w);
  if (w.stream || w.trials.length) return drawTrial(pen, w);
  if (w.hashOnly) return drawProbes(pen, w, 0);
  drawBoxes(pen, w, w.regs, { y: 136, unit: BOX.unit, title: `link_uniques · ${HOT}` });
  drawEstimate(pen, w, w.regs, 380);
  drawProbes(pen, w, 450);
}

// --- Поды ---

function podMood(a: Actor): Mood {
  if (did(a, "new")) return "work";
  if (a.acts.length) return "work";
  return "idle";
}

function podLook(a: Actor): Look {
  if (did(a, "flush") || did(a, "insert")) return { x: -1, y: -0.4 };
  if (did(a, "reply") || did(a, "cookie")) return { x: 1, y: 0 };
  return { x: 0, y: 0 };
}

/** Мысль пода о клике: «Новая!» (нет в set), «Уже была» (есть). У HLL-пода мыслей нет — он не знает. */
function podThought(a: Actor): string | null {
  if (did(a, "new")) return "Новая!";
  if (did(a, "known")) return "Уже была";
  return null;
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood: podMood(a), look: podLook(a) });
    pen.text(`pod:${a.id}:label`, { x: NX, y: 24, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: color }, a.label);
    if (w.days) return;
    if (w.mode === "hll") {
      const fresh = did(a, "reg") || did(a, "flush");
      if (!fresh && !about(w, "jar", false)) return;
      const sent = a.acts.find((x): x is Extract<Act, { kind: "flush" }> => x.kind === "flush")?.regs;
      (sent ?? a.regs).forEach((r, j) => pen.rect(`pod:${a.id}:r${j}`, { x: NX + j * 9, y: 62 - Math.max(3, (r - 1) * 7), width: 7, height: Math.max(3, (r - 1) * 7), fill: r ? COLOR.warn : COLOR.line }));
      return;
    }
    // Set: что в нём сейчас, а в кадре сброса — что под в нём проверял (сброс его опустошил).
    const looked = a.acts.flatMap((x) => (x.kind === "new" || x.kind === "known" ? [x.vid] : []));
    const note = a.seen.length ? a.seen : looked;
    if (note.length || about(w, "jar", false)) {
      const text = note.length ? `set: ${[...new Set(note)].join(", ")}` : "set: пусто";
      pen.text(`pod:${a.id}:note`, { x: NX, y: 54, ...MONO, fill: note.length ? COLOR.ink : COLOR.faint }, text);
    }
  }, fade(w, a.id));
}

/** Стрелки пода: ответ браузеру, visitor ID браузеру, сброс в базу. */
function drawPodArrows(pen: Pen, w: World): void {
  for (const id of ACTORS) {
    const a = w.actors[id];
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const ins = a.acts.filter((x): x is Extract<Act, { kind: "insert" }> => x.kind === "insert");
    if (did(a, "flush") || ins.length) {
      const dup = ins.some((x) => x.dup);
      const to = { x: TABLE_END + 8, y: w.mode === "list" ? rowY(0) + 19 : w.mode === "hll" ? 220 : rowY(0) + 19 };
      pen.line(`arr:${id}:db`, { x1: POD.x - 6, y1: podMid(id) - 8, x2: to.x, y2: to.y, stroke: dup ? COLOR.error : color, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow", opacity: op, ...DRAW });
      const mid = { x: (POD.x + to.x) / 2 - 40, y: (podMid(id) + to.y) / 2 - 30 };
      const fl = a.acts.find((x): x is Extract<Act, { kind: "flush" }> => x.kind === "flush");
      const label = w.mode === "counter" ? `+${fl?.n ?? 0}`
        : w.mode === "list" ? (dup ? "уже есть" : ins.map((x) => x.vid).join(", ")) : "регистры";
      pill(pen, `arr:${id}:pill`, label, { x: mid.x, y: mid.y, fill: COLOR.surface2, color: dup ? COLOR.error : COLOR.ink, stroke: dup ? COLOR.error : color, mono: true, attrs: { class: "fx-pop", opacity: op } });
    }
    const ck = a.acts.find((x): x is Extract<Act, { kind: "cookie" }> => x.kind === "cookie");
    if (did(a, "reply") || ck) {
      pen.line(`arr:br:${id}`, {
        x1: POD.x + 200, y1: POD_Y[id] + 30, x2: BROWSERS.x - 6, y2: BROWSERS.y + 80,
        stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", marker: "arrow", ...DRAW, ...fade(w, "browsers", id),
      });
      if (ck) pill(pen, `arr:${id}:cookie`, `Set-Cookie: vid=${ck.vid}`, { x: POD.x + 110, y: POD_Y[id] - 52, fill: COLOR.surface2, color: COLOR.warn, stroke: COLOR.warn, mono: true, attrs: { class: "fx-pop" } });
    }
  }
}

// --- Браузеры справа ---

function drawBrowsers(pen: Pen, w: World): void {
  const t = truth(w);
  const shown = w.days ? null : w.mode === "counter" ? w.uniques : null;
  const alarm = shown !== null && shown > t;
  pen.group("br", 0, 0, () => {
    const B = BROWSERS;
    panel(pen, "br:box", { x: B.x, y: B.y, w: B.w, h: B.h, fill: alarm ? COLOR.alarmBg : COLOR.surface, stroke: alarm ? COLOR.error : COLOR.browser });
    iconText(pen, "br:title", "browser", B.x + 16, B.y + 38, "Браузеры", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    if (w.days) {
      pen.text("br:year", { x: B.x + 16, y: B.y + 80, ...SANS, fill: COLOR.muted }, "Аня — каждый день");
      pen.text("br:reg", { x: B.x + 16, y: B.y + 110, ...SANS, fill: COLOR.muted }, `и ещё ${thousands(t - 1)} читателей`);
    } else {
      w.browsers.forEach((b, i) => {
        const y = B.y + 78 + i * 34;
        pen.text(`br:b${i}`, { x: B.x + 16, y, ...SANS, "font-weight": 700, fill: COLOR.ink }, b.name);
        if (b.vid) pill(pen, `br:v${i}`, b.vid, { x: B.x + 104, y: y - 22, fill: COLOR.surface2, color: COLOR.warn, stroke: COLOR.line, mono: true });
        if (b.clicks) pen.text(`br:c${i}`, { x: B.x + 196, y, ...MONO, fill: COLOR.muted }, `×${b.clicks}`);
      });
      if (w.crowd) pen.text("br:crowd", { x: B.x + 16, y: B.y + 78 + w.browsers.length * 34, ...SANS, "font-weight": 700, fill: COLOR.muted }, `+ ${thousands(w.crowd)} человек`);
    }
    pen.rect("br:rule", { x: B.x + 16, y: B.y + 214, width: B.w - 32, height: 1.5, fill: COLOR.line });
    pen.text("br:was", { x: B.x + 16, y: B.y + 244, ...SANS, fill: COLOR.muted }, "людей было");
    const [nk, nfx] = once("br:n", w.frame, happened(w, "click") || happened(w, "flood") ? "fx-pop" : null);
    pen.group(nk, 0, 0, () => pen.text(`${nk}:t`, { x: B.x + 16, y: B.y + 280, "font-family": FONT.mono, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.ink }, thousands(t)), nfx);
  }, fade(w, "browsers"));
}

function drawHeader(pen: Pen, w: World): void {
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "flush") || happened(w, "insert") || happened(w, "merge") ? "fx-nod" : null);
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: LEFT.x + 4, y: 8, talking: !!w.db, scale: 1.08 }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!about(w, "clock", false) && !happened(w, "clock")) return;
  const [clockKey, clockFx] = once("clock", w.frame, happened(w, "clock") ? "fx-pulse" : null);
  pen.group(clockKey, 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, `0:${String(w.clock).padStart(2, "0")}`);
  }, { ...fade(w, "clock"), ...clockFx });
}

let steps03: { voice: string; state: World03 }[] | null = null;

/** Кадр эпизода 03 по началу его закадра — отсылка назад сценой. */
export function flashbackState(voice: string): World03 {
  steps03 ??= episode03().map((s) => ({ voice: s.narration ?? "", state: s.state }));
  const hit = steps03.find((s) => s.voice.startsWith(voice));
  if (!hit) throw new Error(`в эпизоде 03 нет кадра «${voice}…»`);
  return hit.state;
}

export function render(pen: Pen, w: World): void {
  if (w.flashback) {
    // Только копилки и сброс: нагрузка, журнал прибавок и SQL эпизода 03 здесь шум (learning-designer).
    render03(pen, { ...flashbackState(w.flashback.voice), board: null, term: null, chapter: null, db: null, sql: [], adds: [], focus: ["A", "B", "C", "row", "jar"] });
    pen.layer("top", () => stamp(pen, "⟲ Ролик про счётчик кликов", { left: DB.x + DB.w + 12, right: POD.x - 12 }));
    return;
  }
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawBase(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  // В объяснении HLL табло ждёт за кадром, пока голос не вернётся к критериям (learning-designer).
  const boardAway = w.mode === "hll" && !w.days && !about(w, "board");
  if (w.board && !boardAway) board(pen, w.board, { ...BOARD, lampX: [258, 416], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: LEFT.x, bottom: BOTTOM, attrs: fade(w, "sql") });
  drawPodArrows(pen, w);
  drawBrowsers(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: POD.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
    for (const id of ACTORS) {
      const t = podThought(w.actors[id]);
      if (t) bubble(pen, `think:${id}`, t, { x: POD.x + 140, y: POD_Y[id] + 10, tail: "left", thought: true, attrs: { class: "fx-pop", ...fade(w, id) } });
    }
  });
}
