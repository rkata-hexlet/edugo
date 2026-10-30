import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, meter, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { buildSteps as episode01 } from "../01-skip-locked/script";
import { render as render01 } from "../01-skip-locked/view";
import type { World as World01 } from "../01-skip-locked/sim";
import {
  ACTORS, HOT, OTHERS, POOL, SHARDS, contended, dbLoad, doubled, lost, pending,
  type Act, type Actor, type ActorId, type Focus, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра (Actor.acts).
// Сетка (1280×720): шапка; слева таблица link_stats, очередь к горячей строке, нагрузка на запись, журналы прибавок и
// сбросов; в центре поды с пулом соединений и копилкой; справа браузеры («кликов было») и табло. Ниже SAFE_BOTTOM — пусто.

const POD_Y: Record<ActorId, number> = { A: 128, B: 244, C: 360 };
const POD = { x: 640, w: 250, h: 64 };
const TABLE = { x: 40, y: 124, rowH: 38, gap: 5 };
const COLS = [
  { title: "code", x: 0, w: 110 },
  { title: "clicks", x: 110, w: 150 },
];
const TABLE_END = TABLE.x + 260;
const QUEUE = { x: TABLE_END + 40, step: 28, n: 8 };
const LOAD = { y: 306 };
const ADDS = { x: 40, y: 330, w: 250, h: 140 };
const FLUSHES = { x: 310, y: 330, w: 250, h: 140 };
const BROWSERS = { x: 984, y: 130, w: 256, h: 300 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };
const NX = BOB.w + 14; // левый край подписи пода
const JAR_X = NX + 104; // копилка или фоновые прибавки — правее пула

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const rowY = (i: number) => TABLE.y + i * (TABLE.rowH + TABLE.gap);
const rowMid = (i: number) => rowY(i) + TABLE.rowH / 2;
const podMid = (id: ActorId) => POD_Y[id] + POD.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
/** Элемент живёт только в кадрах, где о нём говорят: явный фокус (или кадр без фокуса — всё на виду). */
const about = (w: World, id: Focus, all = true) => (w.focus ? w.focus.includes(id) : all);
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const did = (a: Actor, kind: Act["kind"]) => a.acts.some((x) => x.kind === kind);
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const jammed = (w: World) => ACTORS.some((id) => w.actors[id].waiting >= POOL);

function drawTable(pen: Pen, w: World): void {
  if (w.rows[0].shards) drawShardTable(pen, w);
  else {
    COLS.forEach((col, i) =>
      pen.text(`hdr:${i}`, { x: TABLE.x + col.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "table") }, col.title));
    pen.group(`rows:${w.scene}`, 0, 0, () => {
      w.rows.forEach((r, i) => {
        const hot = i === 0;
        const added = hot && w.events.some((e) => e.kind === "commit" || e.kind === "dup");
        pen.group(`row:${i}`, TABLE.x, rowY(i), () => {
          COLS.forEach((col, c) => pen.rect(`row:${i}:c${c}`, {
            x: col.x, width: col.w, height: TABLE.rowH, fill: COLOR.surface, stroke: hot && c === 1 && happened(w, "dup") ? COLOR.error : COLOR.line, "stroke-width": 1.5,
          }));
          pen.text(`row:${i}:code`, { x: 12, y: 25, ...MONO, fill: hot ? COLOR.ink : COLOR.muted, "font-weight": hot ? 700 : 400 }, r.code);
        if (hot && about(w, "lock", false)) icon(pen, `row:${i}:lock`, "lock", COLS[1].x + COLS[1].w + 10, 7, 24, COLOR.warn, { class: "fx-pop" });
          const [vk, vfx] = once(`row:${i}:n`, w.frame, added ? "fx-pop" : null);
          pen.group(vk, 0, 0, () => pen.text(`${vk}:t`, { x: COLS[1].x + 12, y: 25, ...MONO, fill: hot ? COLOR.ink : COLOR.muted, "font-weight": hot ? 700 : 400 },
            thousands(r.clicks)), vfx);
        }, fade(w, "table", ...(hot ? ["row" as Focus] : [])));
      });
      pen.text("rows:more", { x: TABLE.x + 12, y: rowY(3) + 18, ...SANS, fill: COLOR.faint, ...fade(w, "table") }, "… ещё миллионы ссылок");
    }, happened(w, "page") ? { class: "fx-cascade" } : {});
  }
  drawQueue(pen, w);
  // Нагрузка базы: полоса с потолком, без чисел (tech-expert).
  if (!about(w, "load", false) && !w.replay) return; // в итоге полоса показывает прогресс попыток
  const y = w.rows[0].shards ? SHARD_SUM_Y + 44 : LOAD.y; // под суммой разложенного счётчика
  pen.group("dbload", 0, 0, () => {
    pen.text("dbload:t", { x: TABLE.x, y: y + 6, ...SANS, fill: COLOR.muted }, "нагрузка на запись");
    meter(pen, "dbload:m", { x: TABLE.x + 180, y: y - 6, w: 200, h: 12, load: dbLoad(w) });
  }, fade(w, "load", "table"));
}

