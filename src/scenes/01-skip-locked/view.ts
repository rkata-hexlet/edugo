import { STAGE, type Pen } from "../../engine/contract";
import { BOB, bob, elephant, mailFace, type Look, type MailMood, type Mood } from "../../kit/characters";
import { icon, type IconName } from "../../kit/icons";
import { ACTOR, COLOR, DIM, FONT, SIZE } from "../../kit/theme";
import { board, bubble, iconText, once, panel, pill, plate, podSql, sqlWindow, stamp } from "../../kit/widgets";
import { clock } from "./script";
import {
  ACTORS, LEASE_TTL, duplicates, stuckRows, waitingFor, type Actor, type ActorId, type Focus, type Row, type SimEvent, type World,
} from "./sim";

// Поды стоят на месте; что они делают, говорят стрелки, цвет и значки — только из состояния кадра.
// Сетка (1280×720): шапка сверху; слева таблица и окно SQL; в центре поды; справа Почта и табло.
// Ниже SAFE_BOTTOM (kit/theme) — место плеера под подпись и субтитры.

const POD_Y: Record<ActorId, number> = { A: 128, B: 244, C: 360 };
const POD = { x: 700, w: 230, h: 64 };
const TABLE = { x: 40, y: 124, rowH: 38, gap: 5 };
const COLS = [
  { title: "id", x: 0, w: 50 },
  { title: "status", x: 50, w: 210 },
  { title: "claim_token", x: 260, w: 150 },
  { title: "lease_until", x: 410, w: 130 },
];
const MAIL = { x: 984, y: 130, w: 256, h: 270, line0: 202, lineH: 28 };
const BOARD = { x: 750, y: 466, w: 490, rowH: 26 };
const BOTTOM = 650; // низ титра и окна SQL
const DB = { x: 100, w: 130 }; // табличка Postgres справа от слона

const MONO = { "font-family": FONT.mono, "font-size": SIZE.body };
/** Сплошная стрелка прорисовывается от пода к цели при появлении (motion.css). */
const DRAW = { pathLength: 1, class: "fx-draw" };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };

const rowY = (id: number) => TABLE.y + (id - 1) * (TABLE.rowH + TABLE.gap);
const rowMid = (id: number) => rowY(id) + TABLE.rowH / 2;
const cols = (w: World) => (w.leaseCols ? COLS : COLS.slice(0, 2));
const tableEnd = (w: World) => TABLE.x + cols(w).reduce((x, c) => Math.max(x, c.x + c.w), 0);
const podMid = (id: ActorId) => POD_Y[id] + POD.h / 2;
const lit = (w: World, ...ids: Focus[]) => !w.focus || ids.some((id) => w.focus!.includes(id));
const fade = (w: World, ...ids: Focus[]) => ({ opacity: lit(w, ...ids) ? 1 : DIM });
const carriers = (w: World, row: number) => ACTORS.filter((id) => w.actors[id].carrying === row);
const happened = (w: World, kind: SimEvent["kind"], by?: ActorId) => w.events.some((e) => e.kind === kind && (by === undefined || e.by === by));
/** Разовый эффект: при fx — новый ключ (узел создаётся заново, анимация проигрывается), иначе — постоянный. */

