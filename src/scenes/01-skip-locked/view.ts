import { STAGE, type Attrs, type Pen, type Span } from "../../engine/contract";
import { icon, type IconName } from "../../kit/icons";
import { highlightSql } from "../../kit/sql";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { bubble, lamp, panel, pill, plate, sqlWindow } from "../../kit/widgets";
import { clock } from "./script";
import {
  ACTORS, LEASE_TTL, duplicates, stuckRows, waitingFor, type Actor, type ActorId, type Focus, type Row, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки, цвет и значки — только из состояния кадра.
// Сетка (1280×720): шапка сверху; слева таблица и окно SQL; в центре поды; справа Почта и табло.
// Ниже SAFE_BOTTOM (kit/theme) — место плеера под подпись и субтитры.

const POD_Y: Record<ActorId, number> = { A: 128, B: 244, C: 360 };
const POD = { x: 720, w: 188, h: 64 };
const TABLE = { x: 40, y: 130, rowH: 40, gap: 6 };
const COLS = [
  { title: "id", x: 0, w: 50 },
  { title: "status", x: 50, w: 210 },
  { title: "claim_token", x: 260, w: 150 },
  { title: "lease_until", x: 410, w: 130 },
];
const MAIL = { x: 968, y: 130, w: 272, h: 270, line0: 202, lineH: 28 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const BOTTOM = 650; // низ титра и окна SQL

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };

const rowY = (id: number) => TABLE.y + (id - 1) * (TABLE.rowH + TABLE.gap);
const rowMid = (id: number) => rowY(id) + TABLE.rowH / 2;
const cols = (w: World) => (w.leaseCols ? COLS : COLS.slice(0, 2));
const tableEnd = (w: World) => TABLE.x + cols(w).reduce((x, c) => Math.max(x, c.x + c.w), 0);
const podMid = (id: ActorId) => POD_Y[id] + POD.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const carriers = (w: World, row: number) => ACTORS.filter((id) => w.actors[id].carrying === row);

/** Иконка + текст в строку; (x, y) — базовая линия текста. Возвращает правый край. */
function iconText(pen: Pen, key: string, name: IconName, x: number, y: number, text: string, color: string, attrs: Attrs = SANS): number {
  const size = 20;
  icon(pen, `${key}:i`, name, x, y - 16, size, color);
  if (!text) return x + size;
  pen.text(`${key}:t`, { x: x + size + 5, y, fill: color, ...attrs }, text);
  return x + size + 5 + pen.measure(text, attrs).width;
}

function drawRow(pen: Pen, w: World, r: Row, stuck: Set<number>): void {
  const seenByRace = w.race && ACTORS.some((id) => w.actors[id].seen === r.id);
  const owners = carriers(w, r.id);
  const status = r.draft && r.draft.status !== r.status ? `${r.status} → ${r.draft.status}` : r.status;
  // Цвет пода — только у закоммиченной «в работе»: незакоммиченный захват видит лишь сам под.
  const ownerTint = r.status === "in_progress" && owners.length === 1 ? ACTOR[owners[0]].tint : null;
  const statusFill = r.draft ? "#3b3720" : r.status === "done" ? "#163a33" : ownerTint ?? (r.status === "in_progress" ? COLOR.surface2 : COLOR.surface);
  const expired = r.leaseUntil !== null && r.leaseUntil < w.clock && r.status === "in_progress";
  const width = tableEnd(w) - TABLE.x;
  const base = 26; // базовая линия текста в строке
  pen.group(`row:${r.id}`, TABLE.x, rowY(r.id), () => {
    cols(w).forEach((col, i) => {
      const fill = i === 1 ? statusFill : i === 3 && expired ? "#4a1f2a" : COLOR.surface;
      pen.rect(`row:${r.id}:c${i}`, {
        x: col.x, width: col.w, height: TABLE.rowH, fill, stroke: i === 1 && r.draft ? COLOR.warn : COLOR.line, "stroke-width": 1.5,
        ...(i === 1 && r.draft ? { "stroke-dasharray": "6 4" } : {}),
      });
    });
    pen.text(`row:${r.id}:id`, { x: 14, y: base, fill: COLOR.muted, ...MONO }, String(r.id));
    if (status === "done") iconText(pen, `row:${r.id}:st`, "check", COLS[1].x + 10, base, "done", COLOR.ok, MONO);
    else pen.text(`row:${r.id}:st`, { x: COLS[1].x + 12, y: base, fill: COLOR.ink, ...MONO }, status);
    if (w.leaseCols) {
      // Талон — цветом пода, которому выдан.
      if (r.token) iconText(pen, `row:${r.id}:tok`, "ticket", COLS[2].x + 10, base, r.token, tokenOwnerColor(w, r.token), MONO);
      else pen.text(`row:${r.id}:tok`, { x: COLS[2].x + 12, y: base, fill: COLOR.faint, ...MONO }, "—");
      pen.text(`row:${r.id}:lease`, { x: COLS[3].x + 12, y: base, fill: expired ? COLOR.error : COLOR.ink, ...MONO },
        r.leaseUntil !== null ? clock(r.leaseUntil) : "—");
      if (r.leaseUntil !== null) drawLeaseBar(pen, w, r);
    }
    if (w.ghost?.row === r.id) {
      // Прежний токен — зачёркнутым рядом с новым: владелец сменился.
      pen.text(`row:${r.id}:ghost`, {
        x: COLS[2].x + 92, y: base, ...MONO, fill: tokenOwnerColor(w, w.ghost.token), "text-decoration": "line-through", opacity: 0.75,
      }, w.ghost.token);
    }
    if (stuck.has(r.id)) icon(pen, `row:${r.id}:stuck`, "question", -34, 8, 26, COLOR.error); // слева, не на тексте
    // 0 строк по чужому токену: талон пода рядом с талоном строки — плашкой под строкой (поверх соседней,
    // она в этот момент приглушена), а не справа, где поды и стрелки.
    const lost = w.events.find((e) => e.kind === "zero" && e.row === r.id && e.by && w.actors[e.by].token && w.actors[e.by].token !== r.token);
    if (lost?.by && r.token) {
      const loser = lost.by;
      const mine = w.actors[loser].token!;
      pen.group(`row:${r.id}:vs`, COLS[2].x - 20, TABLE.rowH + 3, () => {
        panel(pen, `row:${r.id}:vs`, { x: 0, y: 0, w: 230, h: 36, rx: 10, fill: COLOR.surface2, stroke: COLOR.error });
        iconText(pen, `row:${r.id}:vs:a`, "ticket", 12, 25, mine, ACTOR[loser].color, MONO);
        pen.text(`row:${r.id}:vs:ne`, { x: 104, y: 26, ...SANS, "font-size": 22, "font-weight": 700, fill: COLOR.error }, "≠");
        iconText(pen, `row:${r.id}:vs:b`, "ticket", 128, 25, r.token!, tokenOwnerColor(w, r.token!), MONO);
      });
    }
    if (seenByRace) {
      pen.rect(`row:${r.id}:race`, {
        x: -6, y: -5, width: width + 12, height: TABLE.rowH + 10, fill: "none", stroke: COLOR.error, "stroke-width": 3, rx: 8,
      });
    }
    if (r.lockedBy) {
      // Заперта при перепроверке, но не взята — бледный замок, чтобы не читалось «взял задачу».
      icon(pen, `row:${r.id}:lock`, "lock", width + 8, 8, 24, ACTOR[r.lockedBy].color, { opacity: r.idle ? 0.4 : 1 });
    }
  }, fade(w, "table", `row:${r.id}`));
}

/** Цвет пода, которому выдан токен (он считает его своим); иначе — нейтральный. */
function tokenOwnerColor(w: World, token: string): string {
  const owner = ACTORS.find((id) => w.actors[id].token === token);
  return owner ? ACTOR[owner].color : COLOR.ink;
}

/** Полоса срока по низу ячеек токена и срока: от захвата до дедлайна (зелёная) и после (красная),
 *  курсор «сейчас» по часам БД, значок ✓ цвета пода, когда держатель проверял срок. */
function drawLeaseBar(pen: Pen, w: World, r: Row): void {
  const x0 = COLS[2].x + 8;
  const len = COLS[3].x + COLS[3].w - 8 - x0;
  const t0 = r.leaseUntil! - LEASE_TTL;
  const span = LEASE_TTL * 1.5;
  const at = (t: number) => x0 + Math.max(0, Math.min(1, (t - t0) / span)) * len;
  const deadline = at(r.leaseUntil!);
  const y = TABLE.rowH - 6;
  pen.rect(`row:${r.id}:bar:ok`, { x: x0, y, width: deadline - x0, height: 4, rx: 2, fill: COLOR.ok, opacity: 0.8 });
  pen.rect(`row:${r.id}:bar:late`, { x: deadline, y, width: x0 + len - deadline, height: 4, rx: 2, fill: COLOR.error, opacity: 0.8 });
  pen.group(`row:${r.id}:now`, at(w.clock), y - 6, () => {
    pen.rect(`row:${r.id}:now:mark`, { x: -1.5, width: 3, height: 16, rx: 1.5, fill: COLOR.ink });
  });
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (a.checkedAt === null || a.carrying !== r.id || a.token !== r.token) continue; // проверял именно эту аренду
    const cx = at(a.checkedAt);
    pen.group(`row:${r.id}:check:${id}`, cx, y + 2, () => {
      pen.rect(`row:${r.id}:check:${id}:bg`, { x: -10, y: -10, width: 20, height: 20, rx: 10, fill: ACTOR[id].color });
      icon(pen, `row:${r.id}:check:${id}:i`, "check", -8, -8, 16, COLOR.bg);
    });
  }
}