/** Видимые строки разложенного счётчика: первые три и последняя, между ними — «… ещё 12 строк». */
const SHOWN = [0, 1, 2, 15];
const SHARD_COLS = [
  { title: "code", x: 0, w: 110 },
  { title: "part", x: 110, w: 80 },
  { title: "clicks", x: 190, w: 140 },
];
const SHARD_ROW_Y = [rowY(0), rowY(1), rowY(2), rowY(3) + 34];
const SHARD_MORE_Y = rowY(3) + 20;
const SHARD_SUM_Y = SHARD_ROW_Y[3] + TABLE.rowH + 30;

/** Куда стрелка пода упирается в разложенный счётчик: в свою строку или в «… ещё 12 строк». */
function shardTarget(shard: number): { x: number; y: number } {
  const i = SHOWN.indexOf(shard);
  return { x: TABLE.x + 338, y: i >= 0 ? SHARD_ROW_Y[i] + TABLE.rowH / 2 : SHARD_MORE_Y - 6 };
}

/** Sharded counter: та же ссылка — шестнадцать строк с номером shard; строка, куда попала прибавка, подсвечена;
 *  под таблицей — сумма, это и есть счётчик. */
function drawShardTable(pen: Pen, w: World): void {
  const shards = w.rows[0].shards!;
  const hit = new Set(ACTORS.flatMap((id) => w.actors[id].acts.flatMap((a) => (a.kind === "add" && a.shard !== undefined ? [a.shard] : []))));
  SHARD_COLS.forEach((col, i) =>
    pen.text(`shdr:${i}`, { x: TABLE.x + col.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "table") }, col.title));
  pen.group(`shards:${w.scene}`, 0, 0, () => {
    SHOWN.forEach((shard, i) => {
      const lit_ = hit.has(shard);
      pen.group(`shard:${shard}`, TABLE.x, SHARD_ROW_Y[i], () => {
        SHARD_COLS.forEach((col, c) => pen.rect(`shard:${shard}:c${c}`, {
          x: col.x, width: col.w, height: TABLE.rowH, fill: lit_ ? COLOR.doneBg : COLOR.surface, stroke: lit_ ? COLOR.ok : COLOR.line, "stroke-width": 1.5,
        }));
        pen.text(`shard:${shard}:code`, { x: 12, y: 25, ...MONO, fill: COLOR.ink, "font-weight": 700 }, HOT);
        if (lit_ && about(w, "lock", false)) icon(pen, `shard:${shard}:lock`, "lock", SHARD_COLS[2].x + SHARD_COLS[2].w - 34, 7, 24, COLOR.warn, { class: "fx-pop" });
        pen.text(`shard:${shard}:no`, { x: SHARD_COLS[1].x + 12, y: 25, ...MONO, fill: COLOR.ink }, String(shard));
        const [vk, vfx] = once(`shard:${shard}:n`, w.frame, lit_ ? "fx-pop" : null);
        pen.group(vk, 0, 0, () => pen.text(`${vk}:t`, { x: SHARD_COLS[2].x + 12, y: 25, ...MONO, fill: COLOR.ink }, thousands(shards[shard])), vfx);
      });
    });
    const hidden = [...hit].some((x) => !SHOWN.includes(x));
    pen.text("shards:more", { x: TABLE.x + 12, y: SHARD_MORE_Y, ...SANS, fill: hidden ? COLOR.ok : COLOR.faint, "font-weight": hidden ? 700 : 400 },
      `… ещё ${SHARDS - SHOWN.length} частей счётчика ${HOT}`);
    const [sk, sfx] = once("shards:sum", w.frame, hit.size ? "fx-pop" : null);
    pen.group(sk, 0, 0, () => pen.text(`${sk}:t`, { x: TABLE.x + 12, y: SHARD_SUM_Y, ...MONO, "font-weight": 700, fill: COLOR.ink }, [
      { text: `всего кликов ${HOT}: `, attrs: { fill: COLOR.muted } },
      { text: thousands(w.rows[0].clicks) },
    ]), sfx);
  }, { ...fade(w, "row", "table"), ...(happened(w, "rewind") ? { class: "fx-cascade" } : {}) });
}

