import type { Step } from "../../engine/contract";
import type { Code } from "../../kit/code";
import { Director } from "../../kit/director";
import {
  OUR_REF, backlog, book, closeBreaker, giveUp, halfOpen, retryWave, search, serve, setClock, timeout, world,
  type Focus, type PodId, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/10-timeouts.md (сценарий v0.1) и раскадровкой v1
// (docs/reviews/10-scriptwriter-arc.md; развилка C: bulkhead — фразой в кадре «вызов вне транзакции»).
// MVP: все акты подряд серыми фигурами, без полировки.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  case1: "Кейс 1",
  forever: "1.1 Ждём сколько угодно",
  timeout: "1.2 Таймаут 3 с",
  outside: "1.3 Вызов вне транзакции",
  case2: "Кейс 2",
  answer: "2.0 А бронь-то есть?",
  now: "2.1 Повторить сразу",
  key: "2.2 Наш номер брони",
  backoff: "2.3 Exponential backoff",
  jitter: "2.4 Jitter",
  case3: "Кейс 3",
  storm: "3.1 Повторы, как было",
  open: "3.2 Circuit breaker",
  stuck: "3.3 Open навсегда",
  half: "3.4 Half-open",
  summary: "Итог",
} as const;

/** Исключения произношения для синтеза; экран и субтитр не меняются. */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
};

const SECOND = 1000;

/** Код брони на Go: вызов поставщика внутри транзакции (знакомство) и вне её (кейс 1). */
export const CODE_TX: Code = {
  title: "Бронь · Go",
  lines: [
    "tx, _ := db.BeginTx(ctx, nil)",
    "tx.Exec(`INSERT INTO bookings VALUES ($1, 'pending')`, id)",
    "res, err := supplier.Book(ctx, req)",
    "tx.Exec(`UPDATE bookings SET status='confirmed' WHERE id=$1`, id)",
    "tx.Commit()",
  ],
  mark: [],
};
export const CODE_OUT: Code = {
  title: "Бронь · Go · вызов вне транзакции",
  lines: [
    "db.Exec(`INSERT INTO bookings VALUES ($1, 'pending')`, id)",
    "",
    "res, err := supplier.Book(ctx, req)",
    "",
    "db.Exec(`UPDATE bookings SET status='confirmed' WHERE id=$1`, id)",
  ],
  mark: [{ line: 2, tone: "ok", note: "слот свободен" }],
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? ""].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

class Shots extends Director<Focus, World> {
  private replaying = false;

  constructor() {
    super(world);
  }

  override scene(act: string, w?: World, o?: { replay?: boolean }): void {
    super.scene(act, w, o);
    this.replaying = act === ACT.summary;
  }

  protected hold(caption: string, w: World): number {
    return holdFor(caption, w);
  }

  protected override clear(w: World): void {
    for (const p of Object.values(w.pods)) p.acts = [];
    w.code = null;
  }

  protected override finish(w: World): void {
    w.replay = this.replaying;
  }
}

/** Мир кейсов: поставщик тормозит (30 с, перед ним очередь чужих броней), поток броней 1,5 в секунду. */
function slow({ timeout = null as number | null, key = false } = {}): World {
  const w = world();
  w.clock = 60 * SECOND;
  w.supplier.latency = 30 * SECOND;
  w.bookFlow = 1.5;
  w.policy.timeout = timeout;
  w.policy.key = key;
  backlog(w, 6);
  return w;
}

/** Мир кейса 3: поставщик лёг. */
function down(): World {
  const w = slow({ timeout: 3 * SECOND });
  w.supplier.latency = null;
  w.policy.key = true;
  return w;
}

/** Каждый под берёт по две брони: шесть слотов из шести. */
function fillPool(w: World): void {
  for (const who of ["A", "B", "C", "A", "B", "C"] as PodId[]) book(w, who);
}

