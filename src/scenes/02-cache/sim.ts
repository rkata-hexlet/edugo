// Мини-модель сервиса коротких ссылок: таблица links в Postgres (незакоммиченная правка видна только
// автору — MVCC: чтение не ждёт чужую транзакцию), Redis с TTL (один узел или кластер со слотами),
// локальный карман L1 в каждом поде и журнал ответов браузерам. Детерминирована: время — счётчик секунд
// world.clock, нагрузка — формула от потока кликов, без случайности.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B" | "C";
export const ACTORS: ActorId[] = ["A", "B", "C"];

/** Горячая ссылка эпизода и её адреса: до правки и после (магазин перенёс распродажу). */
export const HOT = "x7Kp2";
export const OLD = "shop.example/sale";
export const NEW = "shop.example/promo";

/** Строка links. */
export interface Link {
  code: string;
  url: string; // закоммиченный адрес
  draft: string | null; // незакоммиченная правка автора
  lockedBy: ActorId | null;
}

/** Запись Redis: значение и момент, после которого Redis её не отдаёт. */
export interface Entry {
  key: string;
  value: string;
  expiresAt: number;
  ttl: number; // с каким сроком положили — для полосы TTL
}

export interface Redis {
  entries: Entry[];
  /** Узлов в кластере; 1 — одиночный Redis. */
  nodes: number;
  /** На каком узле слот горячего ключа (1…nodes). */
  hotNode: number;
}

/** Карман L1 пода: своя копия и свой срок. */
export interface Pocket {
  value: string;
  expiresAt: number;
}

/** Что под сделал в этом кадре — стрелки кадра. */
export type Act =
  | { kind: "get"; hit: boolean }
  | { kind: "l1"; hit: boolean }
  | { kind: "select" }
  | { kind: "set" }
  | { kind: "del"; n: number }
  | { kind: "update" }
  | { kind: "commit" }
  | { kind: "publish" };

export interface Actor {
  id: ActorId;
  label: string;
  present: boolean; // false — под упал
  l1: Pocket | null;
  /** Адрес, который под держит в руках (прочитал из кэша или базы) — его он и отдаст. */
  hand: string | null;
  editing: boolean; // правит ссылку по просьбе автора
  acts: Act[];
}

/** Ответ посетителю: куда отправили. stale — адрес расходится с закоммиченным в базе. */
export interface Click {
  by: ActorId;
  url: string;
  stale: boolean;
  slow: boolean; // база или узел за потолком — страница грузится секундами
}

export type Focus = ActorId | "table" | "row" | "redis" | "browsers" | "board" | "clock" | "sql" | "load";

export type EventKind =
  | "flood" | "hit" | "miss" | "select" | "set" | "del" | "del0" | "update" | "commit"
  | "ok" | "stale" | "overload" | "calm" | "expire" | "l1hit" | "l1expire" | "crash"
  | "reshard" | "publish" | "drop" | "clock" | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  n?: number; // clock — на сколько секунд прыгнули часы
  by?: ActorId;
  lamps?: Verdict;
}

export interface World {
  clock: number;
  links: Link[];
  redis: Redis | null; // null — кэша ещё нет (хук)
  actors: Record<ActorId, Actor>;
  clicks: Click[]; // журнал браузеров
  /** Поток кликов по горячей ссылке, кликов/с (образ в кадре); 0 — потока не показываем. */
  flow: number;
  /** Доля промахов мимо кэша по всему сервису (длинный хвост редких ссылок): нагрузка базы = поток × доля. */
  missRate: number;
  /** Включён ли карман L1 в подах. */
  l1: boolean;
  sql: string[];
  db: string | null; // реплика Postgres
  plate: string | null;
  chapter: number | null;
  board: Board | null;
  stamp: string | null;
  focus: Focus[] | null;
  term: string | null;
  events: SimEvent[];
  frame: number;
  scene: number;
  /** Кадр итога: повтор уже виденного — звук тише, без тревоги и часов. */
  replay: boolean;
}

