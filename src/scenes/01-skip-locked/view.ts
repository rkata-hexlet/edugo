import type { Pen } from "../../engine/contract";
import { clock } from "./script";
import { ACTORS, duplicates, waitingFor, type Actor, type ActorId, type Row, type World } from "./sim";

// MVP-отрисовка: серые фигуры и подписи. Полировка — после утверждения сюжета.

const C = {
  ink: "#222", muted: "#888", box: "#e4e4e4", line: "#999", white: "#fff",
  red: "#d33", redBg: "#fde2e2", green: "#2e7d4f", greenBg: "#dcf1e3",
  draft: "#fff1b8", work: "#e3eafc", frozen: "#c9c9c9", lock: "#b26b00",
};
const MONO = "ui-monospace, Menlo, Consolas, monospace";

const SHELF = { x: 40, y: 150, rowH: 56, gap: 16 };
const COLS = [
  { title: "id", x: 0, w: 50 },
  { title: "status", x: 50, w: 170 },
  { title: "claim_token", x: 220, w: 120 },
  { title: "lease_until", x: 340, w: 120 },
];
const ACTOR = { w: 110, h: 46 };
const DOOR = { x: 1140, w: 120 }; // дверь клиента заказа — на уровне его полки

const rowY = (id: number) => SHELF.y + (id - 1) * (SHELF.rowH + SHELF.gap);
const SHELF_END = SHELF.x + 465; // правый край строки — сюда сходятся стрелки

/** Стрелка — отношение из модели: посылка в руках, доставка (путь полка → под → дверь), ожидание замка. */
export interface Arrow {
  kind: "carry" | "deliver" | "duplicate" | "rejected" | "wait";
  row: number;
  by: ActorId;
  delivery?: number; // какая по счёту доставка в эту дверь
}

/** Только из состояния кадра: carrying, события доставки этого кадра, ожидание блокировки. */
export function arrows(w: World): Arrow[] {
  const out: Arrow[] = [];
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (!a.present) continue;
    if (a.carrying !== null) out.push({ kind: "carry", row: a.carrying, by: id });
    const wait = waitingFor(a);
    if (wait !== null) out.push({ kind: "wait", row: wait, by: id });
  }
  const dup = new Set(w.events.filter((e) => e.kind === "duplicate").map((e) => `${e.row}:${e.by}`));
  w.events.forEach((e) => {
    if ((e.kind !== "deliver" && e.kind !== "rejected") || e.row === undefined || !e.by) return;
    let delivery = -1;
    w.deliveries.filter((d) => d.row === e.row).forEach((d, i) => {
      if (d.by === e.by) delivery = i;
    });
    const kind = e.kind === "rejected" ? "rejected" : dup.has(`${e.row}:${e.by}`) ? "duplicate" : "deliver";
    out.push({ kind, row: e.row, by: e.by, delivery });
  });
  return out;
}

/** Позиции воркеров: делящие одно место встают в ряд; очередь — за стоящими у полки. */
function positions(w: World): Map<ActorId, [number, number]> {
  const out = new Map<ActorId, [number, number]>();
  const taken = new Map<string, number>();
  const slot = (key: string) => {
    const n = taken.get(key) ?? 0;
    taken.set(key, n + 1);
    return n;
  };
  const present = ACTORS.map((id) => w.actors[id]).filter((a) => a.present);
  // Сначала стоящие у полок, потом очереди — чтобы очередь была правее.
  const order = [...present.filter((a) => a.at.kind !== "queue"), ...present.filter((a) => a.at.kind === "queue")];
  for (const a of order) {
    const at = a.at;
    switch (at.kind) {
      case "home":
        out.set(a.id, [600 + ACTORS.indexOf(a.id) * 130, 610]);
        break;
      case "shelf":
      case "queue": {
        const s = slot(`row:${at.row}`);
        out.set(a.id, [560 + s * 135, rowY(at.row) + 5]);
        break;
      }
      case "road":
        out.set(a.id, [760 + slot("road") * 130, 500]);
        break;
      case "door": // очередь у двери — влево от неё
        out.set(a.id, [DOOR.x - 20 - ACTOR.w - slot(`door:${at.row}`) * (ACTOR.w + 10), rowY(at.row) + 5]);
        break;
    }
  }
  return out;
}

/** Грубый перенос по словам для пузырей (SVG сам не переносит). */
function wrap(text: string, max: number): string {
  return text
    .split("\n")
    .map((para) => {
      const lines: string[] = [];
      let cur = "";
      for (const word of para.split(" ")) {
        if (cur && (cur + " " + word).length > max) {
          lines.push(cur);
          cur = word;
        } else cur = cur ? `${cur} ${word}` : word;
      }
      return [...lines, cur].join("\n");
    })
    .join("\n");
}

