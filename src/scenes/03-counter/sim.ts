// Мини-модель счётчика кликов: таблица link_stats в Postgres (горячая строка — одна или разложенная на шарды),
// поды с пулом соединений, фоновыми прибавками (`go func()`) и копилкой батча, журнал прибавок и журнал сбросов
// flushes (ключ батча), внешний мир — «кликов было» у браузеров. Детерминирована: время — счётчик секунд
// world.clock, нагрузка — формула от потока кликов и способа записи, шард — по кругу, без случайности.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B" | "C";
export const ACTORS: ActorId[] = ["A", "B", "C"];

/** Горячая ссылка эпизода и соседи — их клики страдают от общего пула соединений. */
export const HOT = "x7Kp2";
export const OTHERS = ["k9Lm1", "Qz9fT"];

/** Как под записывает клик: сразу +1, +1 в фоне, +1 в случайный шард, копит и сбрасывает батчем. */
export type Mode = "direct" | "async" | "sharded" | "batch";

/** Строка link_stats. */
export interface Row {
  code: string;
  clicks: number;
  /** Шарды горячей строки (sharded counter); null — одна строка. Сумма шардов = clicks. */
  shards: number[] | null;
}

/** Прибавка, дошедшая до базы и закоммиченная. dup — тот же батч второй раз. */
export interface Add {
  by: ActorId;
  n: number;
  key: string | null; // номер батча «A · 17»
  dup: boolean;
}

/** Что под сделал в этом кадре — стрелки кадра. */
export type Act =
  | { kind: "add"; n: number; shard?: number }
  | { kind: "flush"; n: number; key: string | null }
  | { kind: "lost" } // ответ базы до пода не дошёл
  | { kind: "skip"; key: string } // база узнала номер и не прибавила
  | { kind: "reply"; n: number }; // ответы браузерам

export interface Actor {
  id: ActorId;
  label: string;
  present: boolean; // false — под погас
  /** Ждущие запросы в пуле соединений (≤ POOL) — занятые слоты. */
  waiting: number;
  /** Прибавки, брошенные в фон и ещё не дошедшие до базы. */
  background: number;
  /** Копилка батча: накоплено кликов. */
  jar: number;
  /** Номер следующего батча. */
  seq: number;
  /** Батч отправлен, а ответа нет: «дошло ли?». */
  unsure: boolean;
  /** Получил SIGTERM: новых кликов не принимает. */
  draining: boolean;
  acts: Act[];
}

export type Focus = ActorId | "table" | "row" | "queue" | "pool" | "jar" | "adds" | "flushes" | "browsers" | "board" | "clock" | "sql" | "load" | "lock" | "lag";

export type EventKind =
  | "flood" | "click" | "add" | "commit" | "wait" | "overload" | "calm" | "async" | "restart" | "spill" | "shard"
  | "flush" | "sigterm" | "deploy" | "spawn" | "lost" | "dup" | "skip" | "kill" | "clock"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  n?: number;
  by?: ActorId;
  lamps?: Verdict;
}

/** Кадр из эпизода 01, повторённый сценой (отсылка назад): какой кадр по тексту диктора. */
export interface Flashback {
  voice: string; // начало закадра кадра эпизода 01
}

export interface World {
  clock: number;
  mode: Mode;
  rows: Row[];
  actors: Record<ActorId, Actor>;
  /** Внешний мир: сколько кликов браузеры получили ответом «принято». */
  clicked: number;
  /** Ждут соединения клики других ссылок (пул кончился). */
  starved: number;
  adds: Add[]; // журнал прибавок (последние)
  flushes: string[]; // журнал сбросов: номера учтённых батчей
  /** Показывать ли журнал сбросов (с попытки «ключ батча»). */
  keyed: boolean;
  /** Поток кликов по горячей ссылке, кликов/с (образ в кадре); 0 — потока нет. */
  flow: number;
  flashback: Flashback | null;
  sql: string[];
  db: string | null;
  plate: string | null;
  chapter: number | null;
  board: Board | null;
  stamp: string | null;
  focus: Focus[] | null;
  term: string | null;
  events: SimEvent[];
  frame: number;
  scene: number;
  replay: boolean;
}

/** Слотов в пуле соединений пода. */
export const POOL = 4;
/** Потолок горячей строки (прибавок/с — 1 / время коммита) и базы целиком (коммитов/с). В кадре без чисел. */
export const ROW_CAP = 2_000;
export const DB_CAP = 12_000;
/** Шардов горячей строки и окно сброса батча, с. */
export const SHARDS = 16;
export const WINDOW = 5;

