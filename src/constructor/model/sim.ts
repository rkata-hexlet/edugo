/**
 * Модель уровня «бронь через медленного поставщика» (docs/constructor/level-01.md): мир в тиках, кирпич — правило
 * поведения. Детерминирована: без Math.random, Date.now и DOM; «случайность» — хэш от номера гостя и попытки.
 *
 * Мир: гости волнами жмут «Забронировать», поиск идёт постоянным потоком; оба берут слоты общего пула. Бронь —
 * заявка у нас в базе + вызов поставщика. Поставщик в беде D1 часть запросов держит ~30 с (и всё равно их
 * обрабатывает), в D2 лежит: запросы висят без ответа.
 */

/** T таймаут, O вызов вне транзакции, R ретрай, K ключ идемпотентности, J backoff + jitter, B circuit breaker. */
export type Brick = "T" | "O" | "R" | "K" | "J" | "B";
export const BRICKS: readonly Brick[] = ["T", "O", "R", "K", "J", "B"];

/** Правила провала, номера — как в таблице level-01.md. */
export type Rule = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";

/** Что увидел гость: бронь, «проверяем, подтвердим письмом», «попробуйте позже», страница ошибки через 10 с. */
export type Answer = "confirmed" | "checking" | "refused" | "error";

export type BreakerState = "closed" | "open" | "half";

export interface Phase {
  id: "D1" | "D2";
  /** Длина прогона, тиков. */
  ticks: number;
  /** Волны гостей: с тика 0 каждые `every` тиков, до `until` (не включая); первые волны — размером из `ramp`
   *  (нагрузка нарастает — видно, как копится беда), дальше `size`. */
  waves: { every: number; size: number; until: number; ramp?: number[] };
  /** Поставщик лежит в [from, to): запросы, пришедшие в это время, висят без ответа. */
  down?: { from: number; to: number };
  /** Задержка ответа поставщика, тиков. */
  latency: (guest: Guest, attempt: number) => number;
}

export interface Params {
  tickMs: number;
  pool: number;
  search: { every: number; hold: number; maxWait: number };
  /** Через столько тиков без ответа страница гостя показывает ошибку. */
  guestWait: number;
  /** Сервис отвечает гостю не позже, чем через `budget` (срок всех попыток, если есть T). */
  budget: number;
  timeout: number;
  attempts: number;
  /** Пауза перед n-й повторной попыткой = backoff · 2^(n−1) · u, u ∈ [0, 2) — разброс jitter. */
  backoff: number;
  breaker: { window: number; trip: number; open: number };
  /** Retry storm: больше `cap` повторов за `window` тиков, пока поставщик не лежит. */
  storm: { window: number; cap: number };
  /** В D2 гостей, ждавших отказа дольше `after` тиков, не больше `max` (первые неудачные вызовы — можно). */
  slowRefusal: { after: number; max: number };
}

export interface Guest {
  id: number;
  wave: number;
  /** Номер в волне. */
  seat: number;
  start: number;
  answer?: Answer;
  answeredAt?: number;
}

export interface Violation {
  rule: Rule;
  tick: number;
  guest?: number;
}

/** Срез мира на тик — для отрисовки (этап 3). */
export interface Snapshot {
  tick: number;
  poolUsed: number;
  /** Из них заняты бронями (остальные — поиском). */
  poolBookings: number;
  searchWaiting: number;
  bookingsWaiting: number;
  guestsWaiting: number;
  supplierDown: boolean;
  breaker: BreakerState;
  /** Повторов к поставщику за окно storm. */
  retries: number;
  /** Запросов в работе у поставщика, включая брошенные по таймауту (он их всё равно доделает). */
  atSupplier: number;
  /** Ответы гостям с начала беды. */
  answers: Record<Answer, number>;
  /** Гостей с двумя бронями у поставщика. */
  dupes: number;
  /** Сколько ждёт каждый гость без ответа, тиков; старшие первыми, не больше `SHOWN`. Гость, увидевший страницу
   *  ошибки, ещё секунду стоит в списке с возрастом на момент ошибки — видно, кто упёрся в предел. */
  waits: number[];
  /** Вызовы в работе у поставщика: возраст, тиков, и «брошен» — его уже никто не ждёт (таймаут или гость ушёл). */
  calls: { age: number; orphan: boolean }[];
}

/** Сколько гостей и вызовов срез отдаёт поштучно — столько помещается столбиками на схеме. */
export const SHOWN = 24;

export interface Score {
  guests: number;
  confirmed: number;
  checking: number;
  refused: number;
  errors: number;
  /** Запросов, дошедших до поставщика. */
  requests: number;
  bricks: number;
}

export interface RunResult {
  /** Первое срабатывание каждого правила, по времени. */
  violations: Violation[];
  score: Score;
  snapshots: Snapshot[];
  guests: Guest[];
}

interface Booking extends Guest {
  attempt: number;
  phase: "slot" | "ready" | "calling" | "pause" | "done";
  holdsSlot: boolean;
  call?: Call;
  deadline: number;
  readyAt: number;
}

