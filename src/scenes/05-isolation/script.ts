import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  begin, commit, insert, read, resume, retry, world, write,
  type ActorId, type Focus, type Level, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/05-isolation.md (эпизод 05 — кейс 1; кейс 2 со слотом курьера — эпизод 06).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс",
  naive: "1.1 Прочитали, потом записали",
  atomic: "1.2 Атомарный UPDATE",
  rr: "1.3 REPEATABLE READ",
  levels: "Уровни Postgres",
  summary: "Итог",
} as const;

const SQL = {
  begin: (level: Level) => (level === "RR" ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN"),
  select: "SELECT stock FROM products WHERE id = 7",
  set: (n: number) => `UPDATE products SET stock = ${n} WHERE id = 7`,
  dec: "UPDATE products SET stock = stock - 1\n  WHERE id = 7 AND stock > 0",
  insert: "INSERT INTO orders (product_id) VALUES (7)",
};

/** Код покупки на Go: наивный (проверка в Go, UPDATE с готовым числом) и с условием в самом UPDATE. */
const GO = {
  naive: [
    "tx, _ := db.Begin(ctx)",
    "var stock int",
    "tx.QueryRow(ctx, `SELECT stock FROM products",
    "  WHERE id = 7`).Scan(&stock)",
    "if stock > 0 {",
    "  tx.Exec(ctx, `UPDATE products SET stock = $1",
    "    WHERE id = 7`, stock-1)",
    "  tx.Exec(ctx, `INSERT INTO orders ...`)",
    "}",
    "tx.Commit(ctx)",
  ],
  atomic: [
    "tx, _ := db.Begin(ctx)",
    "res, _ := tx.Exec(ctx, `UPDATE products",
    "  SET stock = stock - 1",
    "  WHERE id = 7 AND stock > 0`)",
    "if res.RowsAffected() == 1 {",
    "  tx.Exec(ctx, `INSERT INTO orders ...`)",
    "}",
    "tx.Commit(ctx)",
  ],
  forUpdate: [
    "tx, _ := db.Begin(ctx)",
    "var stock int",
    "tx.QueryRow(ctx, `SELECT stock FROM products",
    "  WHERE id = 7 FOR UPDATE`).Scan(&stock)",
    "if stock > 0 {",
    "  tx.Exec(ctx, `UPDATE products SET stock = $1",
    "    WHERE id = 7`, stock-1)",
    "  ...",
  ],
};

/** Мысль-заблуждение пода: висит, пока он верит прочитанному; потом — посчитанное из прочитанного. */
const MINE = "Вижу 1 — моя!";
const counted = (n: number) => `${n + 1} − 1 = ${n}`;

/**
 * Исключения произношения для синтеза; экран и субтитр не меняются.
 * Буквы подов — по-русски (решение пользователя для серии).
 */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
  "40001": "сорок ноль ноль один",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

/** Сверх общего: витрина и вставка эпизода 01 живут один кадр; итог — повтор уже виденного. */
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
    for (const a of Object.values(w.actors)) a.acts = [];
    w.showcase = false;
    w.flashback = false;
    w.ladder = false;
    w.code = null;
    w.check = null;
    for (const a of Object.values(w.actors)) a.crossed = null;
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

/** Покупатели жмут «Купить»: каждый — у своего пода, транзакция начинается. */
function press(w: World, level: Level, ...who: ActorId[]): void {
  for (const id of who) {
    customer(w, id).status = "press";
    w.events.push({ kind: "press", by: id });
    begin(w, id, level);
    sql(w, id, SQL.begin(level));
  }
}

/** SELECT stock: прочитанное под принимает за правду. */
function look(w: World, who: ActorId): number {
  const n = read(w, who);
  sql(w, who, `${SQL.select}  -- ${n}`);
  w.actors[who].thought = n > 0 ? MINE : null;
  return n;
}

/** Наивная запись: число посчитано в Go из прочитанного. */
function writeCounted(w: World, who: ActorId): void {
  const n = w.actors[who].tx!.read! - 1;
  w.actors[who].thought = counted(n); // носитель: ноль посчитан до ожидания замка
  if (write(w, who, { kind: "set", value: n }) === "wait") customer(w, who).status = "wait";
  sql(w, who, SQL.set(n));
}

/** Атомарная запись: считает база, условие — в самом UPDATE. */
function writeAtomic(w: World, who: ActorId): void {
  if (write(w, who, { kind: "dec" }) === "wait") customer(w, who).status = "wait";
  sql(w, who, SQL.dec);
}

/** Замок освободился — UPDATE пода выполняется на свежей версии. */
function wake(w: World, who: ActorId): void {
  const out = resume(w, who);
  if (out === "write") sql(w, who, "-- дождался: UPDATE 1");
  if (out === "zero") sql(w, who, "-- дождался: UPDATE 0");
  if (out === "fail") {
    sql(w, who, "ERROR: could not serialize access\n  due to concurrent update (40001)");
    w.actors[who].crossed = w.actors[who].thought;
    w.actors[who].thought = null;
  }
}

function order(w: World, who: ActorId): void {
  insert(w, who);
  sql(w, who, SQL.insert);
}

function done(w: World, who: ActorId): void {
  const ordered = w.orders.some((o) => o.by === who);
  commit(w, who);
  sql(w, who, "COMMIT");
  w.actors[who].thought = null;
  if (ordered) {
    customer(w, who).status = "ok";
    w.events.push({ kind: "ok", by: who });
  }
}

/** Товара нет: заказ не создаём; код на Go всё равно доходит до Commit — покупатель видит «Нет в наличии». */
function soldOut(w: World, who: ActorId): void {
  commit(w, who);
  sql(w, who, "COMMIT");
  w.actors[who].crossed = w.actors[who].thought;
  w.actors[who].thought = null;
  customer(w, who).status = "none";
  w.events.push({ kind: "none", by: who });
}

/** Покупка целиком, без соседа: прочитал → посчитал → записал → заказ → COMMIT. */
function buy(w: World, who: ActorId): void {
  press(w, "RC", who);
  if (look(w, who) > 0) {
    writeCounted(w, who);
    order(w, who);
    done(w, who);
  } else soldOut(w, who);
}

/** Свежий стол попытки: стопка версий строки видна; часы и линия снимка B включает кадр REPEATABLE READ. */
function table(): World {
  const w = world();
  w.stack = true;
  return w;
}

/** Часы: t секунд от 12:00:00. */
export function clock(t: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `12:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: магазин, поды, Postgres, как устроена покупка.
  d.scene(ACT.intro);
  d.shot("", (w) => {
    w.showcase = true;
  }, {
    focus: ["shop"],
    voice: "Перед нами интернет-магазин. На витрине осталась последняя кружка, и на неё смотрят двое: Аня и Борис. Кружка одна, значит, и заказ должен быть один.",
  });
  d.shot("", undefined, {
    focus: ["A", "B", "row", "orders"],
    voice: "Заказы оформляет сервис из двух подов, A и B. Остатки и заказы лежат в Postgres: в таблице products у кружки записан остаток, stock, а в таблицу orders падают оформленные заказы.",
  });
  d.shot("", (w) => {
    w.code = { title: "Go · оформление заказа", lines: GO.naive, mark: [] };
  }, {
    focus: ["code"],
    voice: "Покупку оформляет вот такой код на Go, всё в одной транзакции. Под читает остаток, и если товар есть, записывает число на единицу меньше и добавляет заказ.",
  });
  d.shot("", (w) => {
    w.code = { title: "Go · оформление заказа", lines: GO.naive, mark: [{ line: 4, tone: "warn", note: "проверка" }, { line: 5, tone: "warn", note: "запись вслепую" }, { line: 6, tone: "warn" }] };
  }, {
    focus: ["code"],
    voice: "Заметьте главное: проверка «товар есть» стоит в отдельном чтении, а сам UPDATE просто пишет готовое число и проверяет только номер товара. Выходит, проверка и запись разнесены на два шага, и между ними может вклиниться кто угодно.",
  });

  // Хук: оба нажали в одну секунду.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    press(w, "RC", "A", "B");
    look(w, "A");
    look(w, "B");
  }, {
    focus: ["A", "B", "row", "shop"],
    voice: "Но вот Аня и Борис жмут «Купить» в одну и ту же секунду. Поды A и B одновременно читают остаток, и никто никого не ждёт: обычное чтение строку не запирает. Оба видят единицу, и оба решают, что кружка их.",
  });
  d.shot("", (w) => {
    writeCounted(w, "A");
    writeCounted(w, "B");
  }, {
    focus: ["A", "B", "row", "shop"],
    voice: "Под A записывает ноль, и вот теперь строка заперта до его коммита. Под B доходит до своей записи и встаёт в очередь. Казалось бы, спасены?",
  });
  d.shot("", (w) => {
    order(w, "A");
    done(w, "A");
    wake(w, "B");
    order(w, "B");
  }, {
    focus: ["A", "B", "row", "orders"],
    voice: "Нет! Ноль под B посчитал ещё до записи пода A, из той самой единицы. Под A коммитит, под B дожидается, пишет свой ноль поверх и добавляет второй заказ.",
  });
  d.shot("", (w) => {
    done(w, "B");
    w.db = "Кружка одна, а заказов два!";
  }, {
    focus: ["row", "orders", "shop"],
    voice: "В итоге оба покупателя получают подтверждение. В базе ноль, будто всё в порядке, а заказов два на одну кружку.",
  });

  // Норма: по очереди.
  d.scene(ACT.norm);
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: по очереди";
    buy(w, "A");
  }, {
    focus: ["A", "row", "orders", "shop"],
    voice: "А как должно быть? Пусть они нажмут по очереди. Сначала под A читает единицу, записывает ноль, добавляет заказ, и Аня получает свою кружку.",
  });
  d.shot("", (w) => {
    buy(w, "B");
    w.db = "Вот так и должно быть.";
  }, {
    focus: ["B", "row", "shop"],
    voice: "Потом под B читает уже ноль, заказ не создаёт, и Борис честно видит «нет в наличии». Обидно, но правильно.",
  });

  // КЕЙС — последняя кружка.
  d.scene(ACT.case1);
  d.chapter(1, ["не продали лишнего", "без повтора"]);
  d.shot("", (w) => {
    w.plate = "Кейс\nКак не продать\nпоследнюю кружку дважды?";
  }, { hold: 2.5, voice: "Теперь разберёмся, что пошло не так при одновременном нажатии. И следить будем за главным: чтобы лишнего не продали." });

  // 1.1 Прочитал → посчитал в Go → записал.
  d.scene(ACT.naive, table(), { replay: true });
  d.attempt("отдельное чтение");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: оба нажали";
    press(w, "RC", "A", "B");
    look(w, "A");
    look(w, "B");
    writeCounted(w, "A");
    writeCounted(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Вернёмся к этому моменту и заглянем внутрь строки. Postgres не правит её на месте, а создаёт новую версию, и до коммита пода A строка заперта для записи. Читать старую версию при этом можно. А вот под B ждёт, хотя ноль для своего UPDATE он уже посчитал.",
  });
  d.shot("", (w) => {
    order(w, "A");
    done(w, "A");
    wake(w, "B");
    order(w, "B");
    done(w, "B");
    w.check = { text: "WHERE id = 7", ok: true };
    w.db = "Просили ноль — записал ноль.";
  }, {
    sql: true, focus: ["A", "B", "row", "orders"],
    voice: "Под A коммитит, и база честно перепроверяет условие пода B на свежей версии строки. Но в условии только номер товара, а он не изменился, так что проверка проходит: под B пишет свой ноль поверх и добавляет второй заказ.",
  });
  const naiveEnd = structuredClone(d.w);
  d.term("Lost update · read-modify-write");
  d.shot("", undefined, {
    verdict: ["red", "green"], focus: ["row", "orders", "board"],
    voice: "Заказов два, а остаток уменьшился всего на единицу: под B затёр вычитание пода A. Это потерянное обновление, lost update. Беда в схеме «прочитал, посчитал, записал вслепую», read-modify-write.",
  });

  // 1.2 Атомарный UPDATE: считает база, условие — в записи.
  d.scene(ACT.atomic, table());
  d.attempt("атомарный UPDATE");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: условие в UPDATE";
    w.code = { title: "Go · тот же код, другой запрос", lines: GO.atomic, mark: [{ line: 1, tone: "ok", note: "проверка и запись" }, { line: 2, tone: "ok" }, { line: 3, tone: "ok", note: "одним запросом" }, { line: 4, tone: "ok" }] };
  }, {
    focus: ["code"],
    voice: "Раз прочитанное успевает устареть до записи, перенесём проверку в сам запрос. Код на Go почти тот же, поменялся только UPDATE: теперь он сам уменьшает остаток на единицу и пишет, только если остаток больше нуля. А заказ добавляем, только если UPDATE действительно изменил строку.",
  });
  d.shot("", (w) => {
    press(w, "RC", "A", "B");
    writeAtomic(w, "A");
    writeAtomic(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Снова Аня и Борис жмут одновременно, и оба пода отправляют этот UPDATE. Под A меняет строку, а под B снова ждёт коммита.",
  });
  d.shot("", (w) => {
    order(w, "A");
    done(w, "A");
    wake(w, "B");
    soldOut(w, "B");
    w.check = { text: "AND stock > 0", ok: false };
    w.db = "Остаток уже ноль. Не пишу.";
  }, {
    sql: true, focus: ["A", "B", "row", "shop"],
    voice: "Под A коммитит, и база перепроверяет условие пода B на свежей версии строки. Теперь там ноль, условие не выполняется, и UPDATE не меняет ни одной строки. Под B видит, что изменено ноль строк, заказ не создаёт, а Борис получает «нет в наличии».",
  });
  const atomicEnd = structuredClone(d.w);
  d.term("Atomic update");
  d.shot("", undefined, {
    verdict: ["green", "green"], focus: ["row", "shop", "board"],
    voice: "В прошлый раз база перепроверяла только номер товара, а теперь проверяет и остаток. Это и есть атомарный UPDATE, atomic update: проверка и запись в одной операции. Лишнего не продали!",
  });
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: очередь задач";
    w.flashback = true;
  }, {
    focus: ["row"],
    voice: "Эта перепроверка не случайна. Помните очередь задач? Там поды B и C так же ждали коммита пода A, и база так же перепроверила их условие. Дело в настройке транзакции, уровне изоляции: она определяет, что транзакция видит из чужих изменений. В Postgres по умолчанию стоит READ COMMITTED, и с ним каждый запрос видит всё, что закоммичено к его началу.",
  });

  // 1.3 ⟲ Тот же наивный код на REPEATABLE READ: снимок замер, запись упирается в новую версию → 40001 → повтор.
  d.scene(ACT.rr, table());
  d.shot("", (w) => {
    w.code = { title: "Go · запереть строку при чтении", lines: GO.forUpdate, mark: [{ line: 3, tone: "ok" }] };
  }, {
    focus: ["code"],
    voice: "Но вернёмся к покупке с расчётом в коде. Не всякая логика влезает в один UPDATE: бывает, новый остаток надо посчитать по сложным правилам. Тогда строку можно запереть уже при чтении через FOR UPDATE, и под B встанет в ожидание ещё на чтении и увидит уже ноль. Это работает, но про блокировку придётся помнить в каждом таком месте кода.",
  });
  d.attempt("REPEATABLE READ");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: REPEATABLE READ";
    w.clockShown = true;
    w.horizon = "B";
    press(w, "RR", "A", "B");
    look(w, "A");
    look(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "clock", "sql"],
    voice: "Но подстраховаться можно иначе: оставим прежний код и поднимем уровень изоляции до REPEATABLE READ. На первом же запросе транзакция получает снимок, snapshot, и до самого конца не видит чужих коммитов, сделанных позже.",
  });
  d.shot("", (w) => {
    writeCounted(w, "A");
    writeCounted(w, "B");
    order(w, "A");
    done(w, "A");
  }, {
    sql: true, focus: ["A", "B", "row", "clock"],
    voice: "Дальше всё как раньше: под A записывает ноль, под B ждёт, под A добавляет заказ и коммитит. На READ COMMITTED под B просто взял бы новую версию строки. Но здесь он считал по своему снимку, где ещё единица, а новая версия появилась уже после снимка.",
  });
  d.term("Serialization failure · retry");
  d.shot("", (w) => {
    wake(w, "B");
    w.db = "Строка уже другая. Заново!";
  }, {
    sql: true, focus: ["B", "row", "sql"],
    voice: "И тут Postgres отказывается записывать! Под B хочет изменить строку, которую после его снимка уже изменила другая транзакция. Запиши он сейчас, и затёр бы изменение, которого даже не видел. Поэтому вместо тихой перезаписи под B получает ошибку сериализации, serialization failure, с кодом 40001. Его транзакция прервана.",
  });
  const rrFail = structuredClone(d.w);
  d.shot("", (w) => {
    sql(w, "B", "ROLLBACK");
    retry(w, "B", "RR");
    sql(w, "B", SQL.begin("RR"));
    look(w, "B");
    soldOut(w, "B");
  }, {
    sql: true, focus: ["B", "row", "shop"],
    voice: "Но это не ответ покупателю, а сигнал повторить, retry. Под B откатывает прерванную транзакцию и начинает её заново. Теперь у неё свежий снимок, и в нём уже ноль. Так Борис всё равно узнаёт правду: кружки нет.",
  });
  d.shot("", (w) => {
    w.costShown = true; // второй критерий табло появляется вместе с ценой (learning-designer, решение пользователя 24.10)
  }, {
    verdict: ["green", "yellow"], focus: ["board", "B"],
    voice: "Лишнего не продали, но появилась цена: код теперь обязан уметь повторять транзакцию, а прежним попыткам повторять не приходилось. Выходит, REPEATABLE READ не мешает ошибиться, зато не даёт ошибке пройти тихо: потерянное обновление становится громкой ошибкой.",
  });

  // Лесенка: уровней в Postgres четыре, пройдены два (решение пользователя 23.10: заголовок «Уровни изоляции»).
  d.chapter(null);
  d.scene(ACT.levels, structuredClone(d.w), { replay: true });
  d.shot("", (w) => {
    w.ladder = true;
    w.clockShown = false;
    w.horizon = null;
  }, {
    focus: ["ladder"],
    voice: "Оглянемся на все уровни изоляции Postgres: их четыре, из которых мы разобрали два: READ COMMITTED и REPEATABLE READ. А самый строгий, SERIALIZABLE, гарантирует результат, как если бы транзакции шли по очереди, но берёт за это более частыми повторами.",
  });

  // Итог — повтором уже виденных образов.
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B"] as const) x.actors[id].acts = structuredClone(saved.actors[id].acts);
      x.sql = [...saved.sql];
      x.db = null;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
    }, { voice, sql: saved.sql.length > 0 });
  };
  recap(naiveEnd, "Подведём итог. Если мы читаем остаток, считаем в коде и пишем обратно, второй под молча затрёт чужое обновление.");
  recap(atomicEnd, "Если же условие стоит в самом UPDATE, то на уровне по умолчанию база дождётся коммита соседа и перепроверит это условие на свежей строке.");
  recap(rrFail, "А когда логика не влезает в один оператор, строку можно запереть через FOR UPDATE. Либо поднять изоляцию до REPEATABLE READ: тогда потерянное обновление станет громкой ошибкой, а нам останется повторить транзакцию.");

  return d.steps;
}
