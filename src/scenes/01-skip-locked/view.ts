import type { Pen } from "../../engine/contract";
import { clock } from "./script";
import {
  ACTORS, LEASE_TTL, duplicates, stuckRows, waitingFor, type Actor, type ActorId, type Focus, type Lamp, type Row, type World,
} from "./sim";

// MVP-отрисовка: серые фигуры и подписи. Полировка — после утверждения сюжета.
// Поды стоят на месте; что они делают, говорят стрелки и цвет — только из состояния кадра.

const C = {
  ink: "#222", muted: "#888", box: "#e4e4e4", line: "#999", white: "#fff",
  red: "#d33", redBg: "#fde2e2", green: "#2e9d5a", greenBg: "#dcf1e3", yellow: "#e0b000",
  draft: "#fff1b8", work: "#e3eafc", frozen: "#c9c9c9", lock: "#b26b00",
};
const POD: Record<ActorId, { color: string; tint: string; y: number }> = {
  A: { color: "#3d7bd9", tint: "#dde8fb", y: 150 },
  B: { color: "#e08a1e", tint: "#fdeccf", y: 270 },
  C: { color: "#8e5bd0", tint: "#ece2f8", y: 390 },
};
const MONO = "ui-monospace, Menlo, Consolas, monospace";

const TABLE = { x: 40, y: 132, rowH: 46, gap: 10 };
const COLS = [
  { title: "id", x: 0, w: 50 },
  { title: "status", x: 50, w: 170 },
  { title: "claim_token", x: 220, w: 120 },
  { title: "lease_until", x: 340, w: 120 },
];
const POD_BOX = { x: 640, w: 120, h: 50 };
const MAIL = { x: 1010, y: 132, w: 240, h: 330, line0: 186, lineH: 22 };
const BOARD = { x: 620, y: 490, w: 380 };

const rowY = (id: number) => TABLE.y + (id - 1) * (TABLE.rowH + TABLE.gap);
const rowMid = (id: number) => rowY(id) + TABLE.rowH / 2;
const cols = (w: World) => (w.leaseCols ? COLS : COLS.slice(0, 2));
const tableEnd = (w: World) => TABLE.x + cols(w).reduce((x, c) => Math.max(x, c.x + c.w), 0);
const podMid = (id: ActorId) => POD[id].y + POD_BOX.h / 2;
/** Приглушить всё, о чём диктор сейчас не говорит. */
const DIM = 0.25;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const carriers = (w: World, row: number) => ACTORS.filter((id) => w.actors[id].carrying === row);

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

