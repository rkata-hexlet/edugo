import { STAGE, type Attrs, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, meter, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { clock } from "./script";
import {
  ACTORS, HOT, L1_TTL, dbLoad, entry, nodeLoads, overloaded, type Act, type Actor, type ActorId, type Focus, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра (Actor.acts).
// Сетка (1280×720): шапка; слева таблица links, полоса нагрузки базы и Redis — сбоку от пути (cache-aside:
// под сам ходит и в кэш, и в базу); в центре поды; справа браузеры и табло. Ниже SAFE_BOTTOM — пусто.

const POD_Y: Record<ActorId, number> = { A: 128, B: 244, C: 360 };
const POD = { x: 640, w: 250, h: 64 };
const TABLE = { x: 40, y: 124, rowH: 38, gap: 5 };
const COLS = [
  { title: "code", x: 0, w: 110 },
  { title: "long_url", x: 110, w: 290 },
];
const TABLE_END = TABLE.x + 400;
const LOAD = { y: 300 };
const REDIS = { x: 40, y: 330, w: 520, h: 132 };
const BROWSERS = { x: 984, y: 130, w: 256, h: 300, line0: 236, lineH: 30 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };

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
/** Путь адреса для коротких подписей: shop.example/sale → /sale. */
const path = (url: string) => url.slice(url.indexOf("/"));
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Срок: «40 мин» / «8 с». */
function left(s: number): string {
  return s >= 60 ? `${Math.round(s / 60)} мин` : `${Math.max(0, Math.round(s))} с`;
}

function drawTable(pen: Pen, w: World): void {
  COLS.forEach((col, i) =>
    pen.text(`hdr:${i}`, { x: TABLE.x + col.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "table") }, col.title));
  pen.group(`rows:${w.scene}`, 0, 0, () => {
    w.links.forEach((l, i) => {
      const hot = i === 0;
      const value = l.draft !== null ? `${path(l.url)} → ${path(l.draft)}` : l.url;
      const edited = hot && happened(w, "commit");
      pen.group(`row:${i}`, TABLE.x, rowY(i), () => {
        COLS.forEach((col, c) => pen.rect(`row:${i}:c${c}`, {
          x: col.x, width: col.w, height: TABLE.rowH, fill: c === 1 && l.draft !== null ? COLOR.draftBg : COLOR.surface,
          stroke: c === 1 && l.draft !== null ? COLOR.warn : COLOR.line, "stroke-width": 1.5, ...(c === 1 && l.draft !== null ? { "stroke-dasharray": "6 4" } : {}),
        }));
        pen.text(`row:${i}:code`, { x: 12, y: 25, ...MONO, fill: hot ? COLOR.ink : COLOR.muted, "font-weight": hot ? 700 : 400 }, l.code);
        const [vk, vfx] = once(`row:${i}:url`, w.frame, edited ? "fx-pop" : null);
        pen.group(vk, 0, 0, () => pen.text(`${vk}:t`, { x: COLS[1].x + 12, y: 25, ...MONO, fill: hot ? COLOR.ink : COLOR.muted }, value), vfx);
        if (l.lockedBy) icon(pen, `row:${i}:lock`, "lock", 400 + 8, 8, 24, ACTOR[l.lockedBy].color);
      }, fade(w, "table", ...(hot ? ["row" as Focus] : [])));
    });
    pen.text("rows:more", { x: TABLE.x + 12, y: rowY(w.links.length) + 18, ...SANS, fill: COLOR.faint, ...fade(w, "table") }, "… ещё миллионы ссылок");
  }, happened(w, "page") ? { class: "fx-cascade" } : {});
  // Нагрузка базы: полоса с потолком, без чисел ёмкости (tech-expert).
  if (!about(w, "load")) return;
  const load = dbLoad(w);
  pen.group("dbload", 0, 0, () => {
    pen.text("dbload:t", { x: TABLE.x, y: LOAD.y + 6, ...SANS, fill: COLOR.muted }, "нагрузка базы");
    meter(pen, "dbload:m", { x: TABLE.x + 150, y: LOAD.y - 6, w: 230, h: 12, load });
  }, fade(w, "load", "table"));
}

function drawRedis(pen: Pen, w: World): void {
  const r = w.redis;
  if (!r) return;
  const [key, fx] = once("redis", w.frame, happened(w, "reshard") ? "fx-pop" : null);
  pen.group(key, 0, 0, () => {
    panel(pen, "redis:box", { x: REDIS.x, y: REDIS.y, w: REDIS.w, h: REDIS.h, stroke: COLOR.redis });
    pen.text("redis:title", { x: REDIS.x + 18, y: REDIS.y + 30, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.redis },
      r.nodes > 1 ? `Redis · кластер из ${r.nodes} узлов` : "Redis");
    if (r.nodes > 1) drawNodes(pen, w);
    else drawEntry(pen, w);
  }, { ...fade(w, "redis"), ...fx });
}

/** Одиночный Redis: запись горячего ключа с полосой TTL; удалённая — зачёркнута. */
function drawEntry(pen: Pen, w: World): void {
  const e = entry(w);
  const y = REDIS.y + 72;
  const x = REDIS.x + 18;
  meter(pen, "redis:load", { x: REDIS.x + REDIS.w - 170, y: REDIS.y + 18, w: 150, h: 12, load: nodeLoads(w)[0] ?? 0 });
  const deleted = ACTORS.some((id) => w.actors[id].acts.some((a) => a.kind === "del" && a.n > 0));
  if (!e) {
    if (deleted) {
      pen.group(`redis:gone:${w.frame}`, 0, 0, () => {
        pen.text("redis:gone:t", { x, y, ...MONO, fill: COLOR.muted, "text-decoration": "line-through" }, HOT);
        icon(pen, "redis:gone:i", "trash", x + 70, y - 18, 22, COLOR.warn);
      }, { class: "fx-pop" });
    } else pen.text("redis:empty", { x, y, ...SANS, fill: COLOR.faint }, "пусто");
    return;
  }
  const isNew = ACTORS.some((id) => did(w.actors[id], "set"));
  const [k, fx] = once("redis:e", w.frame, isNew ? "fx-pop" : null);
  pen.group(k, 0, 0, () => {
    pen.text(`${k}:t`, { x, y, ...MONO, fill: COLOR.ink }, [
      { text: `${HOT} → `, attrs: { fill: COLOR.muted } },
      { text: e.value, attrs: { fill: COLOR.ink, "font-weight": 700 } },
    ]);
  }, fx);
  // Полоса срока: сколько записи ещё жить.
  const frac = Math.max(0, Math.min(1, (e.expiresAt - w.clock) / e.ttl));
  const bw = 320;
  pen.rect("redis:ttl:track", { x, y: y + 22, width: bw, height: 8, rx: 4, fill: COLOR.bg2, stroke: COLOR.line, "stroke-width": 1 });
  pen.rect("redis:ttl:bar", { x, y: y + 22, width: Math.max(6, bw * frac), height: 8, rx: 4, fill: frac < 0.15 ? COLOR.warn : COLOR.redis });
  pen.text("redis:ttl:t", { x: x + bw + 14, y: y + 31, ...SANS, fill: COLOR.muted }, `TTL ${left(e.expiresAt - w.clock)}`);
}

/** Кластер: узлы в ряд, у каждого полоса нагрузки; горячий ключ — в слоте одного узла. */
function drawNodes(pen: Pen, w: World): void {
  const r = w.redis!;
  const loads = nodeLoads(w);
  const gap = 8;
  const tw = (REDIS.w - 32 - gap * (r.nodes - 1)) / r.nodes;
  for (let i = 0; i < r.nodes; i++) {
    const x = REDIS.x + 16 + i * (tw + gap);
    const y = REDIS.y + 46;
    const hot = i + 1 === r.hotNode;
    const over = loads[i] > 1;
    const [k, fx] = once(`node:${i}`, w.frame, hot && over && happened(w, "overload") ? "fx-shake" : null);
    pen.group(k, 0, 0, () => {
      panel(pen, `${k}:box`, { x, y, w: tw, h: 74, rx: 10, fill: over ? COLOR.alarmBg : COLOR.surface2, stroke: over ? COLOR.error : COLOR.line, shadow: false });
      pen.text(`${k}:n`, { x: x + 8, y: y + 24, ...SANS, fill: COLOR.muted }, r.nodes > 4 ? `${i + 1}` : `узел ${i + 1}`);
      if (hot && entry(w)) pen.text(`${k}:key`, { x: x + 8, y: y + 48, ...MONO, fill: COLOR.ink, "font-weight": 700 }, HOT);
      meter(pen, `${k}:m`, { x: x + 8, y: y + 58, w: tw - 26, h: 8, load: loads[i] });
    }, fx);
  }
}

/** Точка, куда стрелка пода упирается в Redis: запись или горячий узел. */
function redisTarget(w: World): { x: number; y: number } {
  const r = w.redis!;
  if (r.nodes === 1) return { x: REDIS.x + REDIS.w + 6, y: REDIS.y + 66 };
  const gap = 8;
  const tw = (REDIS.w - 32 - gap * (r.nodes - 1)) / r.nodes;
  return { x: REDIS.x + 16 + (r.hotNode - 1) * (tw + gap) + tw / 2, y: REDIS.y + 44 };
}

function podMood(w: World, a: Actor): Mood {
  if (!a.present) return "frozen";
  if (overloaded(w) && a.acts.length) return "wait";
  if (a.editing || did(a, "commit")) return "work";
  if (a.acts.length) return "work";
  return "idle";
}

function podLook(w: World, a: Actor): Look {
  if (happened(w, "ok", a.id) || happened(w, "stale", a.id)) return { x: 1, y: 0 };
  if (did(a, "select") || did(a, "update") || did(a, "commit")) return { x: -1, y: Math.max(-1, Math.min(1, (rowMid(0) - podMid(a.id)) / 160)) };
  if (a.acts.length) return { x: -1, y: 0.6 };
  return { x: 0, y: 0 };
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(w, a);
  const crashedNow = !a.present && happened(w, "crash", a.id);
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxAttrs] = once(`pod:${a.id}:fx`, w.frame, crashedNow ? "fx-fade" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood, look: podLook(w, a), ghost: crashedNow, dashed: mood === "wait" }), fxAttrs);
    const nameColor = a.present ? color : COLOR.muted;
    const nx = BOB.w + 14;
    pen.text(`pod:${a.id}:label`, { x: nx, y: 24, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: nameColor },
      a.present ? a.label : `${a.label} · упал`);
    if (a.present && (a.editing || did(a, "commit"))) icon(pen, `pod:${a.id}:edit`, "pencil", nx + 76, 6, 22, COLOR.warn);
    if (!a.present) return;
    if (w.l1) drawPocket(pen, w, a);
  }, fade(w, a.id));
}