/** Пузырь реплики; (x, y) — левый нижний угол, при right — правый нижний. */
function bubble(pen: Pen, key: string, x: number, y: number, text: string, maxChars = 24, right = false): void {
  const body = wrap(text, maxChars);
  const lines = body.split("\n");
  const width = Math.max(...lines.map((l) => l.length)) * 7.2 + 16;
  const height = lines.length * 16 + 8;
  pen.group(key, right ? x - width : x, y - height, () => {
    pen.rect(`${key}:bg`, { width, height, rx: 10, fill: C.white, stroke: C.ink, "stroke-width": 1.5 });
    pen.text(`${key}:t`, { x: 8, y: 17, "font-size": 13, fill: C.ink }, body);
  });
}

function drawRow(pen: Pen, w: World, r: Row): void {
  const seenByRace = w.race && ACTORS.some((id) => w.actors[id].seen === r.id);
  const status = r.draft && r.draft.status !== r.status ? `${r.status} → ${r.draft.status}` : r.status;
  const statusFill = r.draft ? C.draft : r.status === "done" ? C.greenBg : r.status === "in_progress" ? C.work : C.white;
  const expired = r.leaseUntil !== null && r.leaseUntil < w.clock && r.status === "in_progress";
  const cells = [
    String(r.id),
    status,
    r.token ? `#${r.token}` : "—",
    r.leaseUntil !== null ? clock(r.leaseUntil) : "—",
  ];
  pen.group(`row:${r.id}`, SHELF.x, rowY(r.id), () => {
    COLS.forEach((col, i) => {
      const fill = i === 1 ? statusFill : i === 3 && expired ? C.redBg : C.white;
      pen.rect(`row:${r.id}:c${i}`, {
        x: col.x, width: col.w, height: SHELF.rowH, fill, stroke: C.line,
        ...(i === 1 && r.draft ? { "stroke-dasharray": "5 4" } : {}),
      });
      pen.text(`row:${r.id}:t${i}`, { x: col.x + 10, y: 34, "font-size": 15, "font-family": MONO, fill: C.ink }, cells[i]);
    });
    if (seenByRace) {
      pen.rect(`row:${r.id}:race`, {
        x: -6, y: -6, width: 472, height: SHELF.rowH + 12, fill: "none", stroke: C.red, "stroke-width": 4, rx: 6,
      });
    }
    if (r.lockedBy) {
      // Заперта при перепроверке, но не взята — бледный замок, чтобы не читалось «взял посылку».
      pen.text(`row:${r.id}:lock`, { x: 470, y: 36, "font-size": 20, fill: C.lock, opacity: r.idle ? 0.35 : 1 },
        `🔒${w.actors[r.lockedBy].label.replace("Pod ", "")}`);
    }
  });
}

function actorStatus(w: World, a: Actor): string {
  const parts: string[] = [];
  if (a.carrying !== null) parts.push(`📦#${a.carrying}`);
  if (a.mutex) parts.push("🔒mu");
  if (a.scan?.waitingFor != null) parts.push(`⏳${w.clock - a.scan.since}с`);
  else if (a.pending) parts.push("⏳");
  if (a.token) parts.push(`🎫${a.token}`);
  if (a.frozen) parts.push("💤");
  return parts.join(" ");
}

function drawActor(pen: Pen, w: World, a: Actor, x: number, y: number): void {
  const waiting = waitingFor(a) !== null;
  pen.group(`actor:${a.id}`, x, y, () => {
    pen.rect(`actor:${a.id}:body`, {
      width: ACTOR.w, height: ACTOR.h, rx: 12,
      fill: a.frozen ? C.frozen : C.box, stroke: waiting ? C.lock : C.ink, "stroke-width": waiting ? 3 : 1.5,
    });
    pen.text(`actor:${a.id}:name`, { x: 10, y: 19, "font-size": 14, "font-weight": 600, fill: C.ink }, a.label);
    pen.text(`actor:${a.id}:st`, { x: 10, y: 38, "font-size": 13, fill: C.ink }, actorStatus(w, a));
  });
}

/** Двери клиентов: у каждого заказа своя; что получено — ✓, второй раз — ДУБЛЬ, отказ — ✕. */
function drawDoors(pen: Pen, w: World): void {
  const dup = duplicates(w);
  for (const r of w.rows) {
    let got = false;
    const marks = w.deliveries.filter((d) => d.row === r.id).map((d) => {
      if (d.rejected) return "✕ повтор";
      const again = got;
      got = true;
      return again ? "✓ ДУБЛЬ" : "✓";
    });
    const bad = dup.includes(r.id);
    pen.group(`door:${r.id}`, DOOR.x, rowY(r.id), () => {
      pen.rect(`door:${r.id}:bg`, { width: DOOR.w, height: SHELF.rowH, rx: 8, fill: bad ? C.redBg : C.white, stroke: C.ink });
      pen.text(`door:${r.id}:t`, { x: 10, y: 21, "font-size": 14, "font-weight": 600, fill: C.ink }, `🚪 заказ ${r.id}`);
      pen.text(`door:${r.id}:got`, { x: 10, y: 42, "font-size": 13, "font-family": MONO, fill: bad ? C.red : C.ink }, marks.join(" ") || " ");
    });
  }
  // Левее своей двери, над курьерами у неё: над дверью пузырь закрыл бы соседнюю.
  if (w.client) bubble(pen, "client:say", DOOR.x - 6, rowY(w.client.row) + 3, w.client.text, 22, true);
}