function drawRow(pen: Pen, w: World, r: Row, stuck: Set<number>): void {
  const seenByRace = w.race && ACTORS.some((id) => w.actors[id].seen === r.id);
  const owners = carriers(w, r.id);
  const status = r.draft && r.draft.status !== r.status ? `${r.status} → ${r.draft.status}` : r.status;
  // Цвет пода — только у закоммиченной «в работе»: незакоммиченный захват видит лишь сам под. С токенами —
  // цвет того, чей токен в строке: после перехвата строка становится цвета нового владельца.
  const holder = r.token ? ACTORS.find((id) => w.actors[id].token === r.token) : owners.length === 1 ? owners[0] : undefined;
  const ownerTint = r.status === "in_progress" && holder ? ACTOR[holder].tint : null;
  const statusFill = r.draft ? COLOR.draftBg : r.status === "done" ? COLOR.doneBg : ownerTint ?? (r.status === "in_progress" ? COLOR.surface2 : COLOR.surface);
  const width = tableEnd(w) - TABLE.x;
  const base = 25; // базовая линия текста в строке
  pen.group(`row:${r.id}`, TABLE.x, rowY(r.id), () => {
    cols(w).forEach((col, i) => {
      // Просрочка — только на полосе срока (курсор за дедлайном): сама строка не меняется.
      const fill = i === 1 ? statusFill : COLOR.surface;
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
      // Новый токен (захват, перехват) появляется заметно: ключ узла — сам токен.
      if (r.token) pen.group(`row:${r.id}:tok:${r.token}`, 0, 0, () =>
        iconText(pen, `row:${r.id}:tok`, "ticket", COLS[2].x + 10, base, r.token!, tokenOwnerColor(w, r.token!), MONO), { class: "fx-pop" });
      else pen.text(`row:${r.id}:tok`, { x: COLS[2].x + 12, y: base, fill: COLOR.faint, ...MONO }, "—");
      pen.text(`row:${r.id}:lease`, { x: COLS[3].x + 12, y: base, fill: COLOR.ink, ...MONO },
        r.leaseUntil !== null ? clock(r.leaseUntil) : "—");
      if (r.leaseUntil !== null && r.status !== "done") drawLeaseBar(pen, w, r); // у выполненной срок уже не идёт
    }
    if (w.ghost?.row === r.id) {
      // Прежний токен — зачёркнутым рядом с новым: владелец сменился.
      pen.text(`row:${r.id}:ghost`, {
        x: COLS[2].x + 92, y: base, ...MONO, fill: tokenOwnerColor(w, w.ghost.token), "text-decoration": "line-through", opacity: 0.75,
      }, w.ghost.token);
    }
    // Застряла — «!», а не «?»: «?» у пода значит «жив ли он» (нить главы 2).
    if (stuck.has(r.id)) icon(pen, `row:${r.id}:stuck`, "bang", -34, 6, 28, COLOR.error); // слева, не на тексте
    // Отметка по чужому токену не прошла: талон пода рядом с талоном строки — плашкой под таблицей.
    // Держится до конца сцены (World.clash), а не один кадр.
    if (w.clash?.row === r.id && r.token && w.actors[w.clash.by].token) {
      const loser = w.clash.by;
      const mine = w.actors[loser].token!;
      // Под таблицей, под колонкой токенов: на соседней строке плашка закрыла бы её текст.
      pen.group(`row:${r.id}:vs`, COLS[2].x - 20, rowY(w.rows.length) - rowY(r.id) + TABLE.rowH + 12, () => {
        panel(pen, `row:${r.id}:vs`, { x: 0, y: 0, w: 230, h: 36, rx: 10, fill: COLOR.surface2, stroke: COLOR.error });
        iconText(pen, `row:${r.id}:vs:a`, "ticket", 12, 25, mine, ACTOR[loser].color, MONO);
        pen.text(`row:${r.id}:vs:ne`, { x: 104, y: 26, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.error }, "≠");
        iconText(pen, `row:${r.id}:vs:b`, "ticket", 128, 25, r.token!, tokenOwnerColor(w, r.token!), MONO);
      }, { class: "fx-pop" });
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

/** Полоса срока по низу ячеек токена и срока: прошедшее время — зелёное до дедлайна и красное после,
 *  будущее — серое, засечка на дедлайне; курсор «сейчас» по часам БД; значок ✓ цвета пода — когда
 *  держатель проверял срок. Красное появляется только когда курсор пересёк дедлайн. */
function drawLeaseBar(pen: Pen, w: World, r: Row): void {
  const x0 = COLS[2].x + 8;
  const len = COLS[3].x + COLS[3].w - 8 - x0;
  const t0 = r.leaseUntil! - LEASE_TTL;
  const span = LEASE_TTL * 1.5;
  const at = (t: number) => x0 + Math.max(0, Math.min(1, (t - t0) / span)) * len;
  const deadline = at(r.leaseUntil!);
  const now = at(w.clock);
  const y = TABLE.rowH - 6;
  const bar = (k: string, from: number, to: number, fill: string, opacity = 0.85) =>
    to > from && pen.rect(`row:${r.id}:bar:${k}`, { x: from, y, width: to - from, height: 4, rx: 2, fill, opacity });
  bar("future", now, x0 + len, COLOR.faint, 0.6);
  bar("ok", x0, Math.min(now, deadline), COLOR.ok);
  bar("late", deadline, now, COLOR.error);
  pen.rect(`row:${r.id}:bar:tick`, { x: deadline - 1, y: y - 3, width: 2, height: 10, fill: COLOR.muted });
  pen.group(`row:${r.id}:now`, now, y - 6, () => {
    pen.rect(`row:${r.id}:now:mark`, { x: -1.5, width: 3, height: 16, rx: 1.5, fill: COLOR.ink });
  });
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (a.checkedAt === null || a.carrying !== r.id || a.token !== r.token) continue; // проверял именно эту аренду
    const cx = at(a.checkedAt);
    pen.group(`row:${r.id}:check:${id}`, cx, y + 2, () => {
      pen.rect(`row:${r.id}:check:${id}:bg`, { x: -10, y: -10, width: 20, height: 20, rx: 10, fill: ACTOR[id].color });
      icon(pen, `row:${r.id}:check:${id}:i`, "check", -8, -8, 16, COLOR.bg);
    }, { class: "fx-pop" });
  }
}

function drawTable(pen: Pen, w: World): void {
  cols(w).forEach((col, i) =>
    pen.text(`hdr:${i}`, { x: TABLE.x + col.x + 12, y: TABLE.y - 12, ...MONO, fill: COLOR.muted, ...fade(w, "table") }, col.title));
  // Счётчик — под таблицей и только там, где голос говорит о том же («разобрали всё», «застряла одна»).
  if (w.tally) {
    const left = w.rows.filter((r) => r.status !== "done").length;
    const label = `осталось ${left} из ${w.rows.length}`;
    const attrs = { ...SANS, "font-size": SIZE.say, "font-weight": 600 };
    const y = rowY(w.rows.length) + TABLE.rowH + 33;
    pen.group("left", 0, 0, () => {
      if (left) pen.text("left:t", { x: TABLE.x, y, ...attrs, fill: COLOR.warn }, label);
      else iconText(pen, "left", "check", TABLE.x, y, label, COLOR.ok, attrs);
    }, fade(w, "table"));
  }
  const stuck = new Set(stuckRows(w));
  // Свежий стол — строки въезжают каскадом: смена сцены видна как смена, а не как сбой.
  pen.group(`rows:${w.scene}`, 0, 0, () => {
    for (const r of w.rows) drawRow(pen, w, r, stuck);
  }, happened(w, "page") ? { class: "fx-cascade" } : {});
}

/** Эмоция пода — из состояния кадра. */
function podMood(w: World, a: Actor): Mood {
  if (a.frozen) return "frozen";
  if (happened(w, "zero", a.id)) return "lost";
  if (a.say) return "talk";
  if (waitingFor(a) !== null || a.pending) return "wait";
  if (a.affected === 1 && happened(w, "one")) return "won";
  if (a.carrying !== null) return "work";
  return "idle";
}

/** Куда смотрит под: на Почту, когда отправляет; на строку, которую видит, держит или ждёт. */
function podLook(w: World, a: Actor): Look {
  if (happened(w, "send", a.id) || happened(w, "replay", a.id)) return { x: 1, y: 0 };
  const row = waitingFor(a) ?? a.carrying ?? a.seen;
  if (row === null) return { x: 0, y: 0 };
  return { x: -1, y: Math.max(-1, Math.min(1, (rowMid(row) - podMid(a.id)) / 160)) };
}

/** Строка состояния под именем: 0 строк, ждёт N с. Талон — рядом с именем. */
function drawPodStatus(pen: Pen, w: World, a: Actor): void {
  const color = ACTOR[a.id].color;
  const items: [IconName, string, string][] = [];
  if (happened(w, "zero", a.id)) items.push(["cross", "0 строк", COLOR.error]);
  // Секунды — только когда часы идут (кейс 2); «ждёт 0 с» читалось бы как «ожидания нет» (tech-expert).
  if (a.scan?.waitingFor != null) items.push(["hourglass", w.clock > a.scan.since ? `ждёт ${w.clock - a.scan.since} с` : "ждёт", color]);
  else if (a.pending) items.push(["hourglass", "ждёт", color]);
  // Ключ идемпотентности — номер заказа, а не токен: у B и C он один и тот же (tech-expert).
  if (w.keyed && a.carrying !== null) items.push(["key", `заказ ${a.carrying}`, COLOR.ink]);
  let x = BOB.w + 14;
  items.forEach(([name, text, c], i) => {
    x = iconText(pen, `pod:${a.id}:st${i}`, name, x, 52, text, c) + 10;
  });
}

function drawPod(pen: Pen, w: World, a: Actor): void {
  const { color, tint } = ACTOR[a.id];
  const mood = podMood(w, a);
  pen.group(`pod:${a.id}`, POD.x, POD_Y[a.id], () => {
    // Эмоция — движением: выиграл — подпрыгнул, проиграл — тряска, проснулся — вздрогнул, упал — проявился призрак.
    // Упал: в кадре падения — призрак; дальше — серый силуэт, как у зависшего, только без «z»:
    // со стороны «упал» и «завис» не отличить (нить главы 2), зритель знает правду из кадра падения.
    const crashedNow = !a.present && happened(w, "crash");
    const unknown = !a.present && !crashedNow;
    const fx = mood === "won" ? "fx-hop" : mood === "lost" ? "fx-shake" : happened(w, "unfreeze", a.id) ? "fx-jolt"
      : crashedNow ? "fx-fade" : null;
    const [fxKey, fxAttrs] = once(`pod:${a.id}:fx`, w.frame, fx);
    pen.group(fxKey, 0, 0, () =>
      bob(pen, `pod:${a.id}:bob`, {
        x: 0, y: 0, color, tint, letter: a.id, mood: unknown ? "frozen" : mood, look: podLook(w, a), ghost: crashedNow, dashed: mood === "wait",
      }),
    fxAttrs);
    const nameColor = !a.present || a.frozen ? COLOR.muted : color;
    pen.text(`pod:${a.id}:name`, { x: BOB.w + 14, y: 24, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: nameColor },
      crashedNow ? `${a.label} · упал` : a.label);
    // «?» сбоку, а не над головой: вопрос задают остальные («жив ли он?»), а не сам под. Виден и у
    // упавшего — снаружи не отличить (нить главы 2).
    if (w.doubt === a.id) icon(pen, `pod:${a.id}:doubt`, "question", -40, -34, 34, COLOR.warn);
    if (!a.present) return;
    if (a.token) iconText(pen, `pod:${a.id}:tok`, "ticket", BOB.w + 92, 24, a.token, color, MONO);
    drawPodStatus(pen, w, a);

    if (a.frozen) icon(pen, `pod:${a.id}:zz`, "sleep", 44, -34, 30, COLOR.muted); // завис — видно издалека
    if (happened(w, "unfreeze", a.id)) icon(pen, `pod:${a.id}:wake`, "bang", 46, -36, 28, COLOR.warn);
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
      // Держит по устаревшей проверке: в строке уже чужой токен — бледный пунктир.
      const row = w.rows.find((r) => r.id === a.carrying)!;
      const stale = a.token !== null && row.token !== null && row.token !== a.token;
      pen.line(`arr:${id}:hold`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(a.carrying),
        stroke: color, "stroke-width": stale ? 2.5 : 3.5, "stroke-linecap": "round", marker: "arrow",
        opacity: stale ? op * 0.5 : op, ...(stale ? { "stroke-dasharray": "4 7" } : DRAW),
      });
    } else if (a.seen !== null) {
      pen.line(`arr:${id}:look`, {
        x1: from.x, y1: from.y, x2: end, y2: rowMid(a.seen),
        stroke: COLOR.muted, "stroke-width": 2, "stroke-linecap": "round", marker: "arrow", opacity: op, ...DRAW,
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
  const [mailKey, mailFx] = once("mail", w.frame, happened(w, "duplicate") ? "fx-shake" : null);
  pen.group(mailKey, 0, 0, () => drawMailBody(pen, w), { ...fade(w, "mail"), ...mailFx });
  // Реплика Почты — в журнале, хвостом к последнему письму: ответ про него.
  if (w.mail) {
    const y = mailLineY(Math.max(0, w.letters.length - 1)) + 40; // ниже писем: не закрывать «повтор»
    pen.layer("top", () => bubble(pen, "mail:say", w.mail!, { x: MAIL.x + MAIL.w - 60, y, tail: "up", align: "end", attrs: { class: "fx-pop" } }));
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
    const color = e.kind === "replay" ? COLOR.ok : dupNow ? COLOR.error : ACTOR[e.by].color;
    pen.line(`arr:mail:${i}`, {
      // От правого края слота, ниже талона: иначе стрелка вверх к журналу перечеркнёт «🎫 7f3a».
      x1: POD.x + POD.w, y1: POD_Y[e.by] + 42, x2: MAIL.x - 6, y2: mailLineY(line) - 6,
      stroke: color, "stroke-width": 3, "stroke-linecap": "round", marker: "arrow",
      ...(e.kind === "replay" ? { "stroke-dasharray": "5 6" } : DRAW),
      ...fade(w, "mail", e.by),
    });
  });
}

function drawMailBody(pen: Pen, w: World): void {
  const dup = duplicates(w);
  panel(pen, "mail:box", { x: MAIL.x, y: MAIL.y, w: MAIL.w, h: MAIL.h, fill: dup.length ? COLOR.alarmBg : COLOR.surface, stroke: dup.length ? COLOR.error : COLOR.mail });
  iconText(pen, "mail:title", "mail", MAIL.x + 16, MAIL.y + 38, "Почта", COLOR.mail, { ...SANS, "font-size": SIZE.say, "font-weight": 700 });
  const mood: MailMood = dup.length ? "alarm" : w.letters.some((l) => l.replayed) ? "relieved" : w.letters.length ? "calm" : "asleep";
  mailFace(pen, "mail:face", { x: MAIL.x + MAIL.w - 60, y: MAIL.y + 24, mood });
  pen.rect("mail:rule", { x: MAIL.x + 16, y: MAIL.y + 52, width: MAIL.w - 32, height: 1.5, fill: COLOR.line });
  const sent = new Set<number>();
  w.letters.forEach((l, i) => {
    const again = sent.has(l.row);
    if (!l.replayed) sent.add(l.row);
    const y = mailLineY(i);
    // Повтор, погашенный по ключу, — итог эпизода: зелёным, как «всё хорошо».
    const fill = l.replayed ? COLOR.ok : again ? COLOR.error : COLOR.ink;
    const key = `mail:l${i}`;
    pen.group(`${key}:row`, 0, 0, () => {
      let x = iconText(pen, key, l.replayed ? "replay" : "mail", MAIL.x + 16, y, `заказ ${l.row}`, fill, MONO) + 8;
      if (l.keyed) {
        icon(pen, `${key}:key`, "key", x, y - 16, 20, COLOR.ink); // не жёлтый: жёлтый — цвет пода B
        x += 28;
      }
      if (l.replayed) pen.text(`${key}:note`, { x, y, ...SANS, fill }, "повтор");
      else if (again) pen.text(`${key}:note`, { x, y, ...SANS, "font-weight": 700, fill }, "ДУБЛЬ");
    }, { class: "fx-slide" }); // новое письмо въезжает в журнал
  });
}

/** Титр — слева над окном SQL, табло не закрывает. */
function drawCard(pen: Pen, text: string): void {
  const font = { ...SANS, "font-size": SIZE.accent, "font-weight": 600 };
  const m = pen.measure(text, font);
  const h = Math.max(80, m.height + 48);
  const wdt = Math.max(420, m.width + 64);
  pen.group("card", TABLE.x, BOTTOM - h, () => {
    panel(pen, "card", { x: 0, y: 0, w: wdt, h, fill: COLOR.surface2, stroke: COLOR.ink, rx: 16 });
    pen.text("card:t", { x: 32, y: 24 + 22 * 0.8 + (h - 48 - m.height) / 2, ...font, fill: COLOR.ink }, text);
  }, { class: "fx-rise" });
}

function drawHeader(pen: Pen, w: World): void {
  // Postgres — слон-«кладовщик» и табличка с именем.
  // Слон кивает на COMMIT: база зафиксировала.
  const [dbKey, dbFx] = once("db:nod", w.frame, happened(w, "commit") ? "fx-nod" : null);
  pen.group(dbKey, 0, 0, () => elephant(pen, "db:face", { x: TABLE.x + 4, y: 8, talking: !!w.db, scale: 1.08 }), dbFx);
  panel(pen, "db", { x: DB.x, y: 20, w: DB.w, h: 46, rx: 14, fill: COLOR.surface2, stroke: COLOR.postgres });
  pen.text("db:name", { x: DB.x + 16, y: 50, ...SANS, "font-size": SIZE.say, "font-weight": 700, fill: COLOR.ink }, "Postgres");
  if (w.chapter) pill(pen, "chapter", `КЕЙС ${w.chapter}`, { x: POD.x, y: 22, fill: "none", color: COLOR.ink, stroke: COLOR.ink });
  const [clockKey, clockFx] = once("clock", w.frame, happened(w, "clock") ? "fx-pulse" : null);
  pen.group(clockKey, 0, 0, () => {
    icon(pen, "clock:i", "clock", 1080, 26, 26, COLOR.muted);
    pen.text("clock:t", { x: 1114, y: 48, "font-family": FONT.mono, "font-size": SIZE.clock, "font-weight": 700, fill: COLOR.ink }, clock(w.clock));
    pen.text("clock:label", { x: 1240, y: 88, ...SANS, fill: COLOR.muted, "text-anchor": "end" }, "часы БД");
  }, { ...fade(w, "clock"), ...clockFx });
}

export function render(pen: Pen, w: World): void {
  pen.layer("back", () => pen.rect("bg", { x: 0, y: 0, width: STAGE.w, height: STAGE.h, fill: COLOR.bg }));
  drawHeader(pen, w);
  drawTable(pen, w);
  // Ярлык-термин — контурный: залитые светлые пилюли — это реплики.
  if (w.term) pill(pen, "term", w.term, { x: POD.x, y: 76, fill: COLOR.surface2, color: COLOR.ink, stroke: COLOR.ink, mono: true, attrs: { class: "fx-slide" } });
  if (w.board) board(pen, w.board, { ...BOARD, lampX: [290, 425], attrs: fade(w, "board") });
  if (w.sql.length) sqlWindow(pen, "sql", podSql(w.sql), { x: TABLE.x, bottom: BOTTOM, attrs: fade(w, "sql") }); // SQL — только где его надо прочитать
  drawPodArrows(pen, w); // под фигурами: линия уходит за бокс, а не перечёркивает его
  drawMail(pen, w);
  for (const id of ACTORS) drawPod(pen, w, w.actors[id]);
  pen.layer("top", () => {
    for (const id of ACTORS) {
      const a = w.actors[id];
      // Реплика пода — слева от него, поверх стрелок: над подом нет места из-за антенны соседа.
      if (a.present && a.say) bubble(pen, `say:${id}`, a.say, { x: POD.x - 6, y: POD_Y[id] + 24, tail: "right", attrs: { class: "fx-pop" } });
      // Мысль — там же, пунктиром: то, во что под верит (устаревшая проверка срока).
      // Ниже стрелок пода к таблице (они уходят вверх-влево), чтобы не перечёркивать их.
      else if (a.present && a.thought) bubble(pen, `think:${id}`, a.thought, { x: POD.x - 6, y: POD_Y[id] + 60, tail: "right", thought: true, attrs: { ...fade(w, id), class: "fx-pop" } });
    }
    if (w.card) drawCard(pen, w.card);
    if (w.plate) {
      const [head, ...rest] = w.plate.split("\n");
      plate(pen, "plate", head, rest.join("\n"), STAGE);
    }
    if (w.stamp) stamp(pen, w.stamp, { left: DB.x + DB.w + 12, right: POD.x - 12 });
    // Поверх плашки: кладовщик комментирует и её.
    if (w.db) bubble(pen, "db:say", w.db, { x: DB.x + DB.w + 10, y: 43, tail: "left", attrs: { class: "fx-pop" } });
  });
}