/** Карман L1 пода: своя копия и своя полоса срока. */
function drawPocket(pen: Pen, w: World, a: Actor): void {
  const x = BOB.w + 14;
  const y = 36;
  const p = a.l1 && a.l1.expiresAt > w.clock ? a.l1 : null;
  const dropped = happened(w, "drop", a.id);
  pen.rect(`pod:${a.id}:l1:bg`, { x, y, width: 168, height: 26, rx: 8, fill: COLOR.surface2, stroke: dropped ? COLOR.warn : COLOR.line, "stroke-width": 1.5 });
  pen.text(`pod:${a.id}:l1:k`, { x: x + 8, y: y + 19, ...MONO, fill: COLOR.muted }, "L1");
  if (!p) {
    pen.text(`pod:${a.id}:l1:v`, { x: x + 36, y: y + 19, ...SANS, fill: COLOR.faint }, dropped ? "сброшен" : "пусто");
    return;
  }
  pen.text(`pod:${a.id}:l1:v`, { x: x + 36, y: y + 19, ...MONO, fill: p.value === w.links[0].url ? COLOR.ink : COLOR.error, "font-weight": 700 }, path(p.value));
  pen.text(`pod:${a.id}:l1:s`, { x: x + 128, y: y + 19, ...SANS, fill: COLOR.muted }, left(p.expiresAt - w.clock));
  const frac = Math.max(0, Math.min(1, (p.expiresAt - w.clock) / L1_TTL));
  pen.rect(`pod:${a.id}:l1:bar`, { x: x + 2, y: y + 22, width: Math.max(4, 164 * frac), height: 3, rx: 1.5, fill: COLOR.redis });
}