function drawSql(pen: Pen, w: World): void {
  pen.rect("sql:bg", { x: 40, y: 450, width: 520, height: 250, rx: 8, fill: "#fafafa", stroke: C.line });
  pen.text("sql:title", { x: 52, y: 472, "font-size": 12, fill: C.muted }, "SQL этого кадра");
  pen.text("sql:body", { x: 52, y: 494, "font-size": 12, "font-family": MONO, fill: C.ink }, w.sql.join("\n") || " ");
}

/** Ярлык акта — тёмная плашка над стеллажом справа: формальное имя того, что показала сцена. */
function drawTerm(pen: Pen, term: string): void {
  const width = term.length * 9.4 + 28;
  pen.rect("term:bg", { x: 560, y: 92, width, height: 30, rx: 15, fill: C.ink });
  pen.text("term:t", { x: 574, y: 112, "font-size": 15, "font-family": MONO, fill: C.white }, term);
}

function drawCard(pen: Pen, text: string): void {
  const lines = text.split("\n");
  const size = lines.length > 8 ? 15 : 24;
  const height = Math.max(110, lines.length * size * 1.3 + 50);
  const top = lines.length > 4 ? 360 - height / 2 : 700 - height;
  pen.group("card", 640 - 460, top, () => {
    pen.rect("card:bg", { width: 920, height, rx: 14, fill: C.white, stroke: C.ink, "stroke-width": 2, opacity: 0.97 });
    pen.text("card:t", { x: 36, y: 30 + size, "font-size": size, "font-family": lines.length > 8 ? MONO : "inherit", fill: C.ink }, text);
  });
}

function drawArrows(pen: Pen, w: World, pos: Map<ActorId, [number, number]>): void {
  arrows(w).forEach((ar, i) => {
    const at = pos.get(ar.by);
    if (!at) return;
    const [x, y] = at;
    const shelf = { x: SHELF_END, y: rowY(ar.row) + SHELF.rowH / 2 };
    const key = `arrow:${ar.kind}:${ar.by}:${i}`;
    if (ar.kind === "wait") {
      pen.line(key, {
        x1: x + ACTOR.w / 2, y1: y, x2: shelf.x, y2: shelf.y - 10,
        stroke: C.lock, "stroke-width": 3, "stroke-dasharray": "8 6", marker: "arrow",
      });
      return;
    }
    const color = ar.kind === "duplicate" ? C.red : C.muted;
    // Путь посылки: полка → под. Стоящему вплотную к полке стрелка не нужна — и так видно.
    if (x - shelf.x > 90) {
      pen.line(`${key}:take`, {
        x1: shelf.x, y1: shelf.y, x2: x, y2: y + ACTOR.h / 2,
        stroke: color, "stroke-width": 2.5, marker: "arrow",
      });
    }
    if (ar.kind === "carry" || ar.delivery === undefined) return;
    const ty = rowY(ar.row) + 18 + ar.delivery * 16;
    pen.line(`${key}:give`, {
      x1: x + ACTOR.w, y1: y + ACTOR.h / 2, x2: DOOR.x, y2: ty,
      stroke: color, "stroke-width": 2.5, marker: "arrow",
      ...(ar.kind === "rejected" ? { "stroke-dasharray": "4 4" } : {}),
    });
  });
}

export function render(pen: Pen, w: World): void {
  // Шапка: кладовщик, табличка, часы.
  pen.rect("db:box", { x: 40, y: 20, width: 170, height: 56, rx: 10, fill: C.box, stroke: C.ink });
  pen.text("db:name", { x: 54, y: 55, "font-size": 18, "font-weight": 600, fill: C.ink }, "🐘 Postgres");
  if (w.db) bubble(pen, "db:say", 225, 80, w.db, 46);
  pen.rect("rc:plate", { x: 760, y: 26, width: 190, height: 34, rx: 4, fill: "#eef3f8", stroke: C.line });
  pen.text("rc:t", { x: 774, y: 49, "font-size": 14, "font-family": MONO, fill: C.ink }, "READ COMMITTED");
  pen.text("clock", { x: 990, y: 50, "font-size": 22, "font-family": MONO, fill: C.ink }, `🕐 ${clock(w.clock)}`);

  // Стеллаж.
  COLS.forEach((col, i) =>
    pen.text(`hdr:${i}`, { x: SHELF.x + col.x + 10, y: SHELF.y - 12, "font-size": 13, "font-family": MONO, fill: C.muted }, col.title));
  for (const r of w.rows) drawRow(pen, w, r);

  if (w.term) drawTerm(pen, w.term);
  drawSql(pen, w);
  drawDoors(pen, w);

  const pos = positions(w);
  drawArrows(pen, w, pos); // под фигурами: линия уходит за чужой бокс, а не перечёркивает его
  for (const [id, [x, y]] of pos) drawActor(pen, w, w.actors[id], x, y);
  for (const [id, [x, y]] of pos) {
    const a = w.actors[id];
    if (a.say) bubble(pen, `say:${id}`, x, y - 2, a.say);
  }

  if (w.card) drawCard(pen, w.card);
}