/** Очередь к горячей строке: замок и ждущие запросы цветом своих подов; «…» — их тысячи. */
function drawQueue(pen: Pen, w: World): void {
  const waiters = ACTORS.filter((id) => w.actors[id].waiting > 0 && w.actors[id].present);
  if (!waiters.length || w.rows[0].shards) return;
  const crowd = contended(w);
  const y = rowY(0) + 6;
  pen.group("queue", 0, 0, () => {
    icon(pen, "queue:lock", "lock", TABLE_END + 8, y, 24, crowd ? COLOR.warn : ACTOR.A.color);
    const n = crowd ? QUEUE.n : waiters.length;
    for (let i = 0; i < n; i++) {
      const id = crowd ? ACTORS[i % 3] : waiters[i];
      pen.rect(`queue:${i}`, { x: QUEUE.x + i * QUEUE.step, y: y + 1, width: 22, height: 22, rx: 8, fill: ACTOR[id].tint, stroke: ACTOR[id].color, "stroke-width": 1.5 });
    }
    if (crowd) pen.text("queue:more", { x: QUEUE.x + n * QUEUE.step + 2, y: y + 19, ...SANS, "font-weight": 700, fill: COLOR.warn }, "…");
  }, { ...fade(w, "queue", "row"), ...(happened(w, "flood") ? { class: "fx-slide" } : {}) });
}

/** Журнал прибавок: последние закоммиченные прибавки; повтор батча — красным. */
function drawAdds(pen: Pen, w: World): void {
  if (!w.adds.length || !about(w, "adds", false) && !w.adds.some((a) => a.n > 1)) return;
  pen.group("adds", 0, 0, () => {
    panel(pen, "adds:box", { x: ADDS.x, y: ADDS.y, w: ADDS.w, h: ADDS.h, fill: happened(w, "dup") ? COLOR.alarmBg : COLOR.surface, stroke: happened(w, "dup") ? COLOR.error : COLOR.line });
    pen.text("adds:title", { x: ADDS.x + 16, y: ADDS.y + 28, ...SANS, "font-weight": 700, fill: COLOR.muted }, "прибавки в строку");
    w.adds.forEach((a, i) => {
      const y = ADDS.y + 64 + i * 30;
      const fresh = i >= w.adds.length - w.events.filter((e) => e.kind === "commit" || e.kind === "dup").length;
      pen.group(`adds:l:${i}:${a.n}:${a.dup}`, 0, 0, () => {
        pen.text(`adds:l${i}:n`, { x: ADDS.x + 16, y, ...MONO, "font-weight": 700, fill: a.dup ? COLOR.error : COLOR.ink }, `+${thousands(a.n)}`);
        pen.text(`adds:l${i}:by`, { x: ADDS.x + 120, y, ...SANS, fill: a.dup ? COLOR.error : ACTOR[a.by].color }, a.dup ? `${a.by} · повтор` : a.key ?? a.by);
      }, fresh && w.events.length ? { class: "fx-slide" } : {});
    });
  }, fade(w, "adds"));
}