function drawTable(pen: Pen, w: World): void {
  cols(w).forEach((col, i) =>
    pen.text(`hdr:${i}`, { x: TABLE.x + col.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "table") }, col.title));
  const left = w.rows.filter((r) => r.status !== "done").length;
  const label = `осталось ${left} из ${w.rows.length}`;
  pen.group("left", 0, 0, () => {
    if (left) pen.text("left:t", { x: TABLE.x, y: 94, ...SANS, "font-weight": 600, fill: COLOR.ink }, label);
    else iconText(pen, "left", "check", TABLE.x, 94, label, COLOR.ok, { ...SANS, "font-weight": 600 });
  }, fade(w, "table"));
  const stuck = new Set(stuckRows(w));
  for (const r of w.rows) drawRow(pen, w, r, stuck);
}

/** Значки состояния пода под именем: 0 строк, мьютекс, ждёт, талон, завис. */
function drawPodStatus(pen: Pen, w: World, a: Actor): void {
  const color = ACTOR[a.id].color;
  const items: [IconName, string, string][] = [];
  if (w.events.some((e) => e.kind === "zero" && e.by === a.id)) items.push(["cross", "0 строк", COLOR.error]);
  if (a.mutex) items.push(["lock", "mu", color]);
  if (a.scan?.waitingFor != null) items.push(["hourglass", `${w.clock - a.scan.since} с`, color]);
  else if (a.pending) items.push(["hourglass", "", color]);
  if (a.token) items.push(["ticket", a.token, color]);
  let x = 14;
  items.forEach(([name, text, c], i) => {
    x = iconText(pen, `pod:${a.id}:st${i}`, name, x, 52, text, c, text === a.token ? MONO : SANS) + 10;
  });
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const color = ACTOR[a.id].color;
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    if (!a.present) {
      pen.rect(`pod:${a.id}:body`, { width: POD.w, height: POD.h, rx: 18, fill: "none", stroke: COLOR.faint, "stroke-width": 2, "stroke-dasharray": "7 6" });
      pen.text(`pod:${a.id}:name`, { x: 16, y: 39, ...SANS, fill: COLOR.muted }, `${a.label} · упал`);
      return;
    }
    // Ожидание — пунктир цвета пода и песочные часы в строке состояния.
    const waiting = waitingFor(a) !== null;
    panel(pen, `pod:${a.id}:body`, {
      x: 0, y: 0, w: POD.w, h: POD.h, rx: 18,
      fill: a.frozen ? "#262b40" : COLOR.surface, stroke: a.frozen ? COLOR.faint : color,
      attrs: { "stroke-width": 3, ...(waiting ? { "stroke-dasharray": "8 6" } : {}) },
    });
    pen.text(`pod:${a.id}:name`, { x: 14, y: 26, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: a.frozen ? COLOR.muted : color }, a.label);
    drawPodStatus(pen, w, a);
    if (a.frozen) icon(pen, `pod:${a.id}:zz`, "sleep", POD.w - 30, -22, 34, COLOR.muted); // завис — видно издалека
  }, fade(w, a.id));
}

