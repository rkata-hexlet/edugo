import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  begin, commit, insert, read, resume, retry, rollback, world, write,
  type ActorId, type Focus, type Level, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/05-isolation.md (эпизод 05 — кейс 1; кейс 2 со слотом курьера — эпизод 06).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс",
  naive: "1.1 Посчитали в Go",
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

/** Мысль-заблуждение пода: висит, пока он верит прочитанному. */
const MINE = "Вижу 1 — моя!";

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

/** Товара нет: заказ не создаём, транзакцию откатываем, покупатель видит «Нет в наличии». */
function soldOut(w: World, who: ActorId): void {
  rollback(w, who);
  sql(w, who, "ROLLBACK");
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

/** Свежий стол попытки: стопка версий строки видна; часы — только на REPEATABLE READ. */
function table(clockShown = false): World {
  const w = world();
  w.stack = true;
  w.clockShown = clockShown;
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
    voice: "Перед нами интернет-магазин. На витрине осталась последняя кружка, и на неё смотрят двое: Аня и Борис.",
  });
  d.shot("", undefined, {
    focus: ["A", "B", "row", "orders"],
    voice: "Заказы оформляет сервис из двух подов, A и B. Остатки и заказы лежат в Postgres: в таблице products у кружки записан остаток, stock, а в таблицу orders падают оформленные заказы.",
  });
  d.shot("", (w) => {
    for (const line of [SQL.begin("RC"), `${SQL.select}  -- 1`, "-- в Go: stock = stock - 1", SQL.set(0), SQL.insert, "COMMIT"]) sql(w, null, line);
  }, {
    sql: true, focus: ["sql"],
    voice: "Покупка устроена просто, всё в одной транзакции. Под читает остаток, и если товар есть, вычитает единицу у себя в коде на Go, записывает новое число и добавляет заказ. Важная деталь: открытая транзакция сама строку не запирает. Замок появляется, только когда в строку начинают писать.",
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
    done(w, "B");
    w.db = "Кружка одна. Заказов — два.";
  }, {
    focus: ["A", "B", "row", "orders", "shop"],
    voice: "Нет! Ноль под B посчитал ещё раньше, из той самой единицы. Под A коммитит, B дожидается, записывает свой ноль поверх и добавляет второй заказ. Оба покупателя получают подтверждение, остаток в базе честный ноль, а заказов два на одну кружку.",
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
  d.chapter(1, ["не продали лишнего", "без повторов"]);
  d.shot("", (w) => {
    w.plate = "Кейс\nКак не продать последнюю кружку дважды?";
  }, { hold: 2.5, voice: "Разберёмся, что пошло не так при одновременном нажатии. И будем следить за двумя вещами: чтобы лишнего не продали и чтобы транзакцию не пришлось повторять." });

  // 1.1 Прочитал → посчитал в Go → записал.
  d.scene(ACT.naive, table(), { replay: true });
  d.attempt("посчитали в Go");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: оба нажали";
    press(w, "RC", "A", "B");
    look(w, "A");
    look(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Вернёмся к одновременному нажатию и посмотрим медленнее. Оба пода читают остаток и видят одну и ту же строку, где stock равен единице. Дальше каждый вычитает единицу у себя в коде.",
  });
  d.shot("", (w) => {
    writeCounted(w, "A");
    writeCounted(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Под A записывает ноль. Postgres не правит строку на месте, а создаёт её новую версию, и до коммита A строка заперта для записи. Читать её при этом можно, а вот под B со своим UPDATE встаёт и ждёт.",
  });
  d.shot("", (w) => {
    order(w, "A");
    done(w, "A");
    wake(w, "B");
    w.db = "Сказали записать 0 — записал.";
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Под A добавляет заказ и коммитит. Тогда база перепроверяет условие пода B уже на свежей версии строки. Но в условии только номер товара, а он совпадает, поэтому B спокойно пишет свой ноль поверх.",
  });
  d.term("Lost update · read-modify-write");
  d.shot("", (w) => {
    order(w, "B");
    done(w, "B");
  }, {
    verdict: ["red", "green"], focus: ["B", "orders", "shop", "board"],
    voice: "Под B добавляет второй заказ и тоже коммитит. Списание пода A просто потерялось. Это lost update, потерянное обновление, классическая беда схемы «прочитал, посчитал в коде, записал».",
  });
  const naiveEnd = structuredClone(d.w);

  // 1.2 Атомарный UPDATE: считает база, условие — в записи.
  d.scene(ACT.atomic, table());
  d.attempt("атомарный UPDATE");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: считает база";
    press(w, "RC", "A", "B");
    writeAtomic(w, "A");
    writeAtomic(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Раз код на Go не видит соседа, пусть считает сама база. Оба пода сразу отправляют один UPDATE: уменьши остаток на единицу, но только если он больше нуля. Под A меняет строку, а под B снова ждёт.",
  });
  d.term("Atomic update");
  d.shot("", (w) => {
    order(w, "A");
    done(w, "A");
    wake(w, "B");
    soldOut(w, "B");
    w.db = "Условие проверю при записи.";
  }, {
    sql: true, verdict: ["green", "green"], focus: ["A", "B", "row", "shop", "board"],
    voice: "Под A коммитит, и база перепроверяет условие пода B на свежей версии строки. Теперь там ноль, условие не выполняется, и UPDATE не меняет ни одной строки. Под B видит это, заказ не создаёт, а Борис получает «нет в наличии».",
  });
  const atomicEnd = structuredClone(d.w);
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: очередь задач";
    w.flashback = true;
  }, {
    focus: ["row"],
    voice: "Помните очередь задач? Там поды B и C так же ждали коммита пода A, и база перепроверила их условие, статус «новый», уже на свежей строке. Так ведёт себя уровень изоляции Postgres по умолчанию, READ COMMITTED: каждый оператор видит то, что закоммичено к его началу, а UPDATE после ожидания перепроверяет своё условие.",
  });

  // 1.3 ⟲ Тот же наивный код на REPEATABLE READ: снимок замер, запись упирается в новую версию → 40001 → повтор.
  d.scene(ACT.rr, table(true));
  d.attempt("REPEATABLE READ");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: REPEATABLE READ";
    press(w, "RR", "A", "B");
    look(w, "A");
    look(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "clock", "sql"],
    voice: "Но не всякая логика влезает в один UPDATE: бывает, новый остаток надо посчитать в коде по сложным правилам. Тогда строку можно запереть уже при чтении, FOR UPDATE, и под B подождёт и прочитает ноль. А можно ничего не запирать, вернуться к прежнему коду и поднять уровень изоляции до REPEATABLE READ. На первом же запросе транзакция получает снимок и до самого конца видит только то, что было закоммичено к этому моменту.",
  });
  d.shot("", (w) => {
    writeCounted(w, "A");
    writeCounted(w, "B");
    order(w, "A");
    done(w, "A");
  }, {
    sql: true, focus: ["A", "B", "row", "clock"],
    voice: "Дальше всё как раньше: под A записывает ноль, под B ждёт, A добавляет заказ и коммитит. Только новая версия строки появилась уже после снимка пода B.",
  });
  d.term("Serialization failure · retry");
  d.shot("", (w) => {
    wake(w, "B");
    w.db = "Строка уже другая. Заново!";
  }, {
    sql: true, focus: ["B", "row", "sql"],
    voice: "И тут Postgres отказывается записывать! Под B хочет изменить строку, которую после его снимка изменил другой. Запиши он сейчас, и затёр бы изменение, которого даже не видел. Поэтому вместо тихой перезаписи B получает ошибку сериализации с кодом 40001, и его транзакция прервана.",
  });
  const rrFail = structuredClone(d.w);
  d.shot("", (w) => {
    sql(w, "B", "ROLLBACK");
    retry(w, "B", "RR");
    sql(w, "B", SQL.begin("RR"));
    look(w, "B");
    soldOut(w, "B");
  }, {
    sql: true, verdict: ["green", "yellow"], focus: ["B", "row", "shop", "board"],
    voice: "Это не ответ покупателю, а сигнал повторить. Под B откатывает прерванную транзакцию, начинает её заново, получает свежий снимок, видит ноль, и Борис узнаёт, что кружки нет. Лишнего не продали, но код теперь обязан уметь повторять транзакцию. И так ведёт себя именно Postgres: в MySQL с InnoDB тот же уровень потерял бы обновление молча.",
  });

  // Лесенка: уровней в Postgres четыре, пройдены два (решение пользователя 23.10: заголовок «Уровни изоляции»).
  d.chapter(null);
  d.scene(ACT.levels, structuredClone(d.w), { replay: true });
  d.shot("", (w) => {
    w.ladder = true;
    w.clockShown = false;
  }, {
    focus: ["ladder"],
    voice: "Оглянемся на лестницу уровней изоляции. В Postgres их четыре, и мы прошли два: READ COMMITTED, уровень по умолчанию, и REPEATABLE READ. Ступенька ниже, READ UNCOMMITTED, в Postgres работает так же, как READ COMMITTED: чужие незакоммиченные изменения он не показывает никогда. А на самом верху SERIALIZABLE. Он ловит и конфликты, где транзакции пишут в разные строки, но и повторять транзакции с ним приходится чаще.",
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
  recap(naiveEnd, "Подведём итог. Если прочитать остаток, посчитать в коде и записать, второй под молча затрёт чужое обновление.");
  recap(atomicEnd, "Если же условие стоит в самом UPDATE, база дождётся коммита соседа и перепроверит это условие на свежей строке.");
  recap(rrFail, "А когда логика не влезает в один оператор, REPEATABLE READ превратит тихую потерю в ошибку, и транзакцию мы повторим.");

  return d.steps;
}