/** Журнал сбросов flushes: номера учтённых батчей. */
function drawFlushes(pen: Pen, w: World): void {
  if (!w.keyed) return;
  const skipped = happened(w, "skip");
  pen.group("fl", 0, 0, () => {
    panel(pen, "fl:box", { x: FLUSHES.x, y: FLUSHES.y, w: FLUSHES.w, h: FLUSHES.h, stroke: skipped ? COLOR.ok : COLOR.postgres });
    pen.text("fl:title", { x: FLUSHES.x + 16, y: FLUSHES.y + 28, ...MONO, "font-weight": 700, fill: COLOR.muted }, "flushes");
    if (!w.flushes.length) pen.text("fl:empty", { x: FLUSHES.x + 16, y: FLUSHES.y + 64, ...SANS, fill: COLOR.faint }, "пусто");
    w.flushes.slice(-3).forEach((k, i) => {
      const [key, fx] = once(`fl:l${i}`, w.frame, skipped ? "fx-pulse" : happened(w, "commit") ? "fx-slide" : null);
      pen.group(key, 0, 0, () => {
        pen.text(`${key}:t`, { x: FLUSHES.x + 16, y: FLUSHES.y + 64 + i * 30, ...MONO, "font-weight": 700, fill: COLOR.ink }, k);
        if (skipped) iconText(pen, `${key}:ok`, "check", FLUSHES.x + 110, FLUSHES.y + 64 + i * 30, "уже было", COLOR.ok);
      }, fx);
    });
  }, fade(w, "flushes"));
}

function podMood(a: Actor): Mood {
  if (!a.present) return "frozen";
  if (a.waiting > 0 || a.unsure) return "wait";
  if (a.acts.length || a.draining) return "work";
  return "idle";
}

function podLook(a: Actor): Look {
  if (did(a, "flush") || did(a, "add")) return { x: -1, y: -0.4 };
  if (did(a, "reply")) return { x: 1, y: 0 };
  return { x: 0, y: 0 };
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const gone = !a.present;
  const goneNow = gone && (happened(w, "kill", a.id) || happened(w, "deploy", a.id));
  const spawned = happened(w, "spawn", a.id);
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxAttrs] = once(`pod:${a.id}:fx`, w.frame, goneNow ? "fx-fade" : spawned ? "fx-pop" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood: podMood(a), look: podLook(a), ghost: gone, dashed: a.waiting > 0 }), fxAttrs);
    const label = podLabel(w, a);
    pen.text(`pod:${a.id}:label`, { x: NX, y: 24, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: gone ? COLOR.muted : color }, label);
    if (a.unsure) icon(pen, `pod:${a.id}:q`, "question", 20, -44, 26, COLOR.warn, { class: "fx-pop" });
    if (gone) {
      if (happened(w, "spill", a.id)) pen.text(`pod:${a.id}:spill`, { x: NX, y: 56, ...MONO, fill: COLOR.error, class: "fx-shake" }, `−${thousands(w.events.find((e) => e.kind === "spill" && e.by === a.id)!.n!)}`);
      return;
    }
    drawPool(pen, w, a);
    drawJar(pen, w, a);
    const burnt = w.events.find((e) => e.kind === "spill" && e.by === a.id);
    if (burnt) pen.text(`pod:${a.id}:burnt`, { x: JAR_X, y: 52, ...MONO, fill: COLOR.error, class: "fx-shake" }, `−${thousands(burnt.n!)}`);
  }, fade(w, a.id));
}