function drawRow(pen: Pen, w: World, r: Row, stuck: Set<number>): void {
  const seenByRace = w.race && ACTORS.some((id) => w.actors[id].seen === r.id);
  const owners = carriers(w, r.id);
  const status = r.draft && r.draft.status !== r.status ? `${r.status} → ${r.draft.status}` : r.status;
  // Цвет пода — только у закоммиченной «в работе»: незакоммиченный захват видит лишь сам под.
  const ownerTint = r.status === "in_progress" && owners.length === 1 ? POD[owners[0]].tint : null;
  const statusFill = r.draft ? C.draft : r.status === "done" ? C.greenBg : ownerTint ?? (r.status === "in_progress" ? C.work : C.white);
  const expired = r.leaseUntil !== null && r.leaseUntil < w.clock && r.status === "in_progress";
  const cells = [
    String(r.id),
    status === "done" ? "done ✓" : status,
    r.token ? `🎫${r.token}` : "—",
    r.leaseUntil !== null ? clock(r.leaseUntil) : "—",
  ];
  const width = tableEnd(w) - TABLE.x;
  pen.group(`row:${r.id}`, TABLE.x, rowY(r.id), () => {
    cols(w).forEach((col, i) => {
      const fill = i === 1 ? statusFill : i === 3 && expired ? C.redBg : C.white;
      pen.rect(`row:${r.id}:c${i}`, {
        x: col.x, width: col.w, height: TABLE.rowH, fill, stroke: C.line,
        ...(i === 1 && r.draft ? { "stroke-dasharray": "5 4" } : {}),
      });
      const tokenColor = i === 2 && r.token ? tokenOwnerColor(w, r.token) : C.ink; // талон — цветом пода, которому выдан
      pen.text(`row:${r.id}:t${i}`, { x: col.x + 10, y: 29, "font-size": 15, "font-family": MONO, fill: tokenColor }, cells[i]);
    });
    if (w.leaseCols && r.leaseUntil !== null) drawLeaseBar(pen, w, r);
    if (w.ghost?.row === r.id) {
      // Прежний токен — зачёркнутым рядом с новым: владелец сменился.
      pen.text(`row:${r.id}:ghost`, {
        x: COLS[2].x + 76, y: 28, "font-size": 11, "font-family": MONO, fill: tokenOwnerColor(w, w.ghost.token),
        "text-decoration": "line-through", opacity: 0.8,
      }, w.ghost.token);
    }
    if (stuck.has(r.id)) {
      pen.text(`row:${r.id}:stuck`, { x: -28, y: 33, "font-size": 26, "font-weight": 700, fill: C.red }, "?"); // слева, не на тексте
    }
    // 0 строк по чужому токену: талон пода рядом с талоном строки — плашкой под строкой (поверх соседней,
    // она в этот момент приглушена), а не справа, где поды и стрелки.
    const lost = w.events.find((e) => e.kind === "zero" && e.row === r.id && e.by && w.actors[e.by].token && w.actors[e.by].token !== r.token);
    if (lost?.by && r.token) {
      const loser = lost.by;
      const theirs = r.token;
      const mine = w.actors[loser].token!;
      pen.group(`row:${r.id}:vs`, COLS[2].x, TABLE.rowH + 2, () => {
        pen.rect(`row:${r.id}:vs:bg`, { width: 240, height: 30, rx: 8, fill: C.white, stroke: C.red, "stroke-width": 2 });
        pen.text(`row:${r.id}:vs:a`, { x: 10, y: 21, "font-size": 15, "font-family": MONO, fill: POD[loser].color }, `🎫${mine}`);
        pen.text(`row:${r.id}:vs:ne`, { x: 104, y: 22, "font-size": 18, "font-weight": 700, fill: C.red }, "≠");
        pen.text(`row:${r.id}:vs:b`, { x: 130, y: 21, "font-size": 15, "font-family": MONO, fill: tokenOwnerColor(w, theirs) }, `🎫${theirs}`);
      });
    }
    if (seenByRace) {
      pen.rect(`row:${r.id}:race`, {
        x: -6, y: -6, width: width + 12, height: TABLE.rowH + 12, fill: "none", stroke: C.red, "stroke-width": 4, rx: 6,
      });
    }
    if (r.lockedBy) {
      // Заперта при перепроверке, но не взята — бледный замок, чтобы не читалось «взял задачу».
      pen.text(`row:${r.id}:lock`, { x: width + 6, y: 30, "font-size": 16, fill: POD[r.lockedBy].color, opacity: r.idle ? 0.35 : 1 },
        `🔒${r.lockedBy}`);
    }
  }, fade(w, "table", `row:${r.id}`));
}

/** Цвет пода, которому выдан токен (он считает его своим); иначе — нейтральный. */
function tokenOwnerColor(w: World, token: string): string {
  const owner = ACTORS.find((id) => w.actors[id].token === token);
  return owner ? POD[owner].color : C.ink;
}

/** Полоса срока под ячейками токена и срока: от захвата до дедлайна (зелёная) и после (красная),
 *  курсор «сейчас» по часам БД, метка «✓», когда держатель проверял срок. */
function drawLeaseBar(pen: Pen, w: World, r: Row): void {
  const x0 = COLS[2].x + 6;
  const len = COLS[3].x + COLS[3].w - 6 - x0;
  const t0 = r.leaseUntil! - LEASE_TTL;
  const span = LEASE_TTL * 1.5;
  const at = (t: number) => x0 + Math.max(0, Math.min(1, (t - t0) / span)) * len;
  const deadline = at(r.leaseUntil!);
  pen.rect(`row:${r.id}:bar:ok`, { x: x0, y: 37, width: deadline - x0, height: 5, fill: C.green, opacity: 0.6 });
  pen.rect(`row:${r.id}:bar:late`, { x: deadline, y: 37, width: x0 + len - deadline, height: 5, fill: C.red, opacity: 0.6 });
  pen.group(`row:${r.id}:now`, at(w.clock), 32, () => {
    pen.rect(`row:${r.id}:now:mark`, { x: -1, width: 3, height: 14, fill: C.ink });
  });
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (a.checkedAt === null || a.carrying !== r.id || a.token !== r.token) continue; // проверял именно эту аренду
    // Под полосой: курсор «сейчас» стоит в той же точке, пока проверка только что была.
    pen.text(`row:${r.id}:check:${id}`, { x: at(a.checkedAt) - 5, y: 55, "font-size": 13, "font-weight": 700, fill: POD[id].color }, "✓");
  }
}

