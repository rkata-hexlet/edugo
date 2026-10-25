// Мини-модель ночной задачи сервиса оплаты: cron в каждом поде списывает абонентку через банк (внешний эффект, таблица
// его не видит) и пишет списание в charges. Замок advisory lock принадлежит соединению пода с базой: закрылось
// соединение — база отпустила замок; соединение молчит (узел пропал из сети) — для базы оно живо, и замок висит.
// Аренда лидера — строка leader со сроком по часам БД: забрать роль можно, только когда срок вышел; просрочку видит
// следующий захват, сама база ничего не замечает. Под не знает, что его сменили: вера «я лидер» — у пода, срок — у базы.
// Банк, получивший тот же ключ, не списывает второй раз, а возвращает прежний результат.
// Детерминирована: время — счётчик секунд, который двигает сценарий.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B" | "C";
export const ACTORS: ActorId[] = ["A", "B", "C"];

export const AMOUNT = 299;
/** Баланс Иры после эпизода 08: кроссовки оплачены один раз. */
export const BALANCE = 4010;
export const PERIOD = "2026-11";
/** Номер, о котором договорились поды. */
export const LOCK_ID = 9001;
/** Срок аренды лидера, с. */
export const LEASE = 15;
/** 03:00 ночи по часам БД. */
export const NIGHT = 3 * 3600;

export interface Sub {
  id: number;
  user: string;
}
/** Подписки на сегодня — в порядке, в котором их берёт задача. */
export const SUBS: Sub[] = [{ id: 42, user: "Ира" }, { id: 17, user: "Олег" }, { id: 58, user: "Марта" }];
export const IRA = 42;

/** Строка charges: кто записал списание. */
export interface ChargeRow {
  sub: number;
  period: string;
  by: ActorId;
}

/** Списание в журнале банка; key — ключ, переданный банку. */
export interface Charge {
  sub: number;
  period: string;
  key: string | null;
  by: ActorId;
}

/** Соединение пода с базой: открыто, молчит (узел пропал — для базы живо), закрыто. */
export type Conn = "open" | "silent" | "closed";

/** Строка leader: кто лидер, номер срока лидерства, до какого времени по часам БД. */
export interface LeaderRow {
  holder: ActorId | null;
  epoch: number;
  leaseUntil: number;
}

/** Что под сделал в кадре — стрелки кадра. */
export type Act =
  | { kind: "bank"; sub: number; key: string | null; replayed: boolean } // под → банк
  | { kind: "db" } // под → база (запись, захват, продление)
  | { kind: "knock" }; // проиграл замок: «занято»

export interface Actor {
  id: ActorId;
  label: string;
  dead: boolean;
  hidden: boolean;
  conn: Conn;
  /** Под уверен, что он лидер: держит замок или аренду, как сам считает. */
  leader: boolean;
  alarm: boolean; // звенит будильник cron
  atBank: boolean; // запрос в банке, ответа ещё нет
  asleep: boolean;
  thought: string | null;
  crossed: string | null;
  acts: Act[];
}

export interface Ira {
  balance: number;
  asleep: boolean;
  /** Уведомления «Списано 299 ₽» за ночь. */
  notes: number;
}

export type Focus = ActorId | "ira" | "bank" | "subs" | "charges" | "leader" | "board" | "sql" | "code" | "db" | "conn";

export type EventKind =
  | "cron" | "charge" | "double" | "replayed" | "insert" | "lock" | "busy" | "unlock" | "crash" | "silent" | "cut"
  | "takeover" | "renew" | "lost" | "restart" | "tick" | "note"
  | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  by?: ActorId;
  lamps?: Verdict;
  /** tick: сколько секунд прошло. */
  n?: number;
}