/** Ёмкость базы (пул соединений) и узла Redis, запросов/с — только для полос нагрузки, в кадре без чисел. */
export const DB_CAP = 10_000;
export const NODE_CAP = 100_000;
/** Срок кэша по умолчанию и срок кармана L1, с. */
export const TTL = 3600;
export const L1_TTL = 5;
/** Фон узлов кластера: другие ключи, доля потолка. Детерминированно по номеру узла. */
const NODE_BASE = [0.18, 0.12, 0.2, 0.15, 0.1, 0.14];

export function world(): World {
  const actor = (id: ActorId): Actor => ({ id, label: `Pod ${id}`, present: true, l1: null, hand: null, editing: false, acts: [] });
  return {
    clock: 0,
    links: [
      { code: HOT, url: OLD, draft: null, lockedBy: null },
      { code: "aB3dk", url: "blog.example/go-1-24", draft: null, lockedBy: null },
      { code: "Qz9fT", url: "docs.example/pgx", draft: null, lockedBy: null },
    ],
    redis: null,
    actors: { A: actor("A"), B: actor("B"), C: actor("C") },
    clicks: [],
    flow: 0,
    missRate: 0.02,
    l1: false,
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

export function hotLink(w: World): Link {
  return w.links[0];
}

/** Живая запись Redis по ключу: просроченную Redis не отдаёт. */
export function entry(w: World, key = HOT): Entry | null {
  const e = w.redis?.entries.find((x) => x.key === key);
  return e && e.expiresAt > w.clock ? e : null;
}

/** Поставить Redis (пустой) или кластер из n узлов. */
export function addRedis(w: World, nodes = 1, hotNode = 1): void {
  w.redis = { entries: w.redis?.entries ?? [], nodes, hotNode };
}

/** GET в Redis: попал — адрес в руках пода, промах — руки пусты. */
export function get(w: World, who: ActorId): string | null {
  const a = w.actors[who];
  const e = entry(w);
  a.hand = e?.value ?? null;
  a.acts.push({ kind: "get", hit: !!e });
  w.events.push({ kind: e ? "hit" : "miss", by: who });
  return a.hand;
}

/** Карман L1 пода: живой — адрес в руках. */
export function l1get(w: World, who: ActorId): string | null {
  const a = w.actors[who];
  const live = a.l1 && a.l1.expiresAt > w.clock ? a.l1 : null;
  if (a.l1 && !live) {
    a.l1 = null;
    w.events.push({ kind: "l1expire", by: who });
  }
  a.hand = live?.value ?? null;
  a.acts.push({ kind: "l1", hit: !!live });
  if (live) w.events.push({ kind: "l1hit", by: who });
  return a.hand;
}

/** SELECT long_url: последнее закоммиченное (свою незакоммиченную правку автор видит сам). Не ждёт замков. */
export function select(w: World, who: ActorId): string {
  const a = w.actors[who];
  const l = hotLink(w);
  a.hand = l.lockedBy === who && l.draft !== null ? l.draft : l.url;
  a.acts.push({ kind: "select" });
  w.events.push({ kind: "select", by: who });
  return a.hand;
}

/** SET ключ = то, что в руках, EX ttl. */
export function set(w: World, who: ActorId, ttl = TTL): void {
  const a = w.actors[who];
  if (!w.redis || a.hand === null) throw new Error(`SET без Redis или без значения у ${who}`);
  w.redis.entries = w.redis.entries.filter((e) => e.key !== HOT);
  w.redis.entries.push({ key: HOT, value: a.hand, expiresAt: w.clock + ttl, ttl });
  a.acts.push({ kind: "set" });
  w.events.push({ kind: "set", by: who });
}

/** DEL ключа; n — сколько удалено (0 — удалять было нечего). */
export function del(w: World, who: ActorId): number {
  const had = entry(w) ? 1 : 0;
  if (w.redis) w.redis.entries = w.redis.entries.filter((e) => e.key !== HOT);
  w.actors[who].acts.push({ kind: "del", n: had });
  w.events.push({ kind: had ? "del" : "del0", by: who });
  return had;
}

/** Положить в свой карман L1 то, что в руках; ttlLeft — сколько ему осталось жить. */
export function pocket(w: World, who: ActorId, ttlLeft = L1_TTL): void {
  const a = w.actors[who];
  if (a.hand === null) throw new Error(`L1 без значения у ${who}`);
  a.l1 = { value: a.hand, expiresAt: w.clock + ttlLeft };
}

/** BEGIN; UPDATE links SET long_url=$url WHERE code=HOT — правка видна только автору до COMMIT. */
export function update(w: World, who: ActorId, url: string): void {
  const l = hotLink(w);
  l.draft = url;
  l.lockedBy = who;
  w.actors[who].editing = true;
  w.actors[who].acts.push({ kind: "update" });
  w.events.push({ kind: "update", by: who });
}

export function commit(w: World, who: ActorId): void {
  const l = hotLink(w);
  if (l.lockedBy !== who || l.draft === null) throw new Error(`COMMIT без правки у ${who}`);
  l.url = l.draft;
  l.draft = null;
  l.lockedBy = null;
  w.actors[who].acts.push({ kind: "commit" });
  w.events.push({ kind: "commit", by: who });
}

/** Ответ браузеру: редирект на адрес из рук. stale — расходится с закоммиченным в базе. */
export function reply(w: World, who: ActorId): Click {
  const a = w.actors[who];
  if (a.hand === null) throw new Error(`ответ без адреса у ${who}`);
  const c: Click = { by: who, url: a.hand, stale: a.hand !== hotLink(w).url, slow: overloaded(w) };
  w.clicks.push(c);
  w.events.push({ kind: c.stale ? "stale" : "ok", by: who });
  return c;
}

/** Клик целиком по cache-aside: [L1 →] Redis → промах → база → SET [→ L1] → ответ. */
export function click(w: World, who: ActorId, ttl = TTL): Click {
  if (w.l1 && l1get(w, who) !== null) return reply(w, who);
  if (!w.redis) {
    select(w, who);
    return reply(w, who);
  }
  if (get(w, who) === null) {
    select(w, who);
    set(w, who, ttl);
  }
  if (w.l1) pocket(w, who);
  return reply(w, who);
}

/** Рассылка «сбрось ключ»: остальные поды чистят карман. Сам автор чистит свой отдельно. */
export function publish(w: World, who: ActorId): void {
  w.actors[who].acts.push({ kind: "publish" });
  w.events.push({ kind: "publish", by: who });
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (id === who || !a.present || !a.l1) continue;
    a.l1 = null;
    w.events.push({ kind: "drop", by: id });
  }
}

/** Под упал: незакоммиченная правка откатилась, карман пропал. */
export function crash(w: World, who: ActorId): void {
  const a = w.actors[who];
  const l = hotLink(w);
  if (l.lockedBy === who) {
    l.draft = null;
    l.lockedBy = null;
  }
  a.present = false;
  a.l1 = null;
  a.hand = null;
  a.editing = false;
  w.events.push({ kind: "crash", by: who });
}

/** Нагрузка базы, доля потолка: без кэша — весь поток, с кэшем — только промахи. */
export function dbLoad(w: World): number {
  return (w.redis ? w.flow * w.missRate : w.flow) / DB_CAP;
}

/** Нагрузка узлов Redis, доли потолка: фон других ключей + горячий ключ на своём узле.
 *  С L1 в Redis ходит примерно по запросу от пода раз в L1_TTL. */
export function nodeLoads(w: World): number[] {
  if (!w.redis) return [];
  const hot = w.l1 ? ACTORS.length / L1_TTL : w.flow;
  return Array.from({ length: w.redis.nodes }, (_, i) =>
    (w.redis!.nodes > 1 ? NODE_BASE[i] : 0.05) + (i + 1 === w.redis!.hotNode ? hot / NODE_CAP : 0));
}

/** Самая загруженная точка системы. */
export function peakLoad(w: World): number {
  return Math.max(dbLoad(w), ...nodeLoads(w));
}

export function overloaded(w: World): boolean {
  return peakLoad(w) > 1;
}

/** Хоть один посетитель получил адрес, расходящийся с закоммиченным. */
export function stale(w: World): boolean {
  return w.clicks.some((c) => c.stale);
}