function drawTable(pen: Pen, w: World): void {
  cols(w).forEach((col, i) =>
    pen.text(`hdr:${i}`, { x: TABLE.x + col.x + 10, y: TABLE.y - 10, "font-size": 13, "font-family": MONO, fill: C.muted }, col.title));
  const left = w.rows.filter((r) => r.status !== "done").length;
  pen.text("left", { ...fade(w, "table"), x: TABLE.x, y: 98, "font-size": 15, "font-weight": 600, fill: left ? C.ink : C.green },
    left ? `осталось ${left} из ${w.rows.length}` : `осталось 0 из ${w.rows.length} ✓`);
  const stuck = new Set(stuckRows(w));
  for (const r of w.rows) drawRow(pen, w, r, stuck);
}

function podStatus(w: World, a: Actor): string {
  const parts: string[] = [];
  if (w.events.some((e) => e.kind === "zero" && e.by === a.id)) parts.push("✕ 0 строк");
  if (a.mutex) parts.push("🔒mu");
  if (a.scan?.waitingFor != null) parts.push(`⏳${w.clock - a.scan.since}с`);
  else if (a.pending) parts.push("⏳");
  if (a.token) parts.push(`🎫${a.token}`);
  if (a.frozen) parts.push("💤");
  return parts.join(" ");
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const p = POD[a.id];
  pen.group(`pod:${a.id}`, POD_BOX.x, p.y, () => {
    if (!a.present) {
      pen.rect(`pod:${a.id}:body`, { width: POD_BOX.w, height: POD_BOX.h, rx: 12, fill: "none", stroke: C.muted, "stroke-dasharray": "6 5" });
      pen.text(`pod:${a.id}:name`, { x: 10, y: 30, "font-size": 14, fill: C.muted }, `${a.label} · упал`);
      return;
    }
    const waiting = waitingFor(a) !== null;
    pen.rect(`pod:${a.id}:body`, {
      width: POD_BOX.w, height: POD_BOX.h, rx: 12,
      fill: a.frozen ? C.frozen : C.white, stroke: waiting ? C.lock : p.color, "stroke-width": 3,
    });
    pen.text(`pod:${a.id}:name`, { x: 10, y: 20, "font-size": 14, "font-weight": 600, fill: p.color }, a.label);
    pen.text(`pod:${a.id}:st`, { x: 10, y: 40, "font-size": 13, fill: a.token ? p.color : C.ink }, podStatus(w, a));
    if (a.frozen) pen.text(`pod:${a.id}:zz`, { x: POD_BOX.w - 18, y: -6, "font-size": 24 }, "💤"); // завис — видно издалека
  }, fade(w, a.id));
}

/** Стрелки пода к таблице: смотрит, взял, ждёт замок, пропустил занятую. */
function drawPodArrows(pen: Pen, w: World): void {
  const end = tableEnd(w) + 40; // правее замков у строк
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (!a.present) continue;
    const from = { x: POD_BOX.x, y: podMid(id) };
    const op = fade(w, id).opacity;
    const wait = waitingFor(a);
    if (wait !== null) {
      pen.line(`arr:${id}:wait`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(wait),
        stroke: C.lock, "stroke-width": 3, "stroke-dasharray": "8 6", marker: "arrow", opacity: op,
      });
    } else if (a.carrying !== null) {
      pen.line(`arr:${id}:hold`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(a.carrying),
        stroke: POD[id].color, "stroke-width": 3, marker: "arrow", opacity: op,
      });
    } else if (a.seen !== null) {
      pen.line(`arr:${id}:look`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(a.seen),
        stroke: C.muted, "stroke-width": 1.5, marker: "arrow", opacity: op,
      });
    }
  }
  // Пропустил занятую (SKIP LOCKED): дуга-перескок у строки, вниз к следующей.
  const drawn = new Set<string>(); // повторные пропуски той же строки тем же подом — одной дугой
  w.events.forEach((e, i) => {
    if (e.kind !== "skip" || e.row === undefined || !e.by || drawn.has(`${e.by}:${e.row}`)) return;
    drawn.add(`${e.by}:${e.row}`);
    const x = end + 8 + ACTORS.indexOf(e.by) * 16;
    const y = rowMid(e.row);
    pen.path(`arr:skip:${i}`, {
      d: `M ${x} ${y - 8} Q ${x + 34} ${y + 20} ${x} ${y + 44}`,
      stroke: POD[e.by].color, "stroke-width": 2.5, marker: "arrow", ...fade(w, e.by),
    });
  });
}

/** Почта: журнал писем; дубль — красным, повтор с ключом — ↺ серым. */
function drawMail(pen: Pen, w: World): void {
  pen.group("mail", 0, 0, () => drawMailBody(pen, w), fade(w, "mail"));
  drawMailArrows(pen, w); // вне группы: прозрачности вложенных групп перемножаются
}