/** Стрелки пода к таблице: смотрит, взял, ждёт замок, пропустил занятую. */
function drawPodArrows(pen: Pen, w: World): void {
  const end = tableEnd(w) + 44; // правее замков у строк
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (!a.present) continue;
    const from = { x: POD.x - 4, y: podMid(id) };
    const op = fade(w, id).opacity;
    const color = ACTOR[id].color;
    const wait = waitingFor(a);
    if (wait !== null) {
      pen.line(`arr:${id}:wait`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(wait),
        stroke: color, "stroke-width": 3, "stroke-dasharray": "9 7", "stroke-linecap": "round", marker: "arrow", opacity: op,
      });
    } else if (a.carrying !== null) {
      pen.line(`arr:${id}:hold`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(a.carrying),
        stroke: color, "stroke-width": 3.5, "stroke-linecap": "round", marker: "arrow", opacity: op,
      });
    } else if (a.seen !== null) {
      pen.line(`arr:${id}:look`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(a.seen),
        stroke: COLOR.muted, "stroke-width": 2, "stroke-linecap": "round", marker: "arrow", opacity: op,
      });
    }
  }
  // Пропустил занятую (SKIP LOCKED): дуга-перескок у строки, вниз к следующей.
  const drawn = new Set<string>(); // повторные пропуски той же строки тем же подом — одной дугой
  w.events.forEach((e, i) => {
    if (e.kind !== "skip" || e.row === undefined || !e.by || drawn.has(`${e.by}:${e.row}`)) return;
    drawn.add(`${e.by}:${e.row}`);
    const x = end + 6 + ACTORS.indexOf(e.by) * 14;
    const y = rowMid(e.row);
    pen.path(`arr:skip:${i}`, {
      d: `M ${x} ${y - 8} Q ${x + 30} ${y + 15} ${x} ${y + 38}`,
      stroke: ACTOR[e.by].color, "stroke-width": 2.5, "stroke-linecap": "round", marker: "arrow", ...fade(w, e.by),
    });
  });
}