/** Стрелки пода: к Redis (попал / промах / положил / удалил), к строке базы мимо Redis, рассылка. */
function drawPodArrows(pen: Pen, w: World): void {
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (!a.present && !happened(w, "crash", id)) continue;
    const from = { x: POD.x - 6, y: podMid(id) };
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const toDb = did(a, "update") || did(a, "commit") ? "write" : did(a, "select") ? "read" : null;
    if (toDb) {
      pen.line(`arr:${id}:db`, {
        x1: from.x, y1: from.y - 8, x2: TABLE_END + 40, y2: rowMid(0),
        stroke: toDb === "write" ? color : COLOR.muted, "stroke-width": toDb === "write" ? 3.5 : 2.5, "stroke-linecap": "round", marker: "arrow", opacity: op, ...DRAW,
      });
    }
    if (!w.redis) continue;
    const t = redisTarget(w);
    const delAct = a.acts.find((x): x is Extract<Act, { kind: "del" }> => x.kind === "del");
    const get = a.acts.find((x): x is Extract<Act, { kind: "get" }> => x.kind === "get");
    const kind = delAct ? "del" : did(a, "set") ? "set" : get ? (get.hit ? "hit" : "miss") : null;
    if (!kind) continue;
    const y2 = t.y + (ACTORS.indexOf(id) - 1) * 10;
    const style: Attrs = kind === "miss"
      ? { stroke: COLOR.muted, "stroke-width": 2.5, "stroke-dasharray": "7 6" }
      : kind === "del" ? { stroke: COLOR.warn, "stroke-width": 3, ...DRAW } : { stroke: color, "stroke-width": 3, ...DRAW };
    pen.line(`arr:${id}:redis`, { x1: from.x, y1: from.y + 8, x2: t.x, y2, "stroke-linecap": "round", marker: "arrow", opacity: op, ...style });
    // Значок на конце: промах — крест, удалил — корзина.
    const mid = { x: (from.x + t.x) / 2, y: (from.y + 8 + y2) / 2 };
    if (kind === "miss") icon(pen, `arr:${id}:miss`, "cross", mid.x - 11, mid.y - 22, 22, COLOR.error, { opacity: op });
    if (kind === "del") icon(pen, `arr:${id}:del`, "trash", mid.x - 11, mid.y - 24, 22, COLOR.warn, { opacity: op });
  }
  // Рассылка «сбрось»: под → канал Redis → остальные поды. Поды друг друга не знают, доносит Redis.
  const hub = { x: REDIS.x + REDIS.w + 4, y: REDIS.y + 34 };
  const pub: Attrs = { stroke: COLOR.warn, "stroke-width": 2.5, "stroke-dasharray": "6 5", "stroke-linecap": "round", marker: "arrow", ...DRAW };
  for (const id of ACTORS) {
    if (!did(w.actors[id], "publish")) continue;
    icon(pen, `pub:${id}`, "broadcast", POD.x - 18, POD_Y[id] - 10, 26, COLOR.warn);
    pen.text(`pub:${id}:chan`, { x: REDIS.x + REDIS.w - 16, y: REDIS.y + 30, ...SANS, fill: COLOR.warn, "text-anchor": "end" }, "канал");
    pen.path(`pub:${id}:in`, { d: `M ${POD.x - 4} ${podMid(id) + 4} Q ${hub.x + 70} ${podMid(id) + 40} ${hub.x + 4} ${hub.y - 6}`, ...pub });
    for (const to of ACTORS) {
      if (to === id || !happened(w, "drop", to)) continue;
      pen.path(`pub:${id}:${to}`, { d: `M ${hub.x} ${hub.y + 10} Q ${hub.x + 40} ${podMid(to) + 10} ${POD.x - 8} ${podMid(to) + 14}`, ...pub });
    }
  }
}