/** Письма этого кадра: стрелка под → строка журнала; яркая, если в фокусе Почта или отправитель. */
function drawMailArrows(pen: Pen, w: World): void {
  w.events.forEach((e, i) => {
    if ((e.kind !== "send" && e.kind !== "replay") || e.row === undefined || !e.by) return;
    let line = -1;
    w.letters.forEach((l, j) => {
      if (l.row === e.row && l.by === e.by) line = j;
    });
    const dupNow = w.events.some((x) => x.kind === "duplicate" && x.row === e.row && x.by === e.by);
    const color = e.kind === "replay" ? C.muted : dupNow ? C.red : POD[e.by].color;
    pen.line(`arr:mail:${i}`, {
      x1: POD_BOX.x + POD_BOX.w, y1: podMid(e.by), x2: MAIL.x - 4, y2: MAIL.line0 - 5 + line * MAIL.lineH,
      stroke: color, "stroke-width": 2.5, marker: "arrow",
      ...(e.kind === "replay" ? { "stroke-dasharray": "4 4" } : {}),
      ...fade(w, "mail", e.by),
    });
  });
}

function drawMailBody(pen: Pen, w: World): void {
  const dup = duplicates(w);
  pen.rect("mail:bg", { x: MAIL.x, y: MAIL.y, width: MAIL.w, height: MAIL.h, rx: 8, fill: dup.length ? C.redBg : C.white, stroke: C.ink });
  pen.text("mail:title", { x: MAIL.x + 14, y: MAIL.y + 28, "font-size": 16, "font-weight": 600, fill: C.ink }, "📨 Почта");
  const sent = new Set<number>();
  w.letters.forEach((l, i) => {
    const again = sent.has(l.row);
    if (!l.replayed) sent.add(l.row);
    const key = l.keyed ? " 🔑" : "";
    const text = l.replayed ? `заказ ${l.row}${key} ↺ повтор` : again ? `заказ ${l.row} ✉ ДУБЛЬ` : `заказ ${l.row} ✉${key}`;
    const fill = l.replayed ? C.muted : again ? C.red : C.ink;
    pen.text(`mail:l${i}`, { x: MAIL.x + 14, y: MAIL.line0 + i * MAIL.lineH, "font-size": 14, "font-family": MONO, fill }, text);
  });
  if (w.mail) bubble(pen, "mail:say", MAIL.x + MAIL.w, MAIL.y - 4, w.mail, 26, true);

}

const LAMP: Record<Lamp, string> = { red: C.red, yellow: C.yellow, green: C.green };

/** Табло главы: попытки сверху вниз, у каждой две лампы по критериям. */
function drawBoard(pen: Pen, w: World): void {
  if (w.board) pen.group("board", 0, 0, () => drawBoardBody(pen, w), fade(w, "board"));
}

function drawBoardBody(pen: Pen, w: World): void {
  const b = w.board!;
  const lampX = [BOARD.x + 230, BOARD.x + 320];
  const height = 40 + b.attempts.length * 24;
  pen.rect("board:bg", { x: BOARD.x, y: BOARD.y, width: BOARD.w, height, rx: 8, fill: "#fafafa", stroke: C.line });
  b.criteria.forEach((c, i) =>
    pen.text(`board:h${i}`, { x: lampX[i] + 8, y: BOARD.y + 20, "font-size": 12, fill: C.muted, "text-anchor": "middle" }, c));
  b.attempts.forEach((t, i) => {
    const y = BOARD.y + 30 + i * 24;
    const current = i === b.attempts.length - 1;
    pen.text(`board:n${i}`, { x: BOARD.x + 12, y: y + 13, "font-size": 12, "font-family": MONO, fill: C.ink, "font-weight": current ? 700 : 400 }, t.name);
    lampX.forEach((x, j) => {
      const lamp = t.lamps?.[j];
      pen.rect(`board:l${i}:${j}`, {
        x, y, width: 16, height: 16, rx: 8,
        fill: lamp ? LAMP[lamp] : C.white, stroke: lamp ? LAMP[lamp] : C.line, "stroke-dasharray": lamp ? "0" : "3 3",
      });
    });
  });
}

/** Ярлык акта — тёмная плашка над подами: формальное имя того, что показала сцена. */
function drawTerm(pen: Pen, term: string): void {
  const width = term.length * 9.4 + 28;
  pen.rect("term:bg", { x: POD_BOX.x, y: 92, width, height: 30, rx: 15, fill: C.ink });
  pen.text("term:t", { x: POD_BOX.x + 14, y: 112, "font-size": 15, "font-family": MONO, fill: C.white }, term);
}

