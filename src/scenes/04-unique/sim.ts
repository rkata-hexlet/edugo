// Мини-модель уникальных посетителей: браузеры с visitor ID в cookie (`vid`), поды с копилкой окна (set visitor ID
// или 16 регистров HyperLogLog), база — счётчик uniques, список visitors или регистры link_uniques по дням. Внешний мир —
// «людей было» (сколько разных visitor ID на самом деле). Детерминирована: хэш FNV-1a + fmix32 (murmur3), толпа и дни —
// visitor ID по формуле, без случайности.

import type { Board, Verdict } from "../../kit/director";

export type ActorId = "A" | "B" | "C";
export const ACTORS: ActorId[] = ["A", "B", "C"];

export const HOT = "x7Kp2";

/** Ящиков HLL в кадре (старшие 4 бита хэша) и в «настоящем» HLL (p = 14). */
export const BOXES = 16;
export const REAL_BOXES = 16_384;
/** Окно сброса копилки пода, с (как в эпизоде 03). */
export const WINDOW = 5;

/** Visitor ID героев подобраны под регистры (tech-expert): Аня — регистр 5 (2 нуля), Борис — регистр 11. */
export const PEOPLE = {
  anya: { name: "Аня", vid: "8b91" },
  boris: { name: "Борис", vid: "2346" },
} as const;
/** Как считаются уникальные: set у пода + счётчик в базе, общий список visitor ID, регистры HLL. */
export type Mode = "counter" | "list" | "hll";

/** Что под сделал в этом кадре — стрелки и мысли кадра. */
export type Act =
  | { kind: "reply"; vid: string }
  | { kind: "cookie"; vid: string } // выдал visitor ID браузеру без cookie
  | { kind: "new"; vid: string } // в set нет — «Новая!»
  | { kind: "known"; vid: string } // в set есть
  | { kind: "reg"; vid: string; box: number; changed: boolean } // visitor ID лёг в регистр
  | { kind: "flush"; n: number; regs?: number[] } // сброс копилки в базу (у HLL — какие регистры отнёс)
  | { kind: "insert"; vid: string; dup: boolean }; // INSERT … ON CONFLICT DO NOTHING

export interface Actor {
  id: ActorId;
  label: string;
  /** Set: visitor ID, увиденные в этом окне (пустеет со сбросом). */
  seen: string[];
  /** Новых в этом окне — столько под прибавит к uniques при сбросе. */
  fresh: number;
  /** Регистры HLL пода в этом окне: максимум ρ (нулей + 1), 0 — пусто. */
  regs: number[];
  acts: Act[];
}

/** Браузер справа: имя, visitor ID (null — cookie ещё нет), кликов. */
export interface Browser {
  name: string;
  vid: string | null;
  clicks: number;
}

/** Visitor ID, прогнанный через хэш, — то, что показывает «лаборатория» в кадре. */
export interface Probe {
  vid: string;
  bits: string; // 32 бита
  box: number;
  zeros: number;
  changed: boolean;
  /** Чей хэш: под (кадр «хэш у всех подов один»); нет — visitor ID пришёл сам. */
  by?: ActorId;
}

/** День календаря (кейс 2): уникальные за день числом и регистрами. */
export interface Day {
  label: string;
  uniques: number;
  regs: number[];
}

export type Focus = ActorId | "table" | "row" | "list" | "boxes" | "probe" | "estimate" | "browsers" | "board" | "clock" | "sql" | "weight" | "days" | "jar";

export type EventKind =
  | "click" | "cookie" | "new" | "known" | "flush" | "insert" | "skip" | "reg" | "flat" | "flood" | "merge" | "sum"
  | "clock" | "grow" | "card" | "page" | "rewind" | "verdict";

export interface SimEvent {
  kind: EventKind;
  n?: number;
  by?: ActorId;
  lamps?: Verdict;
}

/** Кадр эпизода 03, повторённый сценой (отсылка назад): какой кадр по началу закадра. */
export interface Flashback {
  voice: string;
}