/** Почта: журнал писем; дубль — красным, повтор с ключом — значком ↺ и серым. */
function drawMail(pen: Pen, w: World): void {
  drawMailArrows(pen, w); // под Почтой: стрелка упирается в журнал, а не перечёркивает его
  pen.group("mail", 0, 0, () => drawMailBody(pen, w), fade(w, "mail"));
  // Реплика Почты — в журнале, хвостом к последнему письму: ответ про него.
  if (w.mail) {
    const y = mailLineY(Math.max(0, w.letters.length - 1)) + 10;
    pen.layer("top", () => bubble(pen, "mail:say", w.mail!, { x: MAIL.x + MAIL.w - 60, y, tail: "up", align: "end" }));
  }
}

const mailLineY = (i: number) => MAIL.line0 + i * MAIL.lineH;

/** Письма этого кадра: стрелка под → строка журнала; яркая, если в фокусе Почта или отправитель. */
function drawMailArrows(pen: Pen, w: World): void {
  w.events.forEach((e, i) => {
    if ((e.kind !== "send" && e.kind !== "replay") || e.row === undefined || !e.by) return;
    let line = -1;
    w.letters.forEach((l, j) => {
      if (l.row === e.row && l.by === e.by) line = j;
    });
    const dupNow = w.events.some((x) => x.kind === "duplicate" && x.row === e.row && x.by === e.by);
    const color = e.kind === "replay" ? COLOR.muted : dupNow ? COLOR.error : ACTOR[e.by].color;
    pen.line(`arr:mail:${i}`, {
      x1: POD.x + POD.w + 4, y1: podMid(e.by), x2: MAIL.x - 6, y2: mailLineY(line) - 6,
      stroke: color, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow",
      ...(e.kind === "replay" ? { "stroke-dasharray": "5 6" } : {}),
      ...fade(w, "mail", e.by),
    });
  });
}