function drawSql(pen: Pen, w: World): void {
  pen.group("sql", 0, 0, () => drawSqlBody(pen, w), fade(w, "sql"));
}

function drawSqlBody(pen: Pen, w: World): void {
  pen.rect("sql:bg", { x: 40, y: 490, width: 540, height: 210, rx: 8, fill: "#fafafa", stroke: C.line });
  pen.text("sql:title", { x: 52, y: 510, "font-size": 12, fill: C.muted }, "SQL этого кадра");
  pen.text("sql:body", { x: 52, y: 530, "font-size": 12, "font-family": MONO, fill: C.ink }, w.sql.join("\n") || " ");
}

/** Титр — слева поверх SQL-панели, табло не закрывает. */
function drawCard(pen: Pen, text: string): void {
  const lines = text.split("\n");
  const size = 19;
  const height = Math.max(90, lines.length * size * 1.3 + 50);
  pen.group("card", 40, 700 - height, () => {
    pen.rect("card:bg", { width: 540, height, rx: 14, fill: C.white, stroke: C.ink, "stroke-width": 2, opacity: 0.97 });
    pen.text("card:t", { x: 36, y: 30 + size, "font-size": size, fill: C.ink }, text);
  });
}

/** Штамп перехода: мир перемотан («⟲ вернёмся…»). Полоса внизу кадра. */
function drawStamp(pen: Pen, text: string): void {
  pen.rect("stamp:bg", { x: 0, y: 652, width: 1280, height: 48, fill: C.ink, opacity: 0.88 }); // внизу: поды и таблица видны
  pen.text("stamp:t", { x: 640, y: 684, "font-size": 22, "font-weight": 600, fill: C.white, "text-anchor": "middle" }, text);
}

/** Плашка главы во весь экран: номер кейса и его вопрос. */
function drawPlate(pen: Pen, text: string): void {
  const [head, ...rest] = text.split("\n");
  pen.rect("plate:bg", { x: 0, y: 0, width: 1280, height: 720, fill: C.ink, opacity: 0.94 });
  pen.text("plate:head", { x: 640, y: 300, "font-size": 26, fill: "#bbb", "text-anchor": "middle", "letter-spacing": 4 }, head);
  pen.text("plate:q", { x: 640, y: 370, "font-size": 40, "font-weight": 700, fill: C.white, "text-anchor": "middle" }, rest.join("\n"));
}

export function render(pen: Pen, w: World): void {
  // Шапка: кладовщик, номер кейса, табличка, часы.
  pen.rect("db:box", { x: 40, y: 20, width: 170, height: 56, rx: 10, fill: C.box, stroke: C.ink });
  pen.text("db:name", { x: 54, y: 55, "font-size": 18, "font-weight": 600, fill: C.ink }, "🐘 Postgres");
  if (w.chapter) {
    pen.rect("chapter:bg", { x: POD_BOX.x, y: 26, width: 96, height: 34, rx: 17, fill: "none", stroke: C.ink, "stroke-width": 1.5 });
    pen.text("chapter:t", { x: POD_BOX.x + 48, y: 49, "font-size": 15, "font-weight": 600, fill: C.ink, "text-anchor": "middle" }, `КЕЙС ${w.chapter}`);
  }
  pen.rect("rc:plate", { x: 760, y: 26, width: 190, height: 34, rx: 4, fill: "#eef3f8", stroke: C.line });
  pen.text("rc:t", { x: 774, y: 49, "font-size": 14, "font-family": MONO, fill: C.ink }, "READ COMMITTED");
  pen.text("clock", { x: 990, y: 50, "font-size": 22, "font-family": MONO, fill: C.ink, ...fade(w, "clock") }, `🕐 ${clock(w.clock)}`);

  drawTable(pen, w);
  if (w.term) drawTerm(pen, w.term);
  drawSql(pen, w);
  drawBoard(pen, w);
  drawPodArrows(pen, w); // под фигурами: линия уходит за бокс, а не перечёркивает его
  drawMail(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (a.present && a.say) bubble(pen, `say:${id}`, POD_BOX.x + POD_BOX.w + 8, POD[id].y + POD_BOX.h, a.say);
  }

  if (w.card) drawCard(pen, w.card);
  if (w.plate) drawPlate(pen, w.plate);
  if (w.stamp) drawStamp(pen, w.stamp);
  if (w.db) bubble(pen, "db:say", 225, 80, w.db, 46); // поверх плашки: кладовщик комментирует и её
}
