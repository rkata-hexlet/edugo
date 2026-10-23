import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, type Look, type Mood } from "../../kit/characters";
import { icon } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { clock } from "./script";
import { ACTORS, STOCK, latest, type Act, type Actor, type ActorId, type Focus, type SimEvent, type World } from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки — только из состояния кадра (Actor.acts).
// Сетка (1280×720): шапка; слева строка товара стопкой версий (новая сверху) и таблица orders, под ними SQL;
// в центре поды; справа магазин с покупателями и табло. Ниже SAFE_BOTTOM — пусто.
// Снимок REPEATABLE READ — пунктирная линия цвета пода над версиями, которых транзакция не видит.

const POD_Y: Record<ActorId, number> = { A: 150, B: 300 };
const POD = { x: 640 };
const TABLE = { x: 40, y: 124, w: 400, rowH: 38, gap: 5 };
const ORDERS = { y: 312 };
const SHOP = { x: 984, y: 130, w: 256, h: 300 };
const CARD_Y: Record<ActorId, number> = { A: 236, B: 366 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const BOTTOM = 650;
const DB = { x: 100, w: 130 };

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };
const DRAW = { pathLength: 1, class: "fx-draw" };

const rowY = (p: number) => TABLE.y + p * (TABLE.rowH + TABLE.gap);
const orderY = (i: number) => ORDERS.y + i * (TABLE.rowH + TABLE.gap);
const podMid = (id: ActorId) => POD_Y[id] + BOB.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
const did = (a: Actor, kind: Act["kind"]) => a.acts.some((x) => x.kind === kind);
const name = (w: World, id: ActorId) => w.customers.find((c) => c.pod === id)!.name;

/** Какие версии строки на экране: стопкой — все, новая сверху; без стопки — одна строка таблицы. */
function shown(w: World): number[] {
  const all = w.versions.map((_, i) => i).reverse();
  return w.stack ? all : [all[0]];
}

/** Строка экрана, где нарисована версия i (без стопки — всё в одной строке). */
function slot(w: World, i: number): number {
  return w.stack ? w.versions.length - 1 - i : 0;
}

function drawRow(pen: Pen, w: World): void {
  pen.text("row:hdr", { x: TABLE.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "row") }, "products · id 7 · Кружка");
  const top = latest(w);
  pen.group(`rows:${w.scene}`, 0, 0, () => {
    for (const i of shown(w)) {
      const v = w.versions[i];
      const draft = v.at === null;
      const old = w.stack && !draft && i !== top;
      const created = w.actors.A.acts.concat(w.actors.B.acts).some((x) => x.kind === "write" && x.version === i) || happened(w, "commit");
      const [k, fx] = once(`row:v${i}`, w.frame, created && (draft || i === top) ? "fx-pop" : null);
      pen.group(k, TABLE.x, rowY(slot(w, i)), () => {
        pen.rect(`${k}:bg`, {
          width: TABLE.w, height: TABLE.rowH, rx: 6, fill: draft ? COLOR.draftBg : COLOR.surface,
          stroke: draft ? COLOR.warn : COLOR.line, "stroke-width": 1.5, ...(draft ? { "stroke-dasharray": "6 4" } : {}),
        });
        // Без стопки незакоммиченная правка видна в той же строке: «1 → 0».
        const value = !w.stack && draft ? `${w.versions[top].stock} → ${v.stock}` : `${v.stock}`;
        pen.text(`${k}:t`, { x: 14, y: 25, ...MONO, fill: COLOR.ink }, [
          { text: "stock ", attrs: { fill: COLOR.muted } },
          { text: value, attrs: { "font-weight": 700 } },
        ]);
        if (draft) {
          icon(pen, `${k}:lock`, "lock", TABLE.w - 34, 7, 24, ACTOR[v.by!].color);
          if (w.stack) pen.text(`${k}:note`, { x: TABLE.w - 44, y: 25, ...SANS, fill: COLOR.warn, "text-anchor": "end" }, "не закоммичено");
        } else if (w.stack && v.by) {
          const when = w.clockShown ? ` · ${clock(v.at!)}` : "";
          pen.text(`${k}:note`, { x: TABLE.w - 14, y: 25, ...SANS, fill: ACTOR[v.by].color, "text-anchor": "end" }, `от пода ${v.by}${when}`);
        } else if (w.stack && w.clockShown) {
          pen.text(`${k}:note`, { x: TABLE.w - 14, y: 25, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, clock(v.at!));
        }
      }, { ...fade(w, "row"), ...(old ? { opacity: lit(w, "row") ? 0.45 : DIM * 0.45 } : {}), ...fx });
    }
  }, happened(w, "page") ? { class: "fx-cascade" } : {});
  drawSnapshots(pen, w);
}