export function world(): World {
  const actor = (id: ActorId): Actor => ({
    id, label: `Pod ${id}`, present: true, waiting: 0, background: 0, jar: 0, seq: 17, unsure: false, draining: false, acts: [],
  });
  return {
    clock: 0,
    mode: "direct",
    rows: [
      { code: HOT, clicks: 1_042, shards: null },
      { code: OTHERS[0], clicks: 318, shards: null },
      { code: OTHERS[1], clicks: 77, shards: null },
    ],
    actors: { A: actor("A"), B: actor("B"), C: actor("C") },
    clicked: 1_042,
    starved: 0,
    adds: [],
    flushes: [],
    keyed: false,
    flow: 0,
    flashback: null,
    sql: [],
    db: null,
    plate: null,
    chapter: null,
    board: null,
    stamp: null,
    focus: null,
    term: null,
    events: [],
    frame: 0,
    scene: 0,
    replay: false,
  };
}

export function hotRow(w: World): Row {
  return w.rows[0];
}

/** Записей в секунду в горячую строку (или в самый загруженный шард) и в базу целиком. */
export function writes(w: World): { row: number; total: number } {
  const pods = ACTORS.filter((id) => w.actors[id].present).length;
  if (w.mode === "batch") return { row: pods / WINDOW, total: pods / WINDOW };
  if (w.mode === "sharded") return { row: w.flow / SHARDS, total: w.flow };
  return { row: w.flow, total: w.flow };
}

/** Нагрузка базы, доля потолка: очередь к строке или поток коммитов — что тяжелее. */
export function dbLoad(w: World): number {
  const x = writes(w);
  return Math.max(x.row / ROW_CAP, x.total / DB_CAP);
}

/** Очередь к строке: прибавки приходят чаще, чем строка успевает коммитить. */
export function contended(w: World): boolean {
  return writes(w).row > ROW_CAP;
}

/** Нахлынул поток: при очереди к строке пулы подов забиты ждущими, клики других ссылок ждут соединения. */
export function flood(w: World, flow: number): void {
  w.flow = flow;
  w.events.push({ kind: "flood" });
  const jam = contended(w) && (w.mode === "direct" || w.mode === "async");
  for (const id of ACTORS) w.actors[id].waiting = jam && w.actors[id].present ? POOL : 0;
  w.starved = jam && w.mode === "direct" ? 6 : 0;
  w.events.push({ kind: jam ? "overload" : "calm" });
}

/** Сколько ещё не дошло до базы, но живо в подах (фон и копилки). Копилка пода, который ждёт ответа на сброс, уже
 *  в базе (ответ теряется только после COMMIT) — под этого не знает, а модель знает. */
export function pending(w: World): number {
  return ACTORS.reduce((s, id) => {
    const a = w.actors[id];
    return s + (a.present ? a.background + (a.unsure ? 0 : a.jar) : 0);
  }, 0);
}

/** Клики, которых нет ни в базе, ни в подах: потеряны. */
export function lost(w: World): number {
  return Math.max(0, w.clicked - hotRow(w).clicks - pending(w));
}

/** Лишнее в базе: учтено больше, чем было кликов. */
export function doubled(w: World): number {
  return Math.max(0, hotRow(w).clicks + pending(w) - w.clicked);
}

/** Закоммиченная прибавка батча в горячую строку; dup — этот батч база уже прибавляла. */
function commitAdd(w: World, who: ActorId, n: number, key: string | null, dup: boolean): void {
  hotRow(w).clicks += n;
  w.adds.push({ by: who, n, key, dup });
  w.events.push({ kind: dup ? "dup" : "commit", by: who, n });
}

/**
 * n кликов пришли к поду who (part — в какую часть разложенного счётчика, иначе «случайная»). Браузеры получили «принято». Дальше — по способу записи:
 * direct/sharded — прибавка сразу (в кадре — одна прибавка за все n, образ), async — в фон, batch — в копилку.
 */
export function click(w: World, who: ActorId, n = 1, part?: number): void {
  const a = w.actors[who];
  if (!a.present || a.draining) throw new Error(`клик к поду ${who}, который не принимает`);
  w.clicked += n;
  a.acts.push({ kind: "reply", n });
  w.events.push({ kind: "click", by: who, n });
  if (w.mode === "async") {
    a.background += n;
    w.events.push({ kind: "async", by: who, n });
    return;
  }
  if (w.mode === "batch") {
    a.jar += n;
    return;
  }
  const row = hotRow(w);
  if (row.shards) {
    const shard = part ?? (w.clicked + 15 + 5 * ACTORS.indexOf(who)) % SHARDS; // «случайная» часть — детерминированно
    row.shards[shard] += n;
    row.clicks += n;
    a.acts.push({ kind: "add", n, shard });
    w.events.push({ kind: "shard", by: who, n });
    return;
  }
  row.clicks += n;
  a.acts.push({ kind: "add", n });
  w.adds.push({ by: who, n: 1, key: null, dup: false }); // каждый клик — своя прибавка +1; в кадре — последняя
  w.events.push({ kind: "commit", by: who, n });
}