function drawMailBody(pen: Pen, w: World): void {
  const dup = duplicates(w);
  panel(pen, "mail:box", { x: MAIL.x, y: MAIL.y, w: MAIL.w, h: MAIL.h, fill: dup.length ? "#3a1c2a" : COLOR.surface, stroke: dup.length ? COLOR.error : COLOR.mail });
  iconText(pen, "mail:title", "mail", MAIL.x + 16, MAIL.y + 38, "Почта", COLOR.mail, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
  pen.rect("mail:rule", { x: MAIL.x + 16, y: MAIL.y + 52, width: MAIL.w - 32, height: 1.5, fill: COLOR.line });
  const sent = new Set<number>();
  w.letters.forEach((l, i) => {
    const again = sent.has(l.row);
    if (!l.replayed) sent.add(l.row);
    const y = mailLineY(i);
    const fill = l.replayed ? COLOR.muted : again ? COLOR.error : COLOR.ink;
    const key = `mail:l${i}`;
    let x = iconText(pen, key, l.replayed ? "replay" : "mail", MAIL.x + 16, y, `заказ ${l.row}`, fill, MONO) + 8;
    if (l.keyed) {
      icon(pen, `${key}:key`, "key", x, y - 16, 20, COLOR.warn);
      x += 28;
    }
    if (l.replayed) pen.text(`${key}:note`, { x, y, ...SANS, fill }, "повтор");
    else if (again) pen.text(`${key}:note`, { x, y, ...SANS, "font-weight": 700, fill }, "ДУБЛЬ");
  });
}

/** Табло главы: попытки сверху вниз, у каждой две лампы по критериям. */
function drawBoard(pen: Pen, w: World): void {
  if (w.board) pen.group("board", 0, 0, () => drawBoardBody(pen, w), fade(w, "board"));
}

function drawBoardBody(pen: Pen, w: World): void {
  const b = w.board!;
  const lampX = [BOARD.x + 290, BOARD.x + 425];
  const height = 46 + b.attempts.length * BOARD.rowH + 8;
  panel(pen, "board:box", { x: BOARD.x, y: BOARD.y, w: BOARD.w, h: height });
  b.criteria.forEach((c, i) =>
    pen.text(`board:h${i}`, { x: lampX[i], y: BOARD.y + 30, ...SANS, fill: COLOR.muted, "text-anchor": "middle" }, c));
  b.attempts.forEach((t, i) => {
    const y = BOARD.y + 46 + i * BOARD.rowH;
    const current = i === b.attempts.length - 1;
    pen.text(`board:n${i}`, { x: BOARD.x + 18, y: y + 18, ...SANS, fill: current ? COLOR.ink : COLOR.muted, "font-weight": current ? 700 : 400 }, t.name);
    lampX.forEach((x, j) => lamp(pen, `board:l${i}:${j}`, x, y + 12, t.lamps?.[j] ?? null, 9));
  });
}

function drawSql(pen: Pen, w: World): void {
  if (!w.sql.length) return; // SQL — только там, где его надо прочитать
  // Префикс «Pod A ▸» — цветом пода, сам запрос — с подсветкой.
  const lines: Span[][] = w.sql.flatMap((entry) => {
    const [first, ...rest] = entry.split("\n");
    const m = /^(Pod ([ABC])) ▸ (.*)$/.exec(first);
    const head: Span[] = m
      ? [{ text: `${m[1]} ▸ `, attrs: { fill: ACTOR[m[2] as ActorId].color, "font-weight": 700 } }, ...highlightSql(m[3])]
      : highlightSql(first);
    return [head, ...rest.map((line) => highlightSql(line))];
  });
  sqlWindow(pen, "sql", lines, { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") });
}

/** Титр — слева над окном SQL, табло не закрывает. */
function drawCard(pen: Pen, text: string): void {
  const font = { ...SANS, "font-size": 22, "font-weight": 600 };
  const m = pen.measure(text, font);
  const h = Math.max(80, m.height + 48);
  const wdt = Math.max(420, m.width + 64);
  pen.group("card", TABLE.x, BOTTOM - h, () => {
    panel(pen, "card", { x: 0, y: 0, w: wdt, h, fill: COLOR.surface2, stroke: COLOR.ink, rx: 16 });
    pen.text("card:t", { x: 32, y: 24 + 22 * 0.8 + (h - 48 - m.height) / 2, ...font, fill: COLOR.ink }, text);
  });
}

/** Штамп перехода: мир перемотан («⟲ вернёмся…»). Пилюля в просвете между подами и табло. */
function drawStamp(pen: Pen, text: string): void {
  const label = text.replace(/^⟲\s*/, "");
  const font = { ...SANS, "font-size": SIZE.say, "font-weight": 700 };
  const wdt = pen.measure(label, font).width + 84;
  const x = MAIL.x + MAIL.w - wdt;
  pen.group("stamp", x, POD_Y.C + POD.h - 2, () => {
    pen.rect("stamp:bg", { width: wdt, height: 44, rx: 22, fill: COLOR.ink });
    icon(pen, "stamp:i", "replay", 20, 9, 26, COLOR.bg);
    pen.text("stamp:t", { x: 56, y: 29, ...font, fill: COLOR.bg }, label);
  });
}

function drawHeader(pen: Pen, w: World): void {
  // Postgres — плашка-«кладовщик» (персонаж — на этапе 4).
  panel(pen, "db", { x: TABLE.x, y: 20, w: 170, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: TABLE.x + 18, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  let x = POD.x;
  if (w.chapter) x += pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink }) + 12;
  pill(pen, "rc", "READ COMMITTED", { x, y: 22, fill: COLOR.surface2, color: COLOR.muted, mono: true, bold: false });
  pen.group("clock", 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": 24, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
  }, fade(w, "clock"));
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawTable(pen, w);
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.ink, color: COLOR.bg, mono: true });
  drawBoard(pen, w);
  drawSql(pen, w);
  drawPodArrows(pen, w); // под фигурами: линия уходит за бокс, а не перечёркивает его
  drawMail(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    for (const id of ACTORS) {
      const a = w.actors[id];
      // Реплика пода — в просвете над ним, хвостом вниз.
      if (a.present && a.say) bubble(pen, `say:${id}`, a.say, { x: POD.x + 36, y: POD_Y[id] - 2, tail: "down" });
    }
    if (w.card) drawCard(pen, w.card);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) drawStamp(pen, w.stamp);
    // Поверх плашки: кладовщик комментирует и её.
    if (w.db) bubble(pen, "db:say", w.db, { x: TABLE.x + 182, y: 43, tail: "left" });
  });
}
