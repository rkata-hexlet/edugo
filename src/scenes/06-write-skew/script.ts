import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { ACT as ACT05, buildSteps as buildSteps05 } from "../05-isolation/script";
import type { World as World05 } from "../05-isolation/sim";
import {
  CAP, begin, bump, commit, count, insert, resume, retry, world,
  type ActorId, type Code, type Focus, type Level, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/06-write-skew.md.
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  recall: "Вспомним 05",
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case2: "Кейс",
  rr: "2.1 REPEATABLE READ",
  ser: "2.2 SERIALIZABLE",
  counter: "2.3 Счётчик в строке слота",
  choice: "Когда что",
  summary: "Итог",
} as const;

const SQL = {
  begin: (level: Level) => (level === "RC" ? "BEGIN" : `BEGIN ISOLATION LEVEL ${level === "RR" ? "REPEATABLE READ" : "SERIALIZABLE"}`),
  count: "SELECT count(*) FROM orders WHERE slot_id = 7",
  insert: "INSERT INTO orders (customer, slot_id) VALUES ($1, 7)",
  bump: "UPDATE slots SET booked = booked + 1\n  WHERE id = 7 AND booked < cap",
};

/** Код приёма заказа на Go: наивный (подсчёт в отдельном чтении), на SERIALIZABLE, со счётчиком в строке слота. */
const GO = {
  naive: (level: "RepeatableRead" | "Serializable") => [
    "tx, _ := db.BeginTx(ctx, pgx.TxOptions{",
    `  IsoLevel: pgx.${level}})`,
    "var booked, cap int",
    "tx.QueryRow(ctx, `SELECT count(*) FROM orders",
    "  WHERE slot_id = 7`).Scan(&booked)",
    "tx.QueryRow(ctx, `SELECT cap FROM slots WHERE id = 7`).Scan(&cap)",
    "if booked < cap {",
    "  tx.Exec(ctx, `INSERT INTO orders ...`)",
    "}",
    "return tx.Commit(ctx)",
  ],
  counter: [
    "tx, _ := db.BeginTx(ctx, pgx.TxOptions{",
    "  IsoLevel: pgx.ReadCommitted})",
    "res, _ := tx.Exec(ctx, `UPDATE slots",
    "  SET booked = booked + 1",
    "  WHERE id = 7 AND booked < cap`)",
    "if res.RowsAffected() == 1 {",
    "  tx.Exec(ctx, `INSERT INTO orders ...`)",
    "}",
    "tx.Commit(ctx)",
  ],
};

/** Мысль-заблуждение пода: висит, пока он верит своему подсчёту. */
const FREE = "2 из 3 — место есть!";

/**
 * Исключения произношения для синтеза; экран и субтитр не меняются.
 * Буквы подов — по-русски (решение пользователя для серии).
 */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  "40001": "сорок ноль ноль один",
  booked: "букд",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

const STEPS05 = buildSteps05();
/** Кадры эпизода 05 во вставках: 40001 на строке остатка (начало ролика) и атомарный UPDATE (перед 2.3). */
export const RECALL = {
  rr: STEPS05.findIndex((s) => s.act === ACT05.rr && s.state.actors.B.failed && !!s.state.db),
  atomic: STEPS05.findIndex((s) => s.act === ACT05.atomic && s.state.check?.ok === false && !!s.state.db),
};

/** Мир этого кадра 05 для отрисовки его же view: только сцена — без табло, SQL-панели и реплики (шапку занимает штамп). */
export function recallWorld(step: number): World05 {
  const w = structuredClone(STEPS05[step].state);
  return { ...w, board: null, chapter: null, sql: [], db: null };
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
    for (const a of Object.values(w.actors)) {
      a.acts = [];
      a.crossed = null;
    }
    w.showcase = false;
    w.courierTalk = false;
    w.code = null;
    w.check = null;
    w.flashback = null;
  }

  protected override finish(w: World): void {
    w.replay = this.replaying;
  }
}

// --- Глаголы сценария: операции модели + команды в SQL-панели. Поды не двигаются — двигаются стрелки. ---

function sql(w: World, who: ActorId | null, text: string): void {
  w.sql.push(who ? `${w.actors[who].label} ▸ ${text}` : text);
}