const think = (w: World, text: string | null, ...who: PodId[]) => who.forEach((id) => (w.pods[id].thought = text));

/** Часы: мс от 12:00:00. */
export function clock(ms: number): string {
  const t = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${12 + Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: поиск, поставщик, пул, код брони, норма.
  d.scene(ACT.intro);
  d.shot("", (w) => {
    search(w, "A");
  }, {
    focus: ["A", "guests", "pool", "db"],
    voice: "Это сервис бронирования отелей. Сегодня он сделает странную вещь: перестанет показывать номера из-за чужого сервиса, к которому поиск вообще не ходит. А пока всё спокойно: гость ищет номер на выходные, под A читает предложения из нашей базы и отвечает за долю секунды.",
  });
  d.shot("", undefined, {
    focus: ["supplier", "rows"],
    voice: "Но номера принадлежат не нам, а сети отелей. Мы для неё посредник: у сети свой сервис, и только он может подтвердить, что номер свободен. Поэтому бронировать мы можем лишь с её согласия, иначе продадим номер, которого уже нет.",
  });
  d.shot("", (w) => {
    search(w, "B");
    search(w, "C");
  }, {
    focus: ["pool", "B", "C", "db"],
    voice: "Теперь посмотрим, как поды ходят в нашу базу. Подключения к ней не бесконечны, поэтому каждый под берёт соединение из общего пула, делает своё дело и возвращает. Шесть слотов на всех: и на поиск, и на бронирование.",
  });
  d.shot("", (w) => {
    w.code = CODE_TX;
  }, {
    focus: ["code"],
    voice: "А вот как под принимает бронь. Он открывает транзакцию, записывает заявку у нас в базе со статусом «ожидает», зовёт поставщика и, когда тот ответил, меняет статус на «подтверждена» и закрывает транзакцию. Зачем так? Чтобы у нас в базе не осталось брони, которой поставщик не подтверждал.",
  });
  d.shot("", (w) => {
    w.code = { ...CODE_TX, mark: [{ line: 2, tone: "warn", note: "слот занят" }] };
  }, {
    focus: ["code"],
    voice: "Обратите внимание на эту строку. Казалось бы, звонок идёт к поставщику, а не к базе, при чём тут наш пул? Но транзакция открыта всё время, пока мы ждём ответа, а значит, всё это время занят и слот.",
  });
  d.shot("", (w) => {
    book(w, "A");
    w.db = "Скучно у вас.";
  }, {
    focus: ["A", "pool", "supplier", "rows", "guests"],
    voice: "Пока поставщик отвечает за доли секунды, это никому не мешает: слот взяли, вернули, и гость уже видит «забронировано».",
  });

  // Хук: поставщик тормозит, брони держат слоты, поиск встаёт.
  d.scene(ACT.hook, slow());
  d.shot("Ответ: 30 секунд", undefined, {
    focus: ["supplier"],
    voice: "И вот у поставщика начинаются проблемы. Он не лежит, клерк работает, но очередь перед ним растёт, и теперь на каждую бронь он отвечает по тридцать секунд.",
  });
  d.shot("", (w) => {
    fillPool(w);
    think(w, "Время ещё есть — подожду!", "A", "B", "C");
  }, {
    focus: ["A", "B", "C", "pool", "supplier"],
    voice: "Наши поды терпеливые. Каждый открыл транзакцию, взял слот и ждёт, ведь время ещё есть. И пока брони стоят в очереди к поставщику, слоты нашего пула уходят один за другим.",
  });
  d.term("Cascading failure");
  d.shot("", (w) => {
    search(w, "A");
    search(w, "B");
    search(w, "C");
    w.db = "Я свободен! Меня не пускают.";
  }, {
    focus: ["pool", "guests", "db"],
    voice: "Тут и случается самое обидное. Слоты общие, поэтому те, кто просто смотрит номера, встают в очередь за теми, кто бронирует. Поиск к поставщику не ходит и ничего не сломал, а у всех гостей крутится ожидание, и наша база при этом свободна, её просто не пускают. Беда одного сервиса по цепочке стала бедой всего нашего. Это каскадный отказ, cascading failure.",
  });
  const jammed = structuredClone(d.w);

  // КЕЙС 1 — поставщик тормозит: выживет ли поиск?
  d.scene(ACT.case1);
  d.chapter(1, ["поиск жив", "гость в курсе"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 3\nПоставщик тормозит. Выживет ли поиск?";
  }, { hold: 2.5, voice: "А хотелось бы вот чего: пусть у поставщика беда, но у нас поиск работает, а гость хотя бы знает, что с его бронью. Это и проверим в первом кейсе: поставщик тормозит, выживет ли наш поиск?" });

  d.scene(ACT.forever, slow());
  d.attempt("ждём сколько угодно");
  d.shot("", (w) => {
    fillPool(w);
    search(w, "A");
    think(w, "Время ещё есть — подожду!", "A", "B", "C");
  }, {
    verdict: ["red", "red"], focus: ["pool", "guests", "board"],
    voice: "Первая попытка нам уже знакома: ждать, сколько понадобится. Слоты заняты, поиск стоит, а гость не знает ничего. Ждать без предела нельзя, поэтому поставим предел.",
  });

  d.scene(ACT.timeout, slow({ timeout: 3 * SECOND }));
  d.attempt("таймаут 3 с");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: таймаут 3 с";
    fillPool(w);
  }, {
    focus: ["A", "B", "C", "pool", "supplier"],
    voice: "Попробуем иначе: дадим поставщику три секунды. Поды так же берут слоты и зовут поставщика, только теперь у каждого вызова есть срок.",
  });
  d.term("Timeout");
  d.shot("", (w) => {
    setClock(w, w.clock + 3 * SECOND);
    for (const who of ["A", "B", "C", "A", "B", "C"] as PodId[]) timeout(w, who);
  }, {
    focus: ["A", "B", "C", "pool", "supplier", "clock"],
    voice: "Три секунды прошли, и это таймаут: не дождались за срок, и под сам бросает ожидание, откатывает транзакцию и возвращает слот в пул. Заметьте, что оборвали только мы: у поставщика наши запросы так и стоят в очереди.",
  });
  const timedOut = structuredClone(d.w);
  d.shot("", (w) => {
    for (const who of ["A", "B", "C", "A", "B"] as PodId[]) book(w, who);
    search(w, "C");
  }, {
    verdict: ["yellow", null], focus: ["pool", "guests", "board"],
    voice: "Поиск ожил, но радоваться рано. Слоты освобождаются раз в три секунды, а не сразу, и стоит потоку броней чуть вырасти, как пул снова кончится. Таймаут сократил ожидание, но не убрал причину, из-за которой мы держим слот.",
  });
  d.shot("", (w) => {
    think(w, "Не вышло.", "A");
  }, {
    verdict: [null, "yellow"], focus: ["A", "rows", "guests", "board"],
    voice: "Есть и вторая беда, куда неприятнее. Под A не дождался ответа и решил, что у него не вышло. Но так ли это? Мы этого не знаем, и потому гостю честно сказать нечего. Этот вопрос пока повиснет.",
  });

  const outside = slow({ timeout: 3 * SECOND });
  outside.policy.inTx = false;
  d.scene(ACT.outside, outside);
  d.attempt("вызов вне транзакции");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: вызов вне транзакции";
    w.code = CODE_OUT;
  }, {
    focus: ["code"],
    voice: "Вернёмся и уберём саму причину. Что, если не держать соединение, пока ждём чужой ответ? Записали заявку и сразу закрыли транзакцию, позвонили поставщику без слота, а ответ записали отдельной короткой транзакцией.",
  });
  d.shot("", (w) => {
    fillPool(w);
    setClock(w, w.clock + 3 * SECOND);
    for (const who of ["A", "B", "C"] as PodId[]) timeout(w, who);
    search(w, "A");
    search(w, "B");
    think(w, "Не вышло.", "A");
  }, {
    verdict: ["green", "yellow"], focus: ["pool", "guests", "board", "A"],
    voice: "Теперь слоты свободны, даже когда поставщик молчит, и поиск живёт. Того же добиваются и отдельным пулом для броней, bulkhead: как переборки в корабле, затопило один отсек, а остальные плывут. Поиск мы спасли, но вопрос о брони так и висит.",
  });

  // КЕЙС 2 — не дождались ответа: повторить?
  d.scene(ACT.case2);
  d.chapter(2, ["бронь одна", "поставщик жив"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 3\nНе дождались ответа. Повторить?";
  }, { hold: 2.5, voice: "Кейс второй: мы не дождались ответа. Попробовать ещё раз?" });

  // Ответ на вопрос кейса 1: бронь у поставщика есть.
  d.scene(ACT.answer, slow({ timeout: 3 * SECOND }));
  d.shot("", (w) => {
    book(w, "A");
    setClock(w, w.clock + 3 * SECOND);
    timeout(w, "A");
    think(w, "Не вышло.", "A");
  }, {
    focus: ["A", "supplier", "rows", "guests"],
    voice: "Помните вопрос про бронь? Под A позвал поставщика, через три секунды бросил трубку и думает, что не вышло.",
  });
  const abandoned = structuredClone(d.w);
  d.shot("", (w) => {
    setClock(w, w.clock + 2 * SECOND);
    serve(w, w.supplier.queue.length);
  }, {
    focus: ["A", "supplier", "rows"],
    voice: "А поставщик трубку не бросал: наш запрос так и стоял у него в очереди, и через пару секунд он его обработал. Бронь у него есть, а наш под уверен, что не вышло! Не дождались не значит, что не получилось. Поэтому гостю честнее сказать «проверяем», а не «отказано».",
  });

  d.scene(ACT.now, structuredClone(abandoned), { replay: true });
  d.attempt("повторить сразу");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: таймаут";
    think(w, "Ну, повторю.", "A");
    book(w, "A", { retry: true });
    setClock(w, w.clock + 2 * SECOND);
    serve(w, w.supplier.queue.length);
  }, {
    verdict: ["red", null], focus: ["A", "supplier", "rows", "board"],
    voice: "Ладно, тогда просто повторим. Под A сразу зовёт поставщика ещё раз, и у того теперь две брони одного гостя. Откуда сети знать, что это повтор? Для неё это новый запрос. Гость заплатит за два номера, а приехать сможет только в один.",
  });
  d.term("Retry storm");
  d.shot("", (w) => {
    think(w, null, "A");
    w.wave = retryWave("now", 3);
    w.events.push({ kind: "wave" });
  }, {
    verdict: [null, "red"], focus: ["supplier", "board"],
    voice: "Но есть и вторая беда. Повторяем-то мы втроём и ровно в одну секунду, потому что таймаут у всех сработал одновременно. Поставщик и так захлёбывается, а мы везём ему втрое больше, и старые запросы он ещё не разгрёб. Чем больше таймаутов, тем больше повторов, а чем больше повторов, тем больше таймаутов. Это retry storm, шторм повторов.",
  });

  const keyed = structuredClone(abandoned);
  keyed.policy.key = true;
  keyed.supplier.queue.forEach((c) => c.from === "A" && (c.ref = OUR_REF));
  d.scene(ACT.key, keyed, { replay: true });
  d.attempt("+ наш номер брони");
  d.term("Idempotency key");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: с нашим номером";
    w.wave = retryWave("now", 3);
    book(w, "A", { retry: true });
    setClock(w, w.clock + 2 * SECOND);
    serve(w, w.supplier.queue.length);
  }, {
    verdict: ["green", "red"], focus: ["A", "supplier", "rows", "board"],
    voice: "Начнём с двух броней. Передадим поставщику наш номер брони, и теперь, получив повтор с тем же номером, он узнаёт его и отвечает про ту же бронь, а не заводит новую. Это ключ идемпотентности, idempotency key. Оговорка в том, что так умеет не каждый поставщик и номера он хранит не вечно. Если не умеет, перед повтором мы спрашиваем статус по нашему номеру.",
  });
  const once = structuredClone(d.w);

  d.scene(ACT.backoff, structuredClone(once), { replay: true });
  d.attempt("+ exponential backoff");
  d.term("Exponential backoff");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: пауза 1, 2, 4 с";
    w.wave = retryWave("backoff", 3);
    w.events.push({ kind: "wave" });
  }, {
    verdict: ["green", "red"], focus: ["supplier", "board"],
    voice: "Теперь нагрузка. Попробуем повторять реже: через секунду, потом через две, потом через четыре. Удары разошлись во времени, но не между подами: ждут все одинаково, а значит, и ударят снова в одну и ту же секунду.",
  });

  d.scene(ACT.jitter, structuredClone(once), { replay: true });
  d.attempt("+ jitter");
  d.term("Backoff · jitter");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: пауза с разбросом";
    w.wave = retryWave("jitter", 3);
    w.events.push({ kind: "spread" });
  }, {
    verdict: ["green", "yellow"], focus: ["supplier", "board"],
    voice: "Тогда добавим разброс, jitter: каждый под удлиняет или укорачивает паузу на свою случайную долю. Удары растекаются, и поставщик успевает разгребать очередь. Повторов меньше не стало, но приходят они не разом. И повторяем, только пока гость ещё ждёт: через десять секунд его браузер сдаётся, и повтор после этого уже никому не нужен.",
  });
  const spread = structuredClone(d.w);

  // КЕЙС 3 — поставщик лёг на минуту: сколько ещё стучаться?
  d.scene(ACT.case3);
  d.chapter(3, ["ответ сразу", "брони идут"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 3 из 3\nПоставщик лёг. Сколько стучаться?";
  }, { hold: 2.5, voice: "Кейс третий, самый мрачный: поставщик лёг совсем, на целую минуту. Сколько нам ещё стучаться?" });

  d.scene(ACT.storm, down());
  d.attempt("повторы, как было");
  d.shot("", (w) => {
    w.events.push({ kind: "down" });
    for (const who of ["A", "B", "C"] as PodId[]) book(w, who);
  }, {
    focus: ["A", "B", "C", "supplier", "guests"],
    voice: "Что даёт наша схема, когда поставщик лёг? Гости жмут «забронировать», и поды честно зовут поставщика, а тот молчит.",
  });
  d.shot("", (w) => {
    setClock(w, w.clock + 7 * SECOND);
    for (const who of ["A", "B", "C"] as PodId[]) {
      timeout(w, who);
      giveUp(w, who);
    }
    w.wave = retryWave("jitter", 9);
    w.events.push({ kind: "wave" });
  }, {
    verdict: ["red", "red"], focus: ["supplier", "guests", "board", "clock"],
    voice: "Каждый гость ждёт все попытки, чтобы через семь секунд получить ошибку. А поставщик, который пытается подняться, получает ту же лавину повторов от всех гостей сразу и никак не встанет. Мы и ждём, и добиваем.",
  });

  const breakers = down();
  for (const who of ["A", "B", "C"] as PodId[]) breakers.pods[who].breaker = "closed";
  breakers.pods.A.fails = 2;
  breakers.pods.C.fails = 2;
  breakers.pods.B.fails = 1;
  d.scene(ACT.open, breakers);
  d.attempt("circuit breaker");
  d.term("Circuit breaker");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: выключатель";
    for (const who of ["A", "B", "C"] as PodId[]) book(w, who);
    setClock(w, w.clock + 3 * SECOND);
    for (const who of ["A", "B", "C"] as PodId[]) timeout(w, who);
  }, {
    focus: ["A", "B", "C", "breakers"],
    voice: "Хватит стучаться впустую. Поставим в каждый под автоматический выключатель, circuit breaker. Пока всё в порядке, он замкнут, и звонки идут. Но стоит набраться нескольким отказам подряд, как выключатель размыкается. У подов A и цэ он уже щёлкнул, а у пода B пока нет: выключатель у каждого пода свой, и они не договариваются.",
  });
  d.shot("", (w) => {
    book(w, "B");
    setClock(w, w.clock + 3 * SECOND);
    timeout(w, "B");
    for (const who of ["A", "B", "C"] as PodId[]) book(w, who);
    w.wave = null;
  }, {
    verdict: ["green", null], focus: ["A", "B", "C", "breakers", "guests", "supplier", "board"],
    voice: "Вот щёлкнул и он. Теперь поды не звонят вовсе и сразу говорят гостю, что попробовать лучше позже. И гость не ждёт, и поставщик наконец отдыхает.",
  });
  const opened = structuredClone(d.w);

  d.scene(ACT.stuck, structuredClone(opened), { replay: true });
  d.attempt("…open навсегда");
  d.shot("", (w) => {
    setClock(w, w.clock + 60 * SECOND);
    w.supplier.latency = 200;
    w.supplier.queue = [];
    w.events.push({ kind: "up" });
    w.replies = [];
    for (const who of ["A", "B", "C"] as PodId[]) book(w, who);
  }, {
    verdict: ["green", "red"], focus: ["supplier", "breakers", "guests", "board", "clock"],
    voice: "Но подождите. Через минуту поставщик ожил, а мы об этом не знаем и продолжаем отвечать «попробуйте позже». Выключатель, который разомкнули и забыли, просто выключил нам бронирование навсегда.",
  });
  const revived = structuredClone(d.w);

  d.scene(ACT.half, structuredClone(revived), { replay: true });
  d.attempt("half-open");
  d.term("Half-open");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: пробный запрос";
    w.replies = [];
    halfOpen(w, "A");
  }, {
    focus: ["A", "breakers"],
    voice: "Поэтому после паузы выключатель приоткрывается и пропускает один пробный запрос. Это half-open. Под A рискнёт первым, а B и цэ пока подождут.",
  });
  d.shot("", (w) => {
    book(w, "A");
    closeBreaker(w, "A");
    for (const who of ["B", "C"] as PodId[]) {
      halfOpen(w, who);
      book(w, who);
      closeBreaker(w, who);
    }
  }, {
    verdict: ["green", "green"], focus: ["A", "B", "C", "breakers", "supplier", "rows", "guests", "board"],
    voice: "Пробный запрос прошёл, значит, поставщик жив: выключатель замыкается, и бронирование снова идёт. А не пройди он, выключатель разомкнулся бы снова, и мы подождали бы ещё. Ни лишнего стука, ни вечной блокировки.",
  });
  const healed = structuredClone(d.w);

  // Итог — повтором уже виденных образов.
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B", "C"] as const) x.pods[id].acts = structuredClone(saved.pods[id].acts);
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
    }, { voice });
  };
  recap(jammed, "Вот и вся история. Поставщик тормозил, а нас клала на лопатки собственная терпеливость: слоты пула, забитые ожиданием, и поиск, которому не досталось соединения.");
  recap(timedOut, "Мы поставили таймаут и перестали держать слот, пока ждём чужого ответа.");
  recap(once, "Но не дождались не значит, что не получилось, поэтому повторяем с нашим номером брони, и поставщик узнаёт повтор.");
  recap(spread, "Чтобы не добить поставщика, мы растащили повторы разбросом.");
  recap(healed, "А когда он лёг совсем, выключатель перестал звонить и аккуратно проверял, не ожил ли поставщик.");
  return d.steps;
}