function podLabel(w: World, a: Actor): string {
  return !a.present ? `${a.label} · погас` : happened(w, "restart", a.id) ? `${a.label} · рестарт` : a.draining ? `${a.label} · SIGTERM` : happened(w, "spawn", a.id) ? `${a.label} · новый` : a.label;
}

/** Правый край того, что нарисовано у пода (подпись, пул, копилка или фон): отсюда стрелка ответа браузерам. */
function podRight(pen: Pen, w: World, a: Actor): number {
  const label = pen.measure(podLabel(w, a), { ...SANS, "font-size": SIZE.say, "font-weight": 700 }).width;
  let right = NX + label;
  if (about(w, "pool", false) || jammed(w)) right = Math.max(right, NX + POOL * 24);
  if (poolNamed(w, a)) right = Math.max(right, JAR_X + pen.measure("соединения", SANS).width);
  if (a.background > 0) right = Math.max(right, JAR_X + pen.measure(`в фоне ${thousands(a.background)}`, MONO).width);
  else if (w.mode === "batch") right = Math.max(right, JAR_X + 40 + pen.measure(a.jar ? thousands(a.jar) : "0", { ...MONO, "font-weight": 700 }).width);
  return POD.x + right;
}

/** Подпись пула — один раз, у пода A, когда голос говорит о соединениях и справа от пула пусто. */
const poolNamed = (w: World, a: Actor) => a.id === "A" && about(w, "pool", false) && w.mode === "direct" && !a.background;

/** Пул соединений: четыре слота; занятый ждущим — жёлтый. Виден, когда о нём речь или он забит. */
function drawPool(pen: Pen, w: World, a: Actor): void {
  if (!about(w, "pool", false) && !jammed(w)) return;
  for (let i = 0; i < POOL; i++) {
    const busy = i < a.waiting;
    pen.rect(`pod:${a.id}:slot${i}`, {
      x: NX + i * 24, y: 36, width: 20, height: 20, rx: 5,
      fill: busy ? COLOR.draftBg : "none", stroke: busy ? COLOR.warn : COLOR.faint, "stroke-width": 1.5,
    });
  }
  if (poolNamed(w, a)) pen.text(`pod:${a.id}:pool:t`, { x: JAR_X, y: 52, ...SANS, fill: COLOR.warn }, "соединения");
}

/** Копилка батча (или фоновые прибавки): сколько накоплено и номер батча. */
function drawJar(pen: Pen, w: World, a: Actor): void {
  const x = JAR_X;
  if (a.background > 0) {
    pen.text(`pod:${a.id}:bg`, { x, y: 52, ...MONO, fill: COLOR.warn }, `в фоне ${thousands(a.background)}`);
    return;
  }
  if (w.mode !== "batch") return;
  const full = Math.min(1, a.jar / 9_000);
  pen.group(`pod:${a.id}:jar`, 0, 0, () => {
    pen.rect(`pod:${a.id}:jar:b`, { x, y: 30, width: 30, height: 30, rx: 6, fill: "none", stroke: COLOR.ink, "stroke-width": 2 });
    if (full > 0) pen.rect(`pod:${a.id}:jar:f`, { x: x + 3, y: 30 + 27 - 24 * full, width: 24, height: Math.max(3, 24 * full), rx: 3, fill: COLOR.warn });
    pen.text(`pod:${a.id}:jar:n`, { x: x + 40, y: 52, ...MONO, "font-weight": 700, fill: a.jar ? COLOR.ink : COLOR.faint }, a.jar ? thousands(a.jar) : "0");
    if (w.keyed && a.jar) pen.text(`pod:${a.id}:key`, { x: x + 40, y: 82, ...MONO, fill: COLOR.muted }, `№ ${a.id} · ${a.seq}`);
  }, fade(w, a.id, "jar"));
}