function customer(w: World, who: ActorId) {
  return w.customers.find((c) => c.pod === who)!;
}

/** Покупатели жмут «Заказать»: транзакция начинается. */
function press(w: World, level: Level, ...who: ActorId[]): void {
  for (const id of who) {
    customer(w, id).status = "press";
    w.events.push({ kind: "press", by: id });
    begin(w, id, level);
    sql(w, id, SQL.begin(level));
  }
}

/** Подсчёт заказов слота: под принимает число за правду. */
function tally(w: World, who: ActorId): number {
  const n = count(w, who);
  sql(w, who, `${SQL.count}  -- ${n}`);
  w.actors[who].thought = n < CAP ? FREE : null;
  return n;
}

function order(w: World, who: ActorId): boolean {
  const ok = insert(w, who);
  sql(w, who, SQL.insert);
  if (!ok) fault(w, who);
  return ok;
}

/** 40001: мысль опровергнута, транзакция прервана. */
function fault(w: World, who: ActorId): void {
  const deps = w.reason[who] === "deps";
  sql(w, who, deps
    ? "ERROR: could not serialize access due to\n  read/write dependencies among transactions (40001)"
    : "ERROR: could not serialize access\n  due to concurrent update (40001)");
  w.actors[who].crossed = w.actors[who].thought;
  w.actors[who].thought = null;
}

function done(w: World, who: ActorId): void {
  const ordered = w.orders.some((o) => o.by === who && o.at === null);
  if (!commit(w, who)) {
    sql(w, who, "COMMIT");
    fault(w, who);
    return;
  }
  sql(w, who, "COMMIT");
  w.actors[who].thought = null;
  if (ordered) {
    customer(w, who).status = "ok";
    w.events.push({ kind: "ok", by: who });
  } else {
    // Места нет: заказ не вставили, код доходит до Commit — покупатель видит «Слот занят».
    customer(w, who).status = "busy";
    w.events.push({ kind: "busy", by: who });
  }
}

/** Заказ целиком, без соседа: подсчитал → вставил, если есть место → COMMIT. */
function book(w: World, who: ActorId, level: Level): void {
  press(w, level, who);
  if (tally(w, who) < CAP) order(w, who);
  done(w, who);
}

/** Счётчик в строке слота: проверка и запись одним UPDATE. */
function claim(w: World, who: ActorId): void {
  if (bump(w, who) === "wait") customer(w, who).status = "wait";
  sql(w, who, SQL.bump);
}

function wake(w: World, who: ActorId): "write" | "zero" | "fail" {
  const out = resume(w, who);
  sql(w, who, out === "zero" ? "-- дождался: UPDATE 0" : "-- дождался: UPDATE 1");
  return out;
}