export interface World {
  clock: number;
  charges: ChargeRow[];
  ledger: Charge[];
  /** Память банка: ключ → номер списания в журнале. */
  bankKeys: Record<string, number>;
  /** Advisory lock 9001: у чьего соединения (null — свободен). */
  lockBy: ActorId | null;
  leader: LeaderRow | null;
  ira: Ira;
  actors: Record<ActorId, Actor>;
  /** Подача: что показано в кадре. */
  shown: { subs: boolean; charges: boolean; conns: boolean; clock: boolean; epoch: boolean };
  /** «?» над подом: умер или молчит? */
  doubt: ActorId | null;
  bank: string | null;
  /** На стрелке в банк — пустое место ключа: ночная задача ходит без ключа. */
  slot: boolean;
  /** Врезка: объект Lease в Kubernetes. */
  aside: "lease" | null;
  code: { title: string; lines: string[]; mark: { line: number; tone: "warn" | "ok"; note?: string }[] } | null;
  /** Кадр эпизода 08 во вставке (номер шага) или null. */
  flashback: number | null;
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

export function world(): World {
  const actor = (id: ActorId): Actor => ({
    id, label: `Pod ${id}`, dead: false, hidden: false, conn: "open", leader: false, alarm: false, atBank: false, asleep: false,
    thought: null, crossed: null, acts: [],
  });
  return {
    clock: NIGHT,
    charges: [],
    ledger: [],
    bankKeys: {},
    lockBy: null,
    leader: null,
    ira: { balance: BALANCE, asleep: true, notes: 0 },
    actors: { A: actor("A"), B: actor("B"), C: actor("C") },
    shown: { subs: true, charges: true, conns: false, clock: false, epoch: false },
    doubt: null,
    bank: null,
    slot: false,
    aside: null,
    code: null,
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

function alive(w: World, who: ActorId): Actor {
  const a = w.actors[who];
  if (a.dead) throw new Error(`${who}: под упал`);
  return a;
}

/** Под говорит с базой: соединение должно быть открыто. */
function talk(w: World, who: ActorId): Actor {
  const a = alive(w, who);
  if (a.conn !== "open") throw new Error(`${who}: нет связи с базой`);
  a.acts.push({ kind: "db" });
  return a;
}

/** В 03:00 звенит будильник cron в поде. */
export function ring(w: World, who: ActorId): void {
  alive(w, who).alarm = true;
  w.events.push({ kind: "cron", by: who });
}

/** Ключ из бизнес-факта: одинаков у любого лидера. */
export const factKey = (sub: number) => `sub-${sub}:${PERIOD}`;

/**
 * Вызов банка — связь пода с банком не зависит от связи с базой. Тот же ключ банк уже видел — возвращает прежний
 * результат и не списывает. Возвращает true, если деньги ушли сейчас.
 */
export function charge(w: World, who: ActorId, sub: number, key: string | null = null): boolean {
  const a = alive(w, who);
  a.atBank = false;
  if (key !== null && key in w.bankKeys) {
    a.acts.push({ kind: "bank", sub, key, replayed: true });
    w.events.push({ kind: "replayed", by: who });
    return false;
  }
  const dup = w.ledger.some((c) => c.sub === sub && c.period === PERIOD);
  w.ledger.push({ sub, period: PERIOD, key, by: who });
  if (key !== null) w.bankKeys[key] = w.ledger.length - 1;
  if (sub === IRA) w.ira.balance -= AMOUNT;
  a.acts.push({ kind: "bank", sub, key, replayed: false });
  w.events.push({ kind: dup ? "double" : "charge", by: who });
  return true;
}

/** Под шлёт Ире уведомление «Списано 299 ₽» (после ответа банка, как в коде задачи). */
export function notify(w: World, who: ActorId): void {
  alive(w, who);
  w.ira.notes++;
  w.events.push({ kind: "note", by: who });
}

/** SELECT по charges: записано ли списание подписки за этот месяц. */
export function recorded(w: World, who: ActorId, sub: number): boolean {
  talk(w, who);
  return w.charges.some((c) => c.sub === sub && c.period === PERIOD);
}

/** INSERT INTO charges (autocommit). */
export function record(w: World, who: ActorId, sub: number): void {
  talk(w, who);
  w.charges.push({ sub, period: PERIOD, by: who });
  w.events.push({ kind: "insert", by: who });
}

/** SELECT pg_try_advisory_lock(9001): замок берётся на соединении пода. */
export function tryLock(w: World, who: ActorId): boolean {
  const a = talk(w, who);
  if (w.lockBy === null) {
    w.lockBy = who;
    a.leader = true;
    w.events.push({ kind: "lock", by: who });
    return true;
  }
  if (w.lockBy === who) return true;
  a.acts.push({ kind: "knock" });
  w.events.push({ kind: "busy", by: who });
  return false;
}

/** Закрыть соединение: бэкенд сессии завершается, база отпускает её замок. */
function close(w: World, who: ActorId): void {
  w.actors[who].conn = "closed";
  if (w.lockBy === who) {
    w.lockBy = null;
    w.events.push({ kind: "unlock", by: who });
  }
}

/** Под упал (OOM Killer): процесс убит, ядро закрывает его сокет. */
export function crash(w: World, who: ActorId): void {
  const a = w.actors[who];
  a.dead = true;
  a.alarm = false;
  a.leader = false;
  a.thought = null;
  close(w, who);
  w.events.push({ kind: "crash", by: who });
}

/** Узел пода пропал из сети: ни FIN, ни RST. Для базы соединение живо — замок висит. Под недоступен никому. */
export function vanish(w: World, who: ActorId): void {
  const a = w.actors[who];
  a.dead = true;
  a.alarm = false;
  a.conn = "silent";
  w.events.push({ kind: "silent", by: who });
}

/** Под жив, но связь с базой пропала; до банка он достучаться может. */
export function cut(w: World, who: ActorId): void {
  alive(w, who).conn = "silent";
  w.events.push({ kind: "cut", by: who });
}

/** Kubernetes перезапускает под (Job): новый процесс, новое соединение, память пустая. */
export function restart(w: World, who: ActorId): void {
  const a = w.actors[who];
  a.dead = false;
  a.conn = "open";
  a.leader = false;
  w.events.push({ kind: "restart", by: who });
}

/**
 * UPDATE leader SET holder = $me, epoch = epoch + 1, lease_until = now() + 15s WHERE lease_until < now():
 * роль берётся, только когда срок вышел (или роль свободна).
 */
export function acquire(w: World, who: ActorId): boolean {
  const a = talk(w, who);
  const l = w.leader;
  if (l && l.holder !== null && l.leaseUntil >= w.clock) {
    if (l.holder !== who) {
      a.acts.push({ kind: "knock" });
      w.events.push({ kind: "busy", by: who });
    }
    return l.holder === who;
  }
  const epoch = (l?.epoch ?? 0) + 1;
  // Прежнему лидеру никто не сообщает: его вера «я лидер» остаётся, пока он сам не попробует продлить.
  w.leader = { holder: who, epoch, leaseUntil: w.clock + LEASE };
  a.leader = true;
  w.events.push({ kind: "takeover", by: who });
  return true;
}

/** Продление: UPDATE … WHERE holder = $me; 0 строк — «я больше не лидер». Без связи с базой продлить нельзя. */
export function renew(w: World, who: ActorId): boolean {
  const a = talk(w, who);
  const l = w.leader;
  if (!l || l.holder !== who) {
    a.leader = false;
    w.events.push({ kind: "lost", by: who });
    return false;
  }
  l.leaseUntil = w.clock + LEASE;
  w.events.push({ kind: "renew", by: who });
  return true;
}

/** Часы БД идут. */
export function advance(w: World, seconds: number): void {
  w.clock += seconds;
  w.events.push({ kind: "tick", n: seconds });
}

/** Сколько раз банк списал подписку за этот месяц. */
export const times = (w: World, sub: number) => w.ledger.filter((c) => c.sub === sub && c.period === PERIOD).length;

/** Хоть одну подписку списали дважды. */
export function duplicated(w: World): boolean {
  return SUBS.some((s) => times(w, s.id) > 1);
}

/** Работа доделана: банк списал каждую подписку. */
export function finished(w: World): boolean {
  return SUBS.every((s) => times(w, s.id) > 0);
}

/** Лидеров по вере подов (живых). */
export function leaders(w: World): ActorId[] {
  return ACTORS.filter((id) => !w.actors[id].dead && w.actors[id].leader);
}