/** Снимок транзакции на REPEATABLE READ: линия над версиями, которых она не видит. */
function drawSnapshots(pen: Pen, w: World): void {
  if (!w.stack || !w.clockShown) return;
  ACTORS.forEach((id, n) => {
    const tx = w.actors[id].tx;
    if (!tx || tx.level !== "RR" || tx.snapshot === null) return;
    let seen = w.versions.length - 1;
    while (seen > 0 && !(w.versions[seen].at !== null && w.versions[seen].at! <= tx.snapshot!)) seen--;
    const y = rowY(slot(w, seen)) - TABLE.gap / 2 - 1 + n * 3;
    const color = ACTOR[id].color;
    pen.group(`snap:${id}`, 0, 0, () => {
      pen.line(`snap:${id}:l`, { x1: TABLE.x - 10, y1: y, x2: TABLE.x + TABLE.w + 10, y2: y, stroke: color, "stroke-width": 3, "stroke-dasharray": "8 6" });
      pen.text(`snap:${id}:t`, { x: TABLE.x + TABLE.w + 18, y: y + 6 + n * 22, ...SANS, fill: color, "font-weight": 700 }, `снимок ${id} · ${clock(tx.snapshot!)}`);
    }, fade(w, id, "row"));
  });
}

function drawOrders(pen: Pen, w: World): void {
  pen.text("ord:hdr", { x: TABLE.x + 12, y: ORDERS.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "orders") }, "orders");
  if (!w.orders.length) {
    pen.text("ord:empty", { x: TABLE.x + 14, y: ORDERS.y + 25, ...SANS, fill: COLOR.faint, ...fade(w, "orders") }, "пусто");
    return;
  }
  let sold = 0;
  w.orders.forEach((o, i) => {
    if (o.committed) sold++;
    const extra = o.committed && sold > STOCK;
    const fresh = happened(w, "insert", o.by) && i === w.orders.length - 1;
    const [k, fx] = once(`ord:${i}`, w.frame, fresh ? "fx-slide" : extra && happened(w, "commit", o.by) ? "fx-shake" : null);
    pen.group(k, TABLE.x, orderY(i), () => {
      pen.rect(`${k}:bg`, {
        width: TABLE.w, height: TABLE.rowH, rx: 6, fill: extra ? COLOR.alarmBg : o.committed ? COLOR.surface : COLOR.draftBg,
        stroke: extra ? COLOR.error : o.committed ? COLOR.line : COLOR.warn, "stroke-width": 1.5, ...(o.committed ? {} : { "stroke-dasharray": "6 4" }),
      });
      pen.text(`${k}:t`, { x: 14, y: 25, ...MONO, fill: COLOR.ink }, `заказ ${i + 1} · кружка · ${name(w, o.by)}`);
      if (extra) pen.text(`${k}:x`, { x: TABLE.w - 14, y: 25, ...SANS, "font-weight": 700, fill: COLOR.error, "text-anchor": "end" }, "лишний");
    }, { ...fade(w, "orders"), ...fx });
  });
}

function podMood(w: World, a: Actor): Mood {
  if (a.tx?.waiting) return "wait";
  if (a.failed || happened(w, "none", a.id)) return "lost";
  if (happened(w, "ok", a.id)) return "won";
  if (a.acts.length || a.tx) return "work";
  return "idle";
}