/** Браузеры: журнал ответов; старый адрес — красным с 404, медленная страница — песочными часами. */
function drawBrowsers(pen: Pen, w: World): void {
  drawBrowserArrows(pen, w);
  const stale = w.clicks.some((c) => c.stale);
  const [k, fx] = once("br", w.frame, happened(w, "stale") ? "fx-shake" : null);
  pen.group(k, 0, 0, () => {
    panel(pen, "br:box", { x: BROWSERS.x, y: BROWSERS.y, w: BROWSERS.w, h: BROWSERS.h, fill: stale ? COLOR.alarmBg : COLOR.surface, stroke: stale ? COLOR.error : COLOR.browser });
    iconText(pen, "br:title", "browser", BROWSERS.x + 16, BROWSERS.y + 38, "Браузеры", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    if (w.flow > 0) iconText(pen, "br:flow", "flame", BROWSERS.x + 16, BROWSERS.y + 72, `${thousands(w.flow)} кликов/с`, w.flow >= 100_000 ? COLOR.error : COLOR.warn);
    pen.rect("br:rule", { x: BROWSERS.x + 16, y: BROWSERS.y + 84, width: BROWSERS.w - 32, height: 1.5, fill: COLOR.line });
    w.clicks.forEach((c, i) => {
      const y = BROWSERS.line0 + i * BROWSERS.lineH;
      const fresh = w.events.length > 0 && i >= w.clicks.length - clicksNow(w);
      pen.group(`br:l${i}:${c.url}:${c.stale}`, 0, 0, () => {
        const color = c.stale ? COLOR.error : c.slow ? COLOR.warn : COLOR.ok;
        const x = iconText(pen, `br:l${i}`, c.stale ? "cross" : c.slow ? "hourglass" : "check", BROWSERS.x + 16, y, path(c.url), c.stale ? COLOR.error : COLOR.ink, MONO) + 8;
        if (c.stale) pen.text(`br:l${i}:n`, { x, y, ...SANS, "font-weight": 700, fill: color }, "404");
        else if (c.slow) pen.text(`br:l${i}:n`, { x, y, ...SANS, fill: color }, "4 с");
      }, fresh ? { class: "fx-slide" } : {});
    });
  }, { ...fade(w, "browsers"), ...fx });
}

/** Сколько ответов пришло в этом кадре. */
const clicksNow = (w: World) => w.events.filter((e) => e.kind === "ok" || e.kind === "stale").length;

function drawBrowserArrows(pen: Pen, w: World): void {
  const n = clicksNow(w);
  if (!n) return;
  w.clicks.slice(-n).forEach((c, j) => {
    const i = w.clicks.length - n + j;
    pen.line(`arr:br:${i}`, {
      x1: POD.x + POD.w - 20, y1: podMid(c.by), x2: BROWSERS.x - 6, y2: BROWSERS.line0 + i * BROWSERS.lineH - 6,
      stroke: c.stale ? COLOR.error : ACTOR[c.by].color, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow", ...DRAW,
      ...fade(w, "browsers", c.by),
    });
  });
}

function drawHeader(pen: Pen, w: World): void {
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "commit") ? "fx-nod" : null);
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08 }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: dbLoad(w) > 1 ? COLOR.error : COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!about(w, "clock", false) && !happened(w, "clock")) return;
  const [clockKey, clockFx] = once("clock", w.frame, happened(w, "clock") ? "fx-pulse" : null);
  pen.group(clockKey, 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
  }, { ...fade(w, "clock"), ...clockFx });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawTable(pen, w);
  drawRedis(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [285, 420], attrs: fade(w, "board") });
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
  });
}