/** Под who ждёт замок строки, пока прибавляет сосед (кадр нормы: «по одному»). */
export function wait(w: World, who: ActorId): void {
  w.actors[who].waiting = 1;
  w.events.push({ kind: "wait", by: who });
}

/** Фоновые прибавки пода наконец дошли до базы — по одной, но в кадре одной прибавкой. */
export function drain(w: World, who: ActorId, n: number): void {
  const a = w.actors[who];
  const k = Math.min(n, a.background);
  a.background -= k;
  hotRow(w).clicks += k;
  a.acts.push({ kind: "add", n: k });
  w.events.push({ kind: "commit", by: who, n: k });
}

/** Включить шарды: горячая строка раскладывается на SHARDS строк, сумма та же. */
export function shard(w: World): void {
  const row = hotRow(w);
  const base = Math.floor(row.clicks / SHARDS);
  row.shards = Array.from({ length: SHARDS }, (_, i) => base + (i < row.clicks % SHARDS ? 1 : 0));
  w.mode = "sharded";
}

/** Номер батча пода: «A · 17». */
export function batchKey(w: World, who: ActorId): string {
  return `${who} · ${w.actors[who].seq}`;
}

/**
 * Сброс копилки одним UPDATE. keyed — номер батча пишется в flushes в той же транзакции, прибавка — только если
 * номера ещё не было. lostReply — база закоммитила, а ответ до пода не дошёл: копилка не тронута, под не уверен.
 */
export function flush(w: World, who: ActorId, { keyed = w.keyed, lostReply = false } = {}): void {
  const a = w.actors[who];
  const n = a.jar;
  const key = keyed ? batchKey(w, who) : null;
  // Повтор после потерянного ответа: прошлая попытка этого же батча уже закоммичена (ответ теряется только после COMMIT).
  const retry = a.unsure;
  a.acts.push({ kind: "flush", n, key });
  w.events.push({ kind: "flush", by: who, n });
  if (key && w.flushes.includes(key)) {
    a.acts.push({ kind: "skip", key });
    w.events.push({ kind: "skip", by: who });
  } else {
    if (key) w.flushes.push(key);
    commitAdd(w, who, n, key, retry);
  }
  if (lostReply) {
    a.acts.push({ kind: "lost" });
    a.unsure = true;
    w.events.push({ kind: "lost", by: who });
    return;
  }
  a.jar = 0;
  a.seq++;
  a.unsure = false;
}

/** Под перезапустился: фон и копилка пропали вместе с памятью. */
export function restart(w: World, who: ActorId): number {
  const a = w.actors[who];
  const gone = a.background + a.jar;
  a.background = 0;
  a.jar = 0;
  a.waiting = 0;
  a.unsure = false;
  w.events.push({ kind: "restart", by: who, n: gone });
  if (gone) w.events.push({ kind: "spill", by: who, n: gone });
  return gone;
}

/** На месте погасшего пода — новый, пустой (деплой). */
export function spawn(w: World, who: ActorId): void {
  const a = w.actors[who];
  Object.assign(a, { present: true, waiting: 0, background: 0, jar: 0, unsure: false, draining: false });
  w.events.push({ kind: "spawn", by: who });
}

/** Под гаснет на деплое: без мягкой остановки — с копилкой, после SIGTERM и сброса — пустым. */
export function stop(w: World, who: ActorId): void {
  down(w, who, "deploy");
}

/** SIGTERM: под перестаёт принимать клики (дальше — сброс и замена). */
export function sigterm(w: World, who: ActorId): void {
  w.actors[who].draining = true;
  w.events.push({ kind: "sigterm", by: who });
}

/** kill -9 / нехватка памяти: под погас без сигнала, копилка пропала. */
export function kill(w: World, who: ActorId): void {
  down(w, who, "kill");
}

function down(w: World, who: ActorId, kind: "kill" | "deploy"): void {
  const a = w.actors[who];
  const gone = a.jar + a.background;
  a.present = false;
  a.jar = 0;
  a.background = 0;
  a.waiting = 0;
  w.events.push({ kind, by: who, n: gone });
  if (gone) w.events.push({ kind: "spill", by: who, n: gone });
}