export interface World {
  clock: number;
  mode: Mode;
  actors: Record<ActorId, Actor>;
  browsers: Browser[];
  /** Внешний мир: разные visitor ID, которые на самом деле кликали (толпа — числом). */
  people: string[];
  crowd: number;
  /** link_stats: клики и счётчик уникальных (попытка «set»). */
  clicks: number;
  uniques: number;
  /** visitors: точный список visitor ID; bulk — «ещё миллионы» строк того же списка (образ размера). */
  visitors: string[];
  bulk: number;
  /** link_uniques: регистры HLL ссылки за сегодня. */
  regs: number[];
  /** Оценка «настоящего» HLL на 16 384 регистрах по тем же visitor ID (считается при толпе). */
  real: number | null;
  /** visitor ID, прогнанные через хэш в этом кадре («лаборатория»). */
  probes: Probe[];
  /** Кейс 2: календарь дней; period — сколько последних дней сливает запрос (null — не сливаем). */
  days: Day[] | null;
  period: number | null;
  /** Оценки за периоды (кейс 2): последние n дней — слиянием 16 регистров, «настоящим» HLL и на самом деле. */
  periods: { n: number; est: number; real: number; truth: number }[];
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

// --- Хэш и HyperLogLog ---

/** 32-битный хэш visitor ID: FNV-1a + финализатор murmur3 (хорошо перемешивает, детерминирован). */
export function hash(vid: string): number {
  let h = 0x811c9dc5;
  for (const c of vid) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Регистр и максимум visitor ID: старшие p бит — номер регистра, ρ = ведущие нули остатка + 1. */
export function place(vid: string, p = 4): { box: number; rho: number } {
  const h = hash(vid);
  const rest = (h << p) >>> 0;
  const zeros = rest === 0 ? 32 - p : Math.min(Math.clz32(rest), 32 - p);
  return { box: h >>> (32 - p), rho: zeros + 1 };
}

export function probe(vid: string, regs: number[]): Probe {
  const { box, rho } = place(vid);
  return { vid, bits: hash(vid).toString(2).padStart(32, "0"), box, zeros: rho - 1, changed: rho > regs[box] };
}

export const empty = (m = BOXES) => new Array<number>(m).fill(0);

/** Оценка HLL: α·m²/Σ2^(−M); на малых — linear counting m·ln(m/V). */
export function estimate(regs: number[]): number {
  const m = regs.length;
  const alpha = m === 16 ? 0.673 : 0.7213 / (1 + 1.079 / m);
  let sum = 0;
  let zero = 0;
  for (const r of regs) {
    sum += 2 ** -r;
    if (!r) zero++;
  }
  const e = (alpha * m * m) / sum;
  return e <= 2.5 * m && zero > 0 ? m * Math.log(m / zero) : e;
}

export function addTo(regs: number[], vid: string, p = 4): boolean {
  const { box, rho } = place(vid, p);
  if (rho <= regs[box]) return false;
  regs[box] = rho;
  return true;
}

/** Слияние регистров: в каждом — больший максимум. */
export function merge(into: number[], from: number[]): void {
  from.forEach((r, i) => (into[i] = Math.max(into[i], r)));
}

/** «Настоящий» HLL на 16 384 регистрах по списку visitor ID. */
export function realEstimate(vids: Iterable<string>): number {
  const regs = empty(REAL_BOXES);
  for (const v of vids) addTo(regs, v, 14);
  return estimate(regs);
}

/** Visitor ID посетителя толпы — по формуле, без случайности. */
export const crowdVid = (i: number) => `v${i}`;

// --- Мир ---

export function world(): World {
  const actor = (id: ActorId): Actor => ({ id, label: `Pod ${id}`, seen: [], fresh: 0, regs: empty(), acts: [] });
  return {
    clock: 0,
    mode: "counter",
    actors: { A: actor("A"), B: actor("B"), C: actor("C") },
    browsers: [{ name: PEOPLE.anya.name, vid: PEOPLE.anya.vid, clicks: 0 }],
    people: [],
    crowd: 0,
    clicks: 1_204_310,
    uniques: 0,
    visitors: [],
    bulk: 0,
    regs: empty(),
    real: null,
    probes: [],
    days: null,
    period: null,
    periods: [],
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

/** Сколько людей было на самом деле: разные visitor ID + толпа. */
export function truth(w: World): number {
  return w.people.length + w.crowd;
}

/** Сколько уникальных покажет автору база (с учётом того, что ещё в копилках подов). */
export function reported(w: World): number {
  if (w.mode === "counter") return w.uniques + ACTORS.reduce((s, id) => s + w.actors[id].fresh, 0);
  if (w.mode === "list") return new Set([...w.visitors, ...ACTORS.flatMap((id) => w.actors[id].seen)]).size + w.bulk;
  const all = w.regs.slice();
  for (const id of ACTORS) merge(all, w.actors[id].regs);
  return estimate(all);
}

/** Завышаем: счётчик больше, чем людей (точные способы — строго; HLL — за пределами ошибки 16 регистров). */
export function inflated(w: World): boolean {
  const r = reported(w);
  return w.mode === "hll" ? r > truth(w) * 1.6 : r > truth(w);
}

/** Сколько весит подсчёт ссылки за день, байт: set окна, список visitor ID или 16 регистров. */
export function weight(w: World): number {
  if (w.mode === "list") return (w.visitors.length + w.bulk) * 100; // строка с заголовком кортежа и индексом
  if (w.mode === "hll") return REAL_BOXES * 6 / 8; // 6 бит на регистр, как в Redis — около 12 КБ
  return ACTORS.reduce((s, id) => s + w.actors[id].seen.length * 16, 0);
}

/** «Весит мало»: не растёт с числом людей — до мегабайта на ссылку и день. */
export function light(w: World): boolean {
  return weight(w) < 1_000_000;
}

/** Браузер героя по visitor ID; герой, кликнувший впервые, появляется справа. */
function browser(w: World, vid: string): Browser | undefined {
  const hero = Object.values(PEOPLE).find((p) => p.vid === vid);
  if (hero && !w.browsers.some((b) => b.vid === vid)) w.browsers.push({ name: hero.name, vid, clicks: 0 });
  return w.browsers.find((b) => b.vid === vid);
}

/** Браузер без cookie: под выдаёт ему visitor ID (Set-Cookie). */
export function cookie(w: World, who: ActorId, name: string, vid: string): void {
  const b = w.browsers.find((x) => x.name === name)!;
  b.vid = vid;
  w.actors[who].acts.push({ kind: "cookie", vid });
  w.events.push({ kind: "cookie", by: who });
}

/** Клик браузера с visitor ID vid пришёл к поду who. Дальше — по способу подсчёта. */
export function click(w: World, who: ActorId, vid: string): void {
  const a = w.actors[who];
  const b = browser(w, vid);
  if (b) b.clicks++;
  w.clicks++;
  if (!w.people.includes(vid)) w.people.push(vid);
  a.acts.push({ kind: "reply", vid });
  w.events.push({ kind: "click", by: who });
  if (w.mode === "hll") {
    const p = probe(vid, a.regs);
    addTo(a.regs, vid);
    a.acts.push({ kind: "reg", vid, box: p.box, changed: p.changed });
    w.events.push({ kind: p.changed ? "reg" : "flat", by: who });
    return;
  }
  if (a.seen.includes(vid)) {
    a.acts.push({ kind: "known", vid });
    w.events.push({ kind: "known", by: who });
    return;
  }
  a.seen.push(vid);
  if (w.mode === "counter") {
    a.fresh++;
    a.acts.push({ kind: "new", vid });
    w.events.push({ kind: "new", by: who });
  }
}

/** Visitor ID в «лаборатории» кадра: хэш, регистр, нули — против регистров базы. */
export function look(w: World, vid: string): Probe {
  const p = probe(vid, w.regs);
  w.probes.push(p);
  return p;
}

/** Visitor ID напрямую в регистры базы (кадры объяснения HLL: без подов). */
export function record(w: World, vid: string): void {
  const p = look(w, vid);
  const b = browser(w, vid);
  if (b) b.clicks++;
  if (!w.people.includes(vid)) w.people.push(vid);
  addTo(w.regs, vid);
  w.events.push({ kind: p.changed ? "reg" : "flat" });
}

/** Сброс копилки пода по окну: set → +fresh в uniques, visitor ID → INSERT, регистры → слияние в базе. */
export function flush(w: World, who: ActorId): void {
  const a = w.actors[who];
  if (w.mode === "counter") {
    w.uniques += a.fresh;
    a.acts.push({ kind: "flush", n: a.fresh });
  } else if (w.mode === "list") {
    for (const vid of a.seen) {
      const dup = w.visitors.includes(vid);
      if (!dup) w.visitors.push(vid);
      a.acts.push({ kind: "insert", vid, dup });
      w.events.push({ kind: dup ? "skip" : "insert", by: who });
    }
  } else {
    const before = w.regs.join();
    merge(w.regs, a.regs);
    a.acts.push({ kind: "flush", n: 0, regs: a.regs.slice() });
    w.events.push({ kind: before === w.regs.join() ? "flat" : "merge", by: who });
  }
  w.events.push({ kind: "flush", by: who, n: a.fresh });
  a.seen = [];
  a.fresh = 0;
  a.regs = empty();
}

export function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
}

/** Толпа: n разных посетителей прошли через поды и сброшены в регистры базы; «настоящий» HLL — по тем же visitor ID. */
export function flood(w: World, n: number): void {
  for (let i = 0; i < n; i++) addTo(w.regs, crowdVid(i));
  w.crowd = n;
  w.real = realEstimate([...w.people, ...Array.from({ length: n }, (_, i) => crowdVid(i))]);
  w.events.push({ kind: "flood", n });
}

/** Список visitor ID дорос до популярной ссылки: «ещё миллионы» строк. */
export function grow(w: World, n: number): void {
  w.bulk = n;
  w.crowd = n;
  w.events.push({ kind: "grow", n });
}

// --- Кейс 2: дни ---

export const YEAR = 365;
/** Постоянных читателей: каждый день кликает Аня и 40 человек из этого круга. */
export const REGULARS = 2_000;
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dayLabel(d: number): string {
  let m = 0;
  while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
  return `${d + 1} ${MONTHS[m]}`;
}

/** Посетители дня d: Аня и 40 постоянных (visitor ID по формуле). */
export function dayVisitors(d: number): string[] {
  const out: string[] = [PEOPLE.anya.vid];
  for (let k = 0; k < 40; k++) out.push(`r${(d * 7_919 + k * 104_729) % REGULARS}`);
  return [...new Set(out)];
}

/** Год по дням: в каждом дне — число уникальных за день и его регистры. */
export function year(w: World): void {
  const all = new Set<string>();
  w.days = Array.from({ length: YEAR }, (_, d) => {
    const vids = dayVisitors(d);
    vids.forEach((v) => all.add(v));
    const regs = empty();
    vids.forEach((v) => addTo(regs, v));
    return { label: dayLabel(d), uniques: vids.length, regs };
  });
  w.people = [...all];
  w.crowd = 0;
}

/** Сумма дневных уникальных за последние n дней. */
export function daySum(w: World, n = YEAR): number {
  return w.days!.slice(-n).reduce((s, d) => s + d.uniques, 0);
}

/** Слияние регистров последних n дней — оценка за период. */
export function union(w: World, n = YEAR): number[] {
  const regs = empty();
  for (const d of w.days!.slice(-n)) merge(regs, d.regs);
  return regs;
}

/** Людей на самом деле за последние n дней. */
export function periodTruth(n = YEAR): number {
  return new Set(Array.from({ length: n }, (_, i) => dayVisitors(YEAR - n + i)).flat()).size;
}

/** «Настоящий» HLL за последние n дней. */
export function periodReal(n = YEAR): number {
  return realEstimate(Array.from({ length: n }, (_, i) => dayVisitors(YEAR - n + i)).flat());
}

/** Оценки за последние n дней для кадра «любой период». */
export function periodsOf(w: World, ns: number[]): void {
  w.periods = ns.map((n) => ({ n, est: estimate(union(w, n)), real: periodReal(n), truth: periodTruth(n) }));
}