/** Стрелки пода: к горячей строке (или шарду), сброс батча, оборванный ответ, ответы браузерам. */
function drawPodArrows(pen: Pen, w: World): void {
  for (const id of ACTORS) {
    const a = w.actors[id];
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const from = { x: POD.x - 6, y: podMid(id) };
    const add = a.acts.find((x): x is Extract<Act, { kind: "add" }> => x.kind === "add");
    const fl = a.acts.find((x): x is Extract<Act, { kind: "flush" }> => x.kind === "flush");
    const shardTo = add?.shard !== undefined ? shardTarget(add.shard) : null;
    const to = shardTo ?? { x: TABLE_END + 8, y: rowMid(0) };
    if (add || fl || a.waiting > 0) {
      const waits = a.waiting > 0 && !fl;
      pen.line(`arr:${id}:row`, {
        x1: from.x, y1: from.y - 8, x2: waits && !w.rows[0].shards ? QUEUE.x + QUEUE.n * QUEUE.step + 24 : to.x, y2: waits && !w.rows[0].shards ? rowMid(0) + 4 : to.y,
        stroke: waits ? COLOR.warn : color, "stroke-width": fl ? 5 : 3, "stroke-linecap": "round", marker: "arrow", opacity: op,
        ...(waits ? { "stroke-dasharray": "7 6" } : DRAW),
      });
    }
    if (fl) {
      const mid = { x: (from.x + to.x) / 2, y: (from.y - 8 + to.y) / 2 };
      pill(pen, `arr:${id}:batch`, `+${thousands(fl.n)}`, { x: mid.x - 50, y: mid.y - 36, fill: COLOR.surface2, color: COLOR.ink, stroke: color, mono: true, attrs: { class: "fx-pop", opacity: op } });
    }
    if (did(a, "lost")) {
      // Ответ базы: возвращается к поду и обрывается на полпути.
      const back = { x1: TABLE_END + 16, y1: rowMid(0) + 14, x2: (TABLE_END + POD.x) / 2, y2: (rowMid(0) + podMid(id)) / 2 + 20 };
      pen.line(`arr:${id}:lost`, { ...back, stroke: COLOR.error, "stroke-width": 2.5, "stroke-dasharray": "6 5", "stroke-linecap": "round", opacity: op, ...DRAW });
      icon(pen, `arr:${id}:lost:x`, "cross", back.x2 - 4, back.y2 - 8, 24, COLOR.error, { opacity: op });
    }
  }
}