function podLook(w: World, a: Actor): Look {
  if (happened(w, "ok", a.id) || happened(w, "none", a.id)) return { x: 1, y: 0 };
  if (a.acts.length || a.tx) return { x: -1, y: -0.6 };
  return { x: 0, y: 0 };
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(w, a);
  const failedNow = did(a, "fail");
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    const [fxKey, fxAttrs] = once(`pod:${a.id}:fx`, w.frame, failedNow ? "fx-jolt" : null);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, { x: 0, y: 0, color, tint, letter: a.id, mood, look: podLook(w, a), dashed: mood === "wait" }), fxAttrs);
    const nx = BOB.w + 14;
    pen.text(`pod:${a.id}:label`, { x: nx, y: 20, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: color }, a.label);
    if (a.failed) {
      pill(pen, `pod:${a.id}:err`, "40001 · откат", { x: nx, y: 34, fill: COLOR.alarmBg, color: COLOR.error, stroke: COLOR.error, attrs: failedNow ? { class: "fx-pop" } : {} });
    } else if (a.retried && happened(w, "retry", a.id)) {
      pen.group(`pod:${a.id}:retry`, nx, 34, () => {
        icon(pen, `pod:${a.id}:retry:i`, "replay", 0, 2, 24, COLOR.warn);
        pen.text(`pod:${a.id}:retry:t`, { x: 30, y: 20, ...SANS, fill: COLOR.warn, "font-weight": 700 }, "заново");
      }, { class: "fx-pop" });
    } else if (a.thought) {
      bubble(pen, `pod:${a.id}:think`, a.thought, { x: nx - 4, y: 52, tail: "left", thought: true });
    }
  }, fade(w, a.id));
}

/** Стрелки пода к строке: прочитал — тонкая серая к версии; записал — толстая в цвете пода; ждёт — пунктир. */
function drawPodArrows(pen: Pen, w: World): void {
  for (const id of ACTORS) {
    const a = w.actors[id];
    const from = { x: POD.x - 8, y: podMid(id) };
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const to = (i: number) => ({ x: TABLE.x + TABLE.w + 8, y: rowY(slot(w, i)) + TABLE.rowH / 2 });
    const top = { x: TABLE.x + TABLE.w + 8, y: rowY(0) + TABLE.rowH / 2 };
    a.acts.forEach((x, n) => {
      const key = `arr:${id}:${n}`;
      const base = { x1: from.x, y1: from.y - 10 + n * 4, "stroke-linecap": "round", marker: "arrow", opacity: op };
      if (x.kind === "read") {
        const t = to(x.version);
        pen.line(key, { ...base, x2: t.x, y2: t.y + (id === "A" ? -6 : 6), stroke: COLOR.muted, "stroke-width": 2, ...DRAW });
      } else if (x.kind === "write") {
        const t = to(x.version);
        pen.line(key, { ...base, x2: t.x, y2: t.y, stroke: color, "stroke-width": 4, ...DRAW });
      } else if (x.kind === "wait" && a.tx?.waiting) {
        pen.line(key, { ...base, x2: top.x, y2: top.y + 8, stroke: color, "stroke-width": 2.5, "stroke-dasharray": "7 6" });
      } else if (x.kind === "zero") {
        pen.line(key, { ...base, x2: top.x, y2: top.y + 8, stroke: COLOR.muted, "stroke-width": 2.5, ...DRAW });
        pen.text(`${key}:t`, { x: (from.x + top.x) / 2 - 30, y: (from.y + top.y) / 2 - 6, ...SANS, fill: COLOR.muted, "font-weight": 700, opacity: op }, "0 строк");
      } else if (x.kind === "fail") {
        pen.line(key, { ...base, x2: top.x, y2: top.y + 8, stroke: COLOR.error, "stroke-width": 3, ...DRAW });
        icon(pen, `${key}:x`, "cross", (from.x + top.x) / 2 - 12, (from.y + top.y) / 2 - 14, 24, COLOR.error, { opacity: op });
      }
    });
    // Итог для покупателя: подтверждение или «нет в наличии».
    if (happened(w, "ok", id) || happened(w, "none", id)) {
      const ok = happened(w, "ok", id);
      pen.line(`arr:${id}:shop`, {
        x1: POD.x + BOB.w + 160, y1: podMid(id) + 20, x2: SHOP.x - 8, y2: CARD_Y[id] + 10,
        stroke: ok ? color : COLOR.muted, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow", ...DRAW, ...fade(w, "shop", id),
      });
    }
  }
}

const STATUS: Record<string, { icon: "check" | "hourglass" | "cross" | null; text: string; color: string }> = {
  idle: { icon: null, text: "смотрит на кружку", color: COLOR.muted },
  press: { icon: null, text: "жмёт «Купить»", color: COLOR.ink },
  wait: { icon: "hourglass", text: "ждёт…", color: COLOR.warn },
  ok: { icon: "check", text: "Заказ принят", color: COLOR.ok },
  none: { icon: "cross", text: "Нет в наличии", color: COLOR.muted },
};

