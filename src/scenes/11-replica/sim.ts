// Мини-модель чтения с реплик: primary пишет каждое изменение в журнал (WAL) — ленту записей по порядку, реплики
// проигрывают её с отставанием `lag`. Реплика видит запись, если проиграла её: запись старше, чем «сейчас минус лаг».
// Куда пойдёт чтение, решает наш код (`route`), а не Postgres. Время — счётчик мс world.clock.

import type { Code } from "../../kit/code";
import type { Board, Verdict } from "../../kit/director";

export type PodId = "A" | "B" | "C";
export const PODS: PodId[] = ["A", "B", "C"];

export type ReplicaId = 1 | 2;
export const REPLICAS: ReplicaId[] = [1, 2];
/** Откуда прочитали: реплика или primary. */
export type Source = ReplicaId | "primary";

/** Запись в журнале. guest — бронь нашего гостя (золотая карточка); room — номер, если о нём спросят. */
export interface Entry {
  lsn: number;
  at: number; // мс, когда primary её записал
  guest: boolean;
  room: number | null;
}

export interface Replica {
  id: ReplicaId;
  lag: number; // мс
  sync: boolean; // синхронная (remote_apply): COMMIT ждёт, пока она проиграет запись
  down: boolean;
  say: string | null; // реплика слонёнка
}

/**
 * Куда наш код отправляет чтения гостя: всегда на реплики; всё в primary; в primary, пока горит печать после записи;
 * на реплику, догнавшую метку LSN (иначе primary); на синхронную реплику.
 */
export type Route = "replica" | "primary" | "seal" | "lsn" | "sync";

/** Чтение гостя: откуда, сколько своих броней увидел и сколько у него их было на primary. */
export interface Read {
  from: Source;
  seen: number;
  mine: number;
}

/** Что под сделал в кадре — стрелки кадра. */
export type Act =
  | { kind: "write"; hang: boolean } // бронь в primary; hang — COMMIT висит
  | { kind: "read"; from: Source }
  | { kind: "lsn" } // спросил у primary конец ленты
  | { kind: "check"; replica: ReplicaId; ok: boolean } // спросил позицию реплики и сравнил с меткой
  | { kind: "ask"; from: Source }; // «номер свободен?»

export interface Pod {
  id: PodId;
  acts: Act[];
}

export interface Guest {
  /** Список «Мои брони»: сколько броней показало последнее чтение; null — гость не на странице. */
  page: number | null;
  /** Откуда прочитан список. */
  from: Source | null;
  pressed: boolean; // жал «Забронировать» в этом кадре
  saving: boolean; // ждёт ответа на бронь (COMMIT висит)
  thought: string | null;
  /** Печать после записи: до какого момента чтения гостя идут в primary. */
  sealUntil: number | null;
  /** Метка LSN: позиция конца ленты сразу после COMMIT брони. */
  ticket: number | null;
}

export type Focus = PodId | "guest" | "tape" | ReplicaId | "primary" | "crowd" | "board" | "code" | "clock";

export type EventKind =
  | "press" | "commit" | "hang" | "read" | "empty" | "seen" | "dup" | "flood" | "seal" | "unseal" | "ticket" | "check" | "skip"
  | "free" | "down" | "crowd" | "clock" | "page" | "rewind" | "verdict" | "card";

export interface SimEvent {
  kind: EventKind;
  by?: PodId;
  n?: number;
  lamps?: Verdict;
}