interface Call {
  booking: Booking;
  doneAt: number; // Infinity — висит
  abandoned: boolean;
  generation: number;
  startedAt: number;
}

type Waiter = { kind: "search"; since: number } | { kind: "booking"; b: Booking };

/** Хэш в [0, 1): одинаков для одного гостя и попытки при любом наборе кирпичей. */
export const unit = (a: number, b: number): number => {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 2 ** 32;
};

/** Разброс jitter: квазислучайная последовательность Вейля — соседние гости расходятся равномерно. */
const spread = (guest: number, attempt: number): number => (((guest + 0.5) * 0.6180339887 + attempt * 0.37) % 1) * 2;

export function run(p: Params, phase: Phase, bricks: ReadonlySet<Brick>): RunResult {
  const has = (b: Brick) => bricks.has(b);
  const violations: Violation[] = [];
  const fired = new Set<Rule>();
  const fail = (rule: Rule, tick: number, guest?: number) => {
    if (fired.has(rule)) return;
    fired.add(rule);
    violations.push({ rule, tick, guest });
  };

  const isDown = (t: number) => !!phase.down && t >= phase.down.from && t < phase.down.to;
  const bookings: Booking[] = [];
  const calls: Call[] = [];
  const queue: Waiter[] = [];
  const leases: { until: number; booking: boolean }[] = []; // короткие слоты: поиск, запись заявки при O
  let held = 0; // слоты, удерживаемые бронями на время вызова (без O)
  const perGuestBookings = new Map<number, number>();
  const keyed = new Set<number>(); // брони у поставщика по нашему номеру (K)
  const retryArrivals: number[] = [];
  const snapshots: Snapshot[] = [];
  let requests = 0;
  let slowRefusals = 0;
  let dupes = 0;
  const answers: Record<Answer, number> = { confirmed: 0, checking: 0, refused: 0, error: 0 };

  // circuit breaker: окно последних исходов, поколение — исходы вызовов прошлого состояния не считаются
  let breaker: BreakerState = "closed";
  let openUntil = 0;
  let generation = 0;
  let outcomes: boolean[] = [];
  let probeInFlight = false;
  const record = (call: Call, ok: boolean, t: number) => {
    if (!has("B") || call.generation !== generation) return;
    if (breaker === "half") {
      probeInFlight = false;
      generation++;
      outcomes = [];
      if (ok) breaker = "closed";
      else ((breaker = "open"), (openUntil = t + p.breaker.open));
      return;
    }
    outcomes.push(ok);
    if (outcomes.length > p.breaker.window) outcomes.shift();
    if (outcomes.filter((o) => !o).length >= p.breaker.trip) {
      breaker = "open";
      openUntil = t + p.breaker.open;
      generation++;
      outcomes = [];
    }
  };

  const answer = (b: Booking, a: Answer, t: number) => {
    b.phase = "done";
    if (b.holdsSlot) ((b.holdsSlot = false), held--);
    if (b.answer) return; // страница ошибки уже показана, сервис доработал впустую
    b.answer = a;
    b.answeredAt = t;
    answers[a]++;
    if (a !== "confirmed" && phase.down && b.start >= phase.down.from && b.start < phase.down.to) {
      if (t - b.start > p.slowRefusal.after && ++slowRefusals > p.slowRefusal.max) fail(has("R") ? "P5" : "P7", t, b.id);
    }
  };

  const failed = (b: Booking, t: number) => {
    const pause = has("J") ? Math.round(p.backoff * 2 ** (b.attempt - 1) * spread(b.id, b.attempt + 1)) : 0;
    // повтор — только если после паузы ещё есть срок: гость всё равно не дождётся
    if (has("R") && b.attempt < p.attempts && t + pause < b.start + p.budget) {
      b.attempt++;
      b.phase = "pause";
      b.readyAt = t + pause;
    } else answer(b, "checking", t);
  };

  for (let t = 0; t < phase.ticks; t++) {
    const down = isDown(t);

    // 1. ответы поставщика, потом таймауты: ответ ровно в срок — успел
    for (const c of calls) {
      if (c.doneAt !== t) continue;
      const g = c.booking.id;
      if (!(has("K") && keyed.has(g))) {
        const n = (perGuestBookings.get(g) ?? 0) + 1;
        perGuestBookings.set(g, n);
        if (n === 2) dupes++;
        if (n > 1) fail("P3", t, g);
        if (has("K")) keyed.add(g);
      }
      if (c.abandoned) continue;
      record(c, true, t);
      c.booking.call = undefined;
      answer(c.booking, "confirmed", t);
    }
    for (const b of bookings) {
      if (b.phase !== "calling" || b.deadline !== t || !b.call) continue;
      b.call.abandoned = true;
      record(b.call, false, t);
      b.call = undefined;
      failed(b, t);
    }

    // 2. пришедшие: волна гостей, запрос поиска
    const w = phase.waves;
    if (t % w.every === 0 && t < w.until) {
      const wave = t / w.every;
      for (let seat = 0; seat < (w.ramp?.[wave] ?? w.size); seat++) {
        const b: Booking = {
          id: bookings.length, wave, seat, start: t, attempt: 1, phase: "slot",
          holdsSlot: false, deadline: Infinity, readyAt: t,
        };
        bookings.push(b);
        queue.push({ kind: "booking", b });
      }
    }
    if (t % p.search.every === 0) queue.push({ kind: "search", since: t });

    // 3. пул: короткие слоты освобождаются, очередь — по порядку
    for (let i = leases.length - 1; i >= 0; i--) if (leases[i].until <= t) leases.splice(i, 1);
    while (queue.length && leases.length + held < p.pool) {
      const q = queue.shift()!;
      if (q.kind === "search") leases.push({ until: t + p.search.hold, booking: false });
      else if (has("O")) (leases.push({ until: t + 1, booking: true }), (q.b.phase = "ready"));
      else ((q.b.holdsSlot = true), held++, (q.b.phase = "ready"));
    }

    // 4. попытки: выключатель, вызов, срок
    if (has("B") && (breaker as BreakerState) === "open" && t >= openUntil) breaker = "half";
    for (const b of bookings) {
      const go = (b.phase === "ready" || b.phase === "pause") && b.readyAt <= t;
      if (!go) continue;
      if (has("B")) {
        const st = breaker as BreakerState; // меняется и в record() — сужение типа tsc тут неверно
        const reject = st === "open" || (st === "half" && probeInFlight);
        if (reject) {
          answer(b, "refused", t); // ошибку открытого выключателя не повторяем
          continue;
        }
        if (st === "half") probeInFlight = true;
      }
      const call: Call = {
        booking: b, abandoned: false, generation, startedAt: t,
        doneAt: down ? Infinity : t + phase.latency(b, b.attempt),
      };
      calls.push(call);
      requests++;
      if (b.attempt > 1 && !down) retryArrivals.push(t);
      b.call = call;
      b.phase = "calling";
      b.deadline = has("T") ? t + Math.min(p.timeout, Math.max(1, b.start + p.budget - t)) : Infinity;
    }

    // 5. проверки
    const sw = queue.filter((q) => q.kind === "search");
    if (sw.length && t - (sw[0] as { since: number }).since > p.search.maxWait) fail("P1", t);
    for (const b of bookings) {
      if (b.answer || t - b.start < p.guestWait) continue;
      b.answer = "error";
      b.answeredAt = t;
      answers.error++;
      fail(has("B") && !has("T") && down ? "P6" : "P2", t, b.id);
    }
    while (retryArrivals.length && retryArrivals[0] <= t - p.storm.window) retryArrivals.shift();
    if (!down && retryArrivals.length > p.storm.cap) fail("P4", t);

    snapshots.push({
      tick: t,
      poolUsed: leases.length + held,
      poolBookings: held + leases.filter((l) => l.booking).length,
      searchWaiting: sw.length,
      bookingsWaiting: queue.length - sw.length,
      guestsWaiting: bookings.filter((b) => !b.answer).length,
      supplierDown: down,
      breaker: has("B") ? breaker : "closed",
      retries: retryArrivals.length,
      atSupplier: calls.filter((c) => c.doneAt > t).length,
      answers: { confirmed: answers.confirmed, checking: answers.checking, refused: answers.refused, error: answers.error },
      dupes,
      waits: bookings
        .filter((b) => !b.answer || (b.answer === "error" && t - b.answeredAt! < 10))
        .slice(0, SHOWN).map((b) => (b.answer ? b.answeredAt! : t) - b.start),
      calls: calls.filter((c) => c.doneAt > t).slice(0, SHOWN)
        .map((c) => ({ age: t - c.startedAt, orphan: c.abandoned || c.booking.call !== c || !!c.booking.answer })),
    });
  }

  const count = (a: Answer) => bookings.filter((b) => b.answer === a).length;
  return {
    violations,
    snapshots,
    guests: bookings,
    score: {
      guests: bookings.length,
      confirmed: count("confirmed"),
      checking: count("checking"),
      refused: count("refused"),
      errors: count("error"),
      requests,
      bricks: bricks.size,
    },
  };
}

/** Уровень: числа мира, беды по порядку, стоп-кадры провалов (текст поломки и кадр ролика). */
export interface Level {
  id: string;
  title: string;
  params: Params;
  phases: readonly Phase[];
  failures: Record<Rule, { text: string; why: string; frame: number }>;
}

/** «Запуск»: беды по порядку, прогон встаёт на первом провале. Победа — все беды без провалов. */
export function play(level: Level, bricks: ReadonlySet<Brick>) {
  const runs: { phase: Phase; result: RunResult }[] = [];
  for (const phase of level.phases) {
    const result = run(level.params, phase, bricks);
    runs.push({ phase, result });
    const first = result.violations[0];
    if (first) return { runs, failure: { ...first, phase: phase.id, ...level.failures[first.rule] } };
  }
  const total = (k: keyof Score) => runs.reduce((n, r) => n + r.result.score[k], 0);
  return {
    runs,
    score: { guests: total("guests"), confirmed: total("confirmed"), requests: total("requests"), bricks: bricks.size },
  };
}