/** Свежий стол попытки. */
/** Свежий стол попытки; цену повтора зритель уже знает — второй критерий табло держится и на новом столе. */
function table(o: { counter?: boolean; cost?: boolean } = {}): World {
  const w = world();
  w.counter = !!o.counter;
  w.costShown = !!o.cost;
  return w;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Вспомним 05: кадр 40001 его же отрисовкой — оба писали в одну строку остатка.
  d.scene(ACT.recall);
  d.shot("", (w) => {
    w.flashback = RECALL.rr;
    w.stamp = "⟲ Вспомним: последняя кружка";
  }, {
    voice: "Помните наш интернет-магазин и последнюю кружку? Аня и Борис нажали «Купить» в одну секунду, и поды A и B оба писали в одну и ту же строку с остатком. Спас нас уровень изоляции REPEATABLE READ: на нём транзакция видит базу такой, какой та была на её первом запросе, это её снимок. Под B хотел изменить строку, которую после его снимка уже поменяли, получил ошибку 40001, повторил транзакцию и честно увидел «нет в наличии».",
  });

  // Знакомство: курьер, слот, таблицы, код.
  d.scene(ACT.intro);
  d.shot("", (w) => {
    w.showcase = true;
    w.courierTalk = true;
  }, {
    focus: ["courier", "shop"],
    voice: "Окрылённые успехом, мы перевели на REPEATABLE READ весь сервис заказов, и спать стало спокойнее. А магазин тем временем подрос и теперь сам возит покупки. У него есть курьер на вечерний слот, с шести до восьми, и машина у него маленькая: больше трёх заказов за рейс в неё не влезет. Лишний заказ значит сорванную доставку и покупателя, который зря прождал весь вечер.",
  });
  d.shot("", undefined, {
    focus: ["A", "B", "slot", "orders"],
    voice: "Заказы оформляют всё те же поды A и B, то есть два экземпляра нашего сервиса на Go, а слоты и заказы лежат в Postgres. В таблице slots у вечернего слота записана вместимость, cap, равная трём. В таблицу orders падает каждый оформленный заказ со ссылкой на свой слот. На вечер уже едут заказы Веры и Глеба, а значит, свободно только последнее, третье место.",
  });
  d.shot("", (w) => {
    w.code = { title: "Go · приём заказа", lines: GO.naive("RepeatableRead"), mark: [{ line: 1, tone: "ok", note: "уровень" }] };
  }, {
    focus: ["code"],
    voice: "Принимает заказ вот такой код на Go, и транзакция, как мы и договорились, идёт на REPEATABLE READ. Под считает, сколько заказов уже записано в слот, достаёт вместимость и, если место есть, вставляет новый заказ.",
  });
  d.shot("", (w) => {
    w.code = {
      title: "Go · приём заказа", lines: GO.naive("RepeatableRead"),
      mark: [{ line: 3, tone: "warn", note: "проверка" }, { line: 4, tone: "warn" }, { line: 7, tone: "warn", note: "новая строка" }],
    };
  }, {
    focus: ["code"],
    voice: "Заметьте: проверка «место есть» опять живёт в отдельном чтении. Но в отличие от кружки запись тут не трогает ни одной существующей строки, она лишь добавляет в orders новую. Казалось бы, так даже безопаснее, ведь менять одну и ту же строку вдвоём больше некому.",
  });

  // Хук: оба оформили на последнее место.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    press(w, "RR", "A", "B");
    tally(w, "A");
    tally(w, "B");
  }, {
    focus: ["A", "B", "orders", "shop"],
    voice: "И вот Аня и Борис одновременно оформляют доставку на вечер. Поды A и B считают заказы слота, и никто никого не ждёт: чтение строки не запирает. Оба насчитывают два заказа из трёх, и оба решают, что последнее место достанется им.",
  });
  d.shot("", (w) => {
    order(w, "A");
    order(w, "B");
  }, {
    focus: ["A", "B", "orders"],
    voice: "Каждый под вставляет свой заказ, а раз строки у них разные, никто снова никого не ждёт. Но мы же на REPEATABLE READ, он ведь спас нас с кружкой! Неужели Postgres и сейчас поймает гонку?",
  });
  d.shot("", (w) => {
    done(w, "A");
    done(w, "B");
    w.db = "Лимит? Это ваш if, не мой.";
  }, {
    focus: ["orders", "courier", "shop"],
    voice: "Нет! Оба пода спокойно коммитят, Аня и Борис получают подтверждение, а в слоте оказывается четыре заказа при трёх местах. Это тот же провал, что и с кружкой, только теперь курьер стоит у машины с четырьмя коробками. И четвёртую ему просто некуда деть.",
  });
  const hookEnd = structuredClone(d.w);

  // Норма: по очереди.
  d.scene(ACT.norm);
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: по очереди";
    book(w, "A", "RR");
  }, {
    focus: ["A", "orders", "courier", "shop"],
    voice: "А как должно быть? Пусть они оформят заказ по очереди. Сначала под A насчитывает два заказа, вставляет третий и коммитит: Аня получает своё место, а курьер свою третью коробку.",
  });
  d.shot("", (w) => {
    book(w, "B", "RR");
    w.db = "Вот так и должно быть.";
  }, {
    focus: ["B", "orders", "shop"],
    voice: "Потом под B насчитывает уже три из трёх и заказ не вставляет. Борис видит «слот занят» и выберет другое время. Обидно, зато курьер уедет с полной, но не перегруженной машиной.",
  });

  // КЕЙС — слот курьера.
  d.scene(ACT.case2);
  d.chapter(2, ["курьер не перегружен", "без повтора"]);
  d.shot("", (w) => {
    w.plate = "Кейс\nКак не перегрузить\nкурьера?";
  }, {
    hold: 2.5,
    voice: "Так почему же REPEATABLE READ, который спас кружку, здесь промолчал? Разберёмся, и следить будем за главным: чтобы курьер не получил лишнюю коробку.",
  });

  // 2.1 REPEATABLE READ: оба посчитали до вставок; RR сверяет только существующую строку, которую меняешь.
  d.scene(ACT.rr, table(), { replay: true });
  d.attempt("REPEATABLE READ");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: оба считают";
    press(w, "RR", "A", "B");
    tally(w, "A");
    tally(w, "B");
  }, {
    sql: true, focus: ["A", "B", "orders", "sql"],
    voice: "Вернёмся к самому началу. Оба пода посчитали заказы ещё до того, как кто-то вставил свой, и оба увидели два. Это не устаревшие данные: на момент подсчёта в слоте и правда было два заказа, поэтому не помог бы и READ COMMITTED. Дело в другом, и чтобы его увидеть, вспомним, что вообще проверяет REPEATABLE READ.",
  });
  const rrCounted = structuredClone(d.w);
  d.shot("", (w) => {
    w.flashback = RECALL.rr;
    w.stamp = "⟲ Вспомним: кружка";
  }, {
    voice: "Проверяет он ровно одно: когда под меняет уже существующую строку, база сверяет, не изменил ли её кто-то после начала его транзакции. С кружкой так и было, оба писали в строку с остатком, и второй получил 40001.",
  });
  d.scene(ACT.rr, rrCounted, { replay: true });
  d.shot("", (w) => {
    order(w, "A");
    order(w, "B");
    w.check = { text: "INSERT · сверять не с чем", ok: true };
    done(w, "A");
    done(w, "B");
  }, {
    sql: true, focus: ["B", "orders", "sql"],
    voice: "А здесь каждый под добавил свою, новую строку. Сверять её не с чем, ведь раньше её никто не менял, поэтому оба коммита проходят без ошибки.",
  });
  d.term("Write skew");
  d.shot("", (w) => {
    w.db = "Строки разные. Всё чисто.";
  }, {
    verdict: ["red", null], focus: ["orders", "courier", "board"],
    voice: "Единственное, что связывает поды, это прочитанное число: два из трёх. Каждый принял решение по нему, а коммит соседа сделал это число неправдой. Это перекос записи, write skew: решают по одним и тем же данным, а пишут в разные строки. А за прочитанным REPEATABLE READ как раз и не следит.",
  });

  // 2.2 SERIALIZABLE: метки чтения, кольцо, 40001 на COMMIT, повтор.
  d.scene(ACT.ser, table());
  d.attempt("SERIALIZABLE");
  const serCode = (mark: Code["mark"]) => ({ title: "Go · тот же код, другой уровень", lines: GO.naive("Serializable"), mark });
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: SERIALIZABLE";
    w.code = serCode([{ line: 1, tone: "ok", note: "другой уровень" }]);
  }, {
    focus: ["code"],
    voice: "Раз REPEATABLE READ не следит за прочитанным, нам нужен уровень, который следит. В Postgres это самый строгий, SERIALIZABLE, и в коде меняется всего одна строка.",
  });
  d.shot("", (w) => {
    w.code = serCode([{ line: 1, tone: "ok" }, { line: 9, tone: "warn", note: "сюда придёт 40001" }]);
  }, {
    focus: ["code"],
    voice: "Только не думайте, что он выстраивает транзакции в очередь или запирает таблицу: поды по-прежнему работают параллельно. Просто Postgres гарантирует такой результат, как в нашей норме, будто они шли по очереди. А если так не выходит, он прервёт одну из транзакций ошибкой 40001, и повторит её наш код, как в прошлый раз.",
  });
  d.shot("", (w) => {
    press(w, "SER", "A", "B");
    tally(w, "A");
    tally(w, "B");
  }, {
    sql: true, focus: ["A", "B", "orders", "marks"],
    voice: "Снова Аня и Борис жмут одновременно, и оба пода считают заказы. Но теперь Postgres запоминает, что именно каждый прочитал: все заказы вечернего слота, в том числе те, что могут в нём появиться. Такая отметка называется предикатной блокировкой, predicate lock, но название обманчиво: она никого не держит и ничего не запирает.",
  });
  d.shot("", (w) => {
    order(w, "A");
  }, {
    sql: true, focus: ["A", "orders", "marks"],
    voice: "Под A вставляет свой заказ, и тот попадает прямо в то, что прочитал под B. Postgres это отмечает: подсчёт пода B уже не учитывает чужой заказ.",
  });
  d.term("Serializable · SSI");
  d.shot("", (w) => {
    order(w, "B");
  }, {
    sql: true, focus: ["B", "orders", "marks"],
    voice: "Под B вставляет свой, и тот попадает в прочитанное подом A. Получилось кольцо: каждый решал по данным, которые меняет другой. А значит, по очереди так выйти не могло: кто бы ни шёл вторым, он увидел бы чужой заказ и насчитал три. Такой учёт ведёт механизм Serializable Snapshot Isolation, SSI, но ошибки пока нет.",
  });
  d.shot("", (w) => {
    done(w, "A");
    done(w, "B");
    w.db = "Твой подсчёт устарел. Заново!";
  }, {
    sql: true, focus: ["A", "B", "orders", "sql"],
    voice: "Под A коммитит первым, и у него всё проходит. А когда до коммита доходит под B, Postgres видит замкнутое кольцо и прерывает его транзакцию с тем же кодом, 40001, хотя текст сообщения другой. Чаще это случается на коммите, но бывает и раньше, прямо на вставке.",
  });
  const serFail = structuredClone(d.w);
  d.shot("", (w) => {
    retry(w, "B", "SER");
    sql(w, "B", SQL.begin("SER"));
    tally(w, "B");
    done(w, "B");
    w.costShown = true; // второй критерий табло — вместе с голосом, который его вводит
  }, {
    sql: true, verdict: ["green", "yellow"], focus: ["B", "orders", "courier", "board"],
    voice: "И снова это не ответ покупателю, а сигнал повторить. Транзакция уже отменена, и наш код на Go просто запускает её заново. Свежий снимок видит три заказа из трёх, вставки нет, и Борис получает «слот занят». Курьер едет ровно с тремя коробками, но ценой повтора. С этого момента у нас два вопроса к каждой попытке: не перегружен ли курьер и обошлись ли мы без повторов.",
  });
  d.shot("", undefined, {
    focus: ["board"],
    voice: "А повторы здесь чаще, чем на REPEATABLE READ. Там ошибку получал лишь тот, кто менял чужую строку, а здесь 40001 может прилететь любой транзакции. Postgres перестраховывается и иногда прерывает даже ту, что ничего бы не испортила. Внимательный инженер спросит: а нельзя ли обойтись без повторов вообще? Можно, если зайти с другой стороны.",
  });

  // 2.3 ⟲ Счётчик в строке слота на READ COMMITTED: конфликт в одной строке, B ждёт, перепроверка → 0 строк.
  d.scene(ACT.counter, table({ counter: true, cost: true }));
  d.attempt("счётчик в строке");
  d.shot("", (w) => {
    w.flashback = RECALL.atomic;
    w.stamp = "⟲ Вспомним: условие в UPDATE";
  }, {
    voice: "Вспомним, как ещё мы спасали кружку в прошлый раз: условием прямо в UPDATE одной строки. Под B дождался коммита пода A, база перепроверила «остаток больше нуля» уже на свежей версии строки, и запись не прошла. И всё это без единого повтора!",
  });
  const counterCode = (mark: Code["mark"]) => ({ title: "Go · счётчик в строке слота", lines: GO.counter, mark });
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: счётчик в слоте";
    w.code = counterCode([{ line: 2, tone: "ok", note: "проверка и запись" }, { line: 3, tone: "ok" }, { line: 4, tone: "ok", note: "одним запросом" }]);
  }, {
    focus: ["code", "slot"],
    voice: "Так сведём к одной строке и слот! Заведём в slots счётчик занятых мест, booked, и будем увеличивать его одним запросом, только если он ещё меньше вместимости. Заказ вставляем, лишь если UPDATE изменил строку.",
  });
  d.shot("", (w) => {
    w.code = counterCode([{ line: 1, tone: "ok", note: "READ COMMITTED" }]);
  }, {
    focus: ["code"],
    voice: "А уровень вернём на тот, что стоит в Postgres по умолчанию, READ COMMITTED. На REPEATABLE READ под B снова получил бы 40001 и повтор, а здесь он просто дождётся соседа и перепроверит условие.",
  });
  d.shot("", (w) => {
    press(w, "RC", "A", "B");
    claim(w, "A");
    claim(w, "B");
  }, {
    sql: true, focus: ["A", "B", "slot", "sql"],
    voice: "Снова одновременное нажатие. Под A увеличивает счётчик с двух до трёх, и строка слота заперта до его коммита. А под B упирается в ту же строку и ждёт. Вот теперь у подов появилась общая строка, и столкновение наконец видно базе!",
  });
  d.shot("", (w) => {
    order(w, "A");
    done(w, "A");
    wake(w, "B");
    done(w, "B");
    w.check = { text: "AND booked < cap", ok: false };
    w.db = "Уже три из трёх. Не пишу.";
  }, {
    sql: true, focus: ["A", "B", "slot", "shop"],
    voice: "Под A вставляет заказ и коммитит, а база перепроверяет условие пода B на свежей версии строки. Счётчик уже три, условие не выполняется, и UPDATE не меняет ни одной строки. Под B заказ не создаёт, Борис видит «слот занят», и всё это без единого повтора.",
  });
  const counterEnd = structuredClone(d.w);
  d.term("Atomic update");
  d.shot("", undefined, {
    verdict: ["green", "green"], focus: ["slot", "courier", "board"],
    voice: "Это тот же атомарный UPDATE, atomic update, что спас кружку: конфликт перенесён в одну строку, где его наконец видит база. Тот же результат дала бы и явная блокировка строки слота через FOR UPDATE. Цена у способа одна: строка заперта до самого коммита. Для курьера на три коробки это мелочь, но если в неё бьются сотни покупателей, скажем на распродаже, они выстроятся в очередь.",
  });

  // Когда что: правило сводится к одной строке — счётчик; не сводится — SERIALIZABLE. Носитель — табло двух решений.
  d.scene(ACT.choice, structuredClone(d.w), { replay: true });
  d.shot("", undefined, {
    focus: ["board"], attempt: 1,
    voice: "Так зачем тогда SERIALIZABLE, если счётчик справляется без повторов? Счётчик хорош, когда правило сводится к одному числу в одной строке. Но он дублирует подсчёт заказов, и поправлять его надо везде, где заказ появляется или исчезает: при оформлении, при переносе в другой слот, при правке из админки. Забудешь одно место, и счётчик соврёт. А SERIALIZABLE следит за самим прочитанным и прикрывает все эти пути разом, если все они тоже идут на SERIALIZABLE.",
  });

  // Итог — повтором уже виденных образов: беда, затем развилка «одна строка → счётчик, иначе SERIALIZABLE».
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B"] as const) x.actors[id].acts = structuredClone(saved.actors[id].acts);
      x.sql = [...saved.sql];
      x.db = null;
      x.check = saved.check;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
    }, { voice, sql: saved.sql.length > 0 });
  };
  recap(hookEnd, "Подведём итог. Когда правило держится на подсчёте разных строк, каждый под решает по одному и тому же подсчёту и пишет свою строку. REPEATABLE READ за прочитанным не следит, и в итоге курьеру достаётся четвёртая коробка.");
  recap(counterEnd, "Поэтому первое, что стоит проверить: сводится ли правило к одной строке. Если да, пишем UPDATE с условием, оставляем READ COMMITTED, и база сама дождётся соседа без всяких повторов.");
  recap(serFail, "А если не сводится, берём SERIALIZABLE: он следит и за прочитанным, заметит кольцо и прервёт одну из транзакций, а наш код её повторит. REPEATABLE READ и READ COMMITTED на таком подсчёте курьера не спасут.");

  return d.steps;
}