export interface World {
  clock: number;
  wal: Entry[];
  replicas: Record<ReplicaId, Replica>;
  pods: Record<PodId, Pod>;
  guest: Guest;
  reads: Read[];
  route: Route;
  /** Длина печати, мс. */
  seal: number;
  /** Куда идут чтения листающих гостей (их в десятки раз больше, чем броней); null — ещё не показаны. */
  crowd: "primary" | "replicas" | null;
  /** Чья очередь следующего чтения по кругу реплик. */
  turn: ReplicaId;
  /** Показывать позиции реплик числами LSN (кейс 2). */
  lsn: boolean;
  code: Code | null;
  /** Ещё не показанные зрителю части мира (знакомство вводит их по одной). */
  unseen: ("replicas" | "tape" | "runners" | "crowd")[];
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

/** Номер, который бронирует гость; занятый номер — тот, о котором спросят в кейсе 2. */
export const ROOM = 12;
/** Начало ленты и шаг LSN между записями. */
export const LSN0 = 0x3a2f000;
export const LSN_STEP = 0x28;

const replica = (id: ReplicaId): Replica => ({ id, lag: 20, sync: false, down: false, say: null });
const pod = (id: PodId): Pod => ({ id, acts: [] });

export function world(): World {
  return {
    clock: 0,
    wal: [],
    replicas: { 1: replica(1), 2: replica(2) },
    pods: { A: pod("A"), B: pod("B"), C: pod("C") },
    guest: { page: null, from: null, pressed: false, saving: false, thought: null, sealUntil: null, ticket: null },
    reads: [],
    route: "replica",
    seal: 2000,
    crowd: null,
    turn: 1,
    lsn: false,
    code: null,
    unseen: [],
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

/** LSN в записи Postgres: `0/3A2F1B8`. */
export const lsnText = (lsn: number) => `0/${lsn.toString(16).toUpperCase()}`;

/** Конец ленты: то, что вернёт `pg_current_wal_lsn()`. */
export const head = (w: World) => w.wal.at(-1)?.lsn ?? LSN0;

/** Сколько записей ленты реплика проиграла: всё, что записано не позже, чем «сейчас минус лаг». */
export function applied(w: World, id: ReplicaId): number {
  const r = w.replicas[id];
  return w.wal.filter((e) => e.at <= w.clock - r.lag).length;
}

/** Позиция реплики на ленте: то, что вернёт `pg_last_wal_replay_lsn()`. */
export function replayLsn(w: World, id: ReplicaId): number {
  return w.wal[applied(w, id) - 1]?.lsn ?? LSN0;
}

/** Броней гостя на источнике: на primary — все записанные, на реплике — проигранные. */
export function bookingsAt(w: World, from: Source): number {
  const seen = from === "primary" ? w.wal : w.wal.slice(0, applied(w, from));
  return seen.filter((e) => e.guest).length;
}

/** Номер занят по мнению источника. */
export function takenAt(w: World, from: Source, room: number): boolean {
  const seen = from === "primary" ? w.wal : w.wal.slice(0, applied(w, from));
  return seen.some((e) => e.room === room);
}

function append(w: World, guest: boolean, room: number | null, at = w.clock): Entry {
  const e = { lsn: head(w) + LSN_STEP, at, guest, room };
  w.wal.push(e);
  return e;
}

export function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
  const g = w.guest;
  if (g.sealUntil !== null && w.clock >= g.sealUntil) {
    g.sealUntil = null;
    w.events.push({ kind: "unseal" });
  }
}

export const tick = (w: World, ms: number) => setClock(w, w.clock + ms);

/** Чужие записи распродажи: n записей равномерно за последние `span` мс. */
export function flood(w: World, n: number, span: number, room: number | null = null): void {
  for (let i = 0; i < n; i++) append(w, false, i === n - 1 ? room : null, w.clock - span + Math.round(((i + 1) * span) / n));
  w.wal.sort((a, b) => a.at - b.at || a.lsn - b.lsn).forEach((e, i) => (e.lsn = LSN0 + LSN_STEP * (i + 1)));
  w.events.push({ kind: "flood", n });
}

/**
 * Гость жмёт «Забронировать», под `by` пишет бронь в primary. С синхронной репликой COMMIT возвращается, когда та
 * проиграла запись (часы идут на её лаг); синхронная лежит — COMMIT висит. После COMMIT — метка гостю по маршруту.
 */
export function book(w: World, by: PodId = "A"): void {
  const g = w.guest;
  g.pressed = true;
  w.events.push({ kind: "press" });
  const sync = REPLICAS.map((id) => w.replicas[id]).find((r) => r.sync);
  if (sync?.down) {
    append(w, true, ROOM);
    g.saving = true;
    w.pods[by].acts.push({ kind: "write", hang: true });
    w.events.push({ kind: "hang", by });
    return;
  }
  append(w, true, ROOM);
  w.pods[by].acts.push({ kind: "write", hang: false });
  if (sync) tick(w, sync.lag);
  w.events.push({ kind: w.wal.filter((e) => e.guest).length > 1 ? "dup" : "commit", by });
  if (w.route === "seal") {
    g.sealUntil = w.clock + w.seal;
    w.events.push({ kind: "seal" });
  }
  if (w.route === "lsn") {
    w.pods[by].acts.push({ kind: "lsn" });
    g.ticket = head(w);
    w.events.push({ kind: "ticket" });
  }
}

/** Реплика по кругу: prefer или та, чья очередь. */
function next(w: World, prefer?: ReplicaId): ReplicaId {
  const id = prefer ?? w.turn;
  w.turn = id === 1 ? 2 : 1;
  return id;
}

/** Куда наш код отправит чтение гостя. remote_apply: по кругу, как без метки — синхронная лишь одна. Метка LSN: первая реплика по кругу, что догнала; не догнала ни одна — primary. */
function target(w: World, by: PodId, prefer?: ReplicaId): Source {
  const g = w.guest;
  switch (w.route) {
    case "primary":
      return "primary";
    case "seal":
      return g.sealUntil !== null && w.clock < g.sealUntil ? "primary" : next(w, prefer);
    case "lsn": {
      if (g.ticket === null) return next(w, prefer);
      const first = next(w, prefer);
      for (const id of [first, first === 1 ? 2 : 1] as ReplicaId[]) {
        const ok = replayLsn(w, id) >= g.ticket;
        w.pods[by].acts.push({ kind: "check", replica: id, ok });
        w.events.push({ kind: ok ? "check" : "skip", by });
        if (ok) return id;
      }
      return "primary";
    }
    default:
      return next(w, prefer);
  }
}

/** Гость открывает «Мои брони»: под `by` читает список оттуда, куда велит маршрут. */
export function read(w: World, by: PodId = "B", prefer?: ReplicaId): Read {
  const from = target(w, by, prefer);
  const r = { from, seen: bookingsAt(w, from), mine: bookingsAt(w, "primary") };
  w.reads.push(r);
  w.guest.page = r.seen;
  w.guest.from = from;
  w.pods[by].acts.push({ kind: "read", from });
  w.events.push({ kind: "read", by }, { kind: r.seen < r.mine ? "empty" : "seen", by });
  return r;
}

/** Листающие гости: их чтения идут туда же, куда маршрут ведёт гостя без метки. */
export function crowd(w: World): void {
  w.crowd = w.route === "primary" ? "primary" : "replicas";
  w.events.push({ kind: "crowd" });
}

/** «Номер свободен?» — под спрашивает источник; отвечает он по тому, что видит. */
export function ask(w: World, by: PodId, from: Source, room = ROOM): boolean {
  w.pods[by].acts.push({ kind: "ask", from });
  const free = !takenAt(w, from, room);
  if (free) w.events.push({ kind: "free", by });
  return free;
}

/** Реплика легла. */
export function down(w: World, id: ReplicaId): void {
  w.replicas[id].down = true;
  w.events.push({ kind: "down" });
}

// --- Лампы табло: по ним тест сверяет оценки кадров. ---

/** Гость видит свою бронь: ни одно его чтение не вернуло меньше броней, чем уже лежит на primary. */
export function seesLamp(w: World): "red" | "green" {
  return w.reads.every((r) => r.seen >= r.mine) ? "green" : "red";
}

/** Primary не тонет: чтения листающих идут мимо него. */
export function primaryLamp(w: World): "red" | "green" {
  return w.crowd === "primary" ? "red" : "green";
}

/** Чтения пошли назад во времени: после чтения с бронью — чтение без неё (monotonic reads). */
export function wentBack(w: World): boolean {
  return w.reads.some((r, i) => w.reads.slice(0, i).some((p) => p.seen > r.seen));
}

/** Броней гостя на primary. */
export const bookings = (w: World) => bookingsAt(w, "primary");