/** Магазин: витрина (пока о ней говорят) и покупатели, каждый — напротив своего пода. */
function drawShop(pen: Pen, w: World): void {
  panel(pen, "shop:box", { x: SHOP.x, y: SHOP.y, w: SHOP.w, h: SHOP.h, stroke: COLOR.browser, attrs: fade(w, "shop") });
  pen.group("shop", 0, 0, () => {
    iconText(pen, "shop:title", "browser", SHOP.x + 16, SHOP.y + 36, "Магазин", COLOR.browser, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
    if (w.showcase) {
      const left = w.versions[latest(w)].stock;
      pen.text("shop:mug", { x: SHOP.x + 16, y: SHOP.y + 70, ...SANS, fill: COLOR.warn, "font-weight": 700, class: "fx-pop" }, `Кружка · осталось ${left}`);
    }
    for (const c of w.customers) {
      const st = STATUS[c.status];
      const y = CARD_Y[c.pod];
      const changed = happened(w, c.status === "ok" ? "ok" : c.status === "none" ? "none" : "press", c.pod);
      const [k, fx] = once(`shop:${c.pod}`, w.frame, changed ? "fx-pop" : null);
      pen.group(k, 0, 0, () => {
        pen.text(`${k}:n`, { x: SHOP.x + 16, y, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, c.name);
        if (st.icon) iconText(pen, `${k}:s`, st.icon, SHOP.x + 16, y + 32, st.text, st.color, { ...SANS, "font-weight": 600 });
        else pen.text(`${k}:s:t`, { x: SHOP.x + 16, y: y + 32, ...SANS, fill: st.color }, st.text);
      }, fx);
    }
  }, fade(w, "shop"));
}

/** Вставка эпизода 01: та же развилка в очереди задач — B и C дождались коммита A, условие перепроверено. */
function drawFlashback(pen: Pen, w: World): void {
  if (!w.flashback) return;
  const x = 280;
  const y = 104;
  pen.group("fb", 0, 0, () => {
    panel(pen, "fb:box", { x, y, w: 700, h: 360, fill: COLOR.bg2, stroke: COLOR.muted });
    pen.text("fb:title", { x: x + 24, y: y + 40, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, "Эпизод 01 · очередь задач");
    const rows = [["#1", "in_progress", "A"], ["#2", "new", null], ["#3", "new", null]] as const;
    rows.forEach(([id, status, by], i) => {
      const ry = y + 64 + i * 44;
      pen.rect(`fb:r${i}`, { x: x + 24, y: ry, width: 330, height: 38, rx: 6, fill: by ? COLOR.doneBg : COLOR.surface, stroke: COLOR.line, "stroke-width": 1.5 });
      pen.text(`fb:r${i}:t`, { x: x + 38, y: ry + 25, ...MONO, fill: COLOR.ink }, `${id}  status ${status}`);
      if (by) pen.text(`fb:r${i}:by`, { x: x + 340, y: ry + 25, ...SANS, fill: ACTOR.A.color, "text-anchor": "end", "font-weight": 700 }, "A");
    });
    (["B", "C"] as const).forEach((id, i) => {
      const bx = x + 410 + i * 150;
      bob(pen, `fb:${id}`, { x: bx, y: y + 84, color: ACTOR[id].color, tint: ACTOR[id].tint, letter: id, mood: "lost", look: { x: -1, y: 0 } });
      pen.text(`fb:${id}:t`, { x: bx + 32, y: y + 180, ...SANS, fill: COLOR.muted, "font-weight": 700, "text-anchor": "middle" }, "0 строк");
    });
    pen.text("fb:sql", { x: x + 24, y: y + 260, ...MONO, fill: COLOR.ink }, [
      { text: "UPDATE tasks SET status = 'in_progress'\n" },
      { text: "  WHERE id = 1 AND status = 'new'" },
    ]);
    pen.text("fb:note", { x: x + 24, y: y + 336, ...SANS, fill: COLOR.muted }, "ждали COMMIT пода A → условие перепроверено");
  }, { class: "fx-fade" });
}

function drawHeader(pen: Pen, w: World): void {
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "fail") || happened(w, "zero") ? "fx-nod" : null);
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08 }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", "КЕЙС", { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  if (!w.clockShown) return;
  pen.group("clock", 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
  }, fade(w, "clock"));
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawRow(pen, w);
  drawOrders(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [225, 410], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") }); // SQL — только где его надо прочитать
  drawPodArrows(pen, w);
  drawShop(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    drawFlashback(pen, w);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: POD.x - 12 });
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}