/** Браузеры: сколько кликов было (внешний мир) и чего нет в счёте; клики соседних ссылок, ждущие соединения. */
function drawBrowsers(pen: Pen, w: World): void {
  drawBrowserArrows(pen, w);
  const miss = lost(w);
  const extra = doubled(w);
  const alarm = miss > 0 || extra > 0;
  const [k, fx] = once("br", w.frame, (miss > 0 && (happened(w, "restart") || happened(w, "spill"))) || happened(w, "dup") ? "fx-shake" : null);
  pen.group(k, 0, 0, () => {
    const B = BROWSERS;
    panel(pen, "br:box", { x: B.x, y: B.y, w: B.w, h: B.h, fill: alarm ? COLOR.alarmBg : COLOR.surface, stroke: alarm ? COLOR.error : COLOR.browser });
    iconText(pen, "br:title", "browser", B.x + 16, B.y + 38, "Браузеры", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    if (w.flow > 0) iconText(pen, "br:flow", "flame", B.x + 16, B.y + 72, `${thousands(w.flow)} кликов/с`, COLOR.warn);
    pen.rect("br:rule", { x: B.x + 16, y: B.y + 84, width: B.w - 32, height: 1.5, fill: COLOR.line });
    pen.text("br:was", { x: B.x + 16, y: B.y + 114, ...SANS, fill: COLOR.muted }, "кликов было");
    const [nk, nfx] = once("br:n", w.frame, happened(w, "click") ? "fx-pop" : null);
    pen.group(nk, 0, 0, () => pen.text(`${nk}:t`, { x: B.x + 16, y: B.y + 146, "font-family": FONT.mono, "font-size": SIZE.title, "font-weight": 700, fill: COLOR.ink }, thousands(w.clicked)), nfx);
    const delta = miss > 0 ? { t: `нет в счёте: ${thousands(miss)}`, c: COLOR.error }
      : extra > 0 ? { t: `лишних в счёте: ${thousands(extra)}`, c: COLOR.error }
        : pending(w) > 0 && w.mode === "batch" && (w.chapter === 2 || about(w, "lag", false)) ? { t: `ещё в подах: ${thousands(pending(w))}`, c: COLOR.warn } : null;
    if (delta) pen.text("br:delta", { x: B.x + 16, y: B.y + 180, ...SANS, "font-weight": 700, fill: delta.c, class: "fx-slide" }, delta.t);
    if (w.starved > 0) OTHERS.forEach((code, i) =>
      iconText(pen, `br:o${i}`, "hourglass", B.x + 16, B.y + 226 + i * 30, `${code} ждёт`, COLOR.warn, MONO));
  }, { ...fade(w, "browsers"), ...fx });
}

function drawBrowserArrows(pen: Pen, w: World): void {
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (!did(a, "reply")) continue;
    pen.line(`arr:br:${id}`, {
      x1: podRight(pen, w, a) + 14, y1: POD_Y[id] + 30, x2: BROWSERS.x - 6, y2: BROWSERS.y + 140,
      stroke: ACTOR[id].color, "stroke-width": 2.5, "stroke-linecap": "round", marker: "arrow", ...DRAW, ...fade(w, "browsers", id),
    });
  }
}

function drawHeader(pen: Pen, w: World): void {
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "commit") || happened(w, "skip") ? "fx-nod" : null);
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08 }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: dbLoad(w) > 1 ? COLOR.error : COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!about(w, "clock", false) && !happened(w, "clock")) return;
  const [clockKey, clockFx] = once("clock", w.frame, happened(w, "clock") ? "fx-pulse" : null);
  pen.group(clockKey, 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, `0:${String(w.clock).padStart(2, "0")}`);
  }, { ...fade(w, "clock"), ...clockFx });
}

let steps01: { voice: string; state: World01 }[] | null = null;

/** Кадр эпизода 01 по началу его закадра — отсылка назад сценой, а не «смотрите прошлый ролик». */
export function flashbackState(voice: string): World01 {
  steps01 ??= episode01().map((s) => ({ voice: s.narration ?? "", state: s.state }));
  const hit = steps01.find((s) => s.voice.startsWith(voice));
  if (!hit) throw new Error(`в эпизоде 01 нет кадра «${voice}…»`);
  return hit.state;
}

export function render(pen: Pen, w: World): void {
  if (w.flashback) {
    render01(pen, { ...flashbackState(w.flashback.voice), board: null }); // табло 01 со своими критериями — шум
    pen.layer("top", () => stamp(pen, "⟲ Ролик про очередь задач", { left: DB.x + DB.w + 12, right: POD.x - 12 }));
    return;
  }
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawTable(pen, w);
  drawAdds(pen, w);
  drawFlushes(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [255, 398], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") }); // SQL — только где его надо прочитать
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
    const unsure = ACTORS.find((id) => w.actors[id].unsure && !did(w.actors[id], "lost")); // решает на следующем кадре
    if (unsure) bubble(pen, "think", "Дошло? Повторю!", { x: POD.x + POD.w + 4, y: podMid(unsure) - 30, tail: "left", thought: true, attrs: { class: "fx-pop" } });
  });
}

