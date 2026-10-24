import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { ACT as ACT05, buildSteps as buildSteps05 } from "../05-isolation/script";
import type { World as World05 } from "../05-isolation/sim";
import {
  begin, commit, detect, place, resume, retry, take, world,
  type ActorId, type Code, type Focus, type Level, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/07-deadlock.md.
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  recall: "Вспомним кружку",
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс",
  ser: "1 Изоляция",
  retry: "2 Повтор",
  sort: "3 Сортировка",
  choice: "Когда что",
  summary: "Итог",
} as const;

const SQL = {
  begin: (level: Level) => (level === "RC" ? "BEGIN" : "BEGIN ISOLATION LEVEL SERIALIZABLE"),
  take: (id: number) => `UPDATE products SET stock = stock - 1\n  WHERE id = ${id} AND stock > 0`,
  deadlock: "ERROR: deadlock detected (40P01)",
};

/** Код приёма заказа на Go: цикл по корзине; на SERIALIZABLE; с сортировкой; повтор на 40P01; запросы одним махом. */
const GO = {
  loop: (level: "ReadCommitted" | "Serializable", sorted = false) => [
    "tx, err := db.BeginTx(ctx, pgx.TxOptions{",
    `  IsoLevel: pgx.${level}})`,
    "if err != nil { return err }",
    "defer tx.Rollback(ctx)",
    ...(sorted ? [
      "slices.SortFunc(cart.Items, func(a, b Item) int {",
      "  return cmp.Compare(a.ProductID, b.ProductID) })",
    ] : []),
    "for _, it := range cart.Items {",
    "  res, err := tx.Exec(ctx, `UPDATE products",
    "    SET stock = stock - 1",
    "    WHERE id = $1 AND stock > 0`, it.ProductID)",
    "  if err != nil { return err }",
    "  if res.RowsAffected() == 0 { return ErrNoStock }",
    "}",
    "_, err = tx.Exec(ctx, `INSERT INTO orders ...`)",
    "if err != nil { return err }",
    "return tx.Commit(ctx)",
  ],
  retry: [
    "var err error",
    "for try := 0; try < 3; try++ {",
    "  err = placeOrder(ctx, db, cart)",
    "  var pgErr *pgconn.PgError",
    "  if !errors.As(err, &pgErr) ||",
    "    pgErr.Code != \"40P01\" {",
    "    return err",
    "  }",
    "}",
    "return err",
  ],
  any: [
    "res, err := tx.Exec(ctx, `UPDATE products",
    "  SET stock = stock - 1",
    "  WHERE id = ANY($1) AND stock > 0`, ids)",
  ],
  forUpdate: [
    "rows, err := tx.Query(ctx, `SELECT id",
    "  FROM products",
    "  WHERE id = ANY($1)",
    "  ORDER BY id",
    "  FOR UPDATE`, ids)",
  ],
};

/** Высота окна кода эпизода — по самому длинному коду. */
export const CODE_ROWS = GO.loop("ReadCommitted", true).length;

/** Мысли-заблуждения подов: висят, пока под в них верит. */
const THINK = {
  A: "Кружка моя, теперь чайник",
  B: "Чайник мой, теперь кружка",
  wait: "Подожду, как с кружкой",
  soon: "Сейчас освободит",
};

/**
 * Исключения произношения для синтеза; экран и субтитр не меняются.
 * Буквы подов — по-русски (решение пользователя для серии).
 */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  "40P01": "сорок пэ ноль один",
  "40001": "сорок ноль ноль один",
  deadlock_timeout: "дэдлок таймаут",
  id: "ай ди",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

const STEPS05 = buildSteps05();
/** Кадр эпизода 05 во вставке: атомарный UPDATE, под B ждёт коммита A у запертой строки остатка. */
export const RECALL = STEPS05.findIndex((s) => s.act === ACT05.atomic && !!s.state.actors.B.tx?.waiting);

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
    w.stopwatch = null;
    w.code = null;
    w.aside = null;
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

/** Покупатели жмут «Оформить»: транзакция начинается. */
function press(w: World, level: Level, ...who: ActorId[]): void {
  for (const id of who) {
    customer(w, id).status = "press";
    w.events.push({ kind: "press", by: id });
    begin(w, id, level);
    sql(w, id, SQL.begin(level));
  }
}

/** Следующая позиция корзины; упёрся в чужой замок — покупатель смотрит на колёсико. */
function step(w: World, who: ActorId): void {
  const a = w.actors[who];
  const id = a.plan[a.pos];
  if (take(w, who) === "wait") customer(w, who).status = "wait";
  sql(w, who, SQL.take(id));
}

/** Замок освободился: UPDATE, который ждал, выполняется. */
function wake(w: World, who: ActorId): void {
  resume(w, who);
  sql(w, who, "-- дождался: UPDATE 1");
}

/** Остаток позиций, заказ и COMMIT: покупатель видит «Заказ принят». */
function finish(w: World, who: ActorId): void {
  const a = w.actors[who];
  while (a.tx && a.pos < a.plan.length) step(w, who);
  place(w, who, customer(w, who).name);
  commit(w, who);
  sql(w, who, "COMMIT");
  a.thought = null;
  customer(w, who).status = "ok";
  w.events.push({ kind: "ok", by: who });
}

/** Заказ целиком, без соседа. */
function order(w: World, who: ActorId, level: Level = "RC"): void {
  press(w, level, who);
  finish(w, who);
}

/** Детектор нашёл цикл: жертва получает 40P01, мысль опровергнута, покупатель видит ошибку. */
function deadlock(w: World): ActorId {
  const victim = detect(w);
  if (!victim) throw new Error("цикла нет");
  sql(w, victim, SQL.deadlock);
  const a = w.actors[victim];
  a.crossed = a.thought;
  a.thought = null;
  customer(w, victim).status = "fail";
  w.events.push({ kind: "refused", by: victim });
  return victim;
}

/** Код на экране. */
function code(w: World, title: string, lines: string[], mark: Code["mark"]): void {
  w.code = { title, lines, mark };
}

/** Позиции корзины отсортированы по id во всех подах. */
function sortPlans(w: World): void {
  for (const a of Object.values(w.actors)) a.plan = [...a.plan].sort((x, y) => x - y);
}

/** Хук и попытка 1: обе корзины навстречу, цикл, секунда, 40P01 у B, A дожидается чайника и коммитит. */
function race(w: World, level: Level): void {
  press(w, level, "A", "B");
  step(w, "A");
  step(w, "B");
  step(w, "B");
  step(w, "A");
}

function resolve(w: World): void {
  w.stopwatch = 1;
  w.events.push({ kind: "tick" });
  const victim = deadlock(w);
  const winner: ActorId = victim === "A" ? "B" : "A";
  wake(w, winner);
  finish(w, winner);
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Вспомним кружку: кадр 05 его же отрисовкой — B ждёт коммита A у запертой строки.
  d.scene(ACT.recall);
  d.shot("", (w) => {
    w.flashback = RECALL;
    w.stamp = "⟲ Вспомним: последняя кружка";
  }, {
    voice: "Помните последнюю кружку? Аня и Борис нажали «Купить» в одну секунду, под A списал остаток, а под B упёрся в запертую строку и ждал. Это ожидание нас тогда и спасло: B дождался коммита, база перепроверила остаток на свежей версии, и лишний заказ не прошёл. Запомним главное: запись держит строку запертой до самого коммита. Сегодня это обернётся против нас.",
  });

  // Знакомство: корзины, склад, код, замок до коммита.
  d.scene(ACT.intro);
  d.shot("", undefined, {
    focus: ["shop"],
    voice: "С тех пор кружку завезли, а магазин подрос: покупатели теперь собирают корзины из нескольких товаров. Аня кладёт в свою сначала кружку, потом чайник, а Борис, наоборот, сначала чайник, потом кружку.",
  });
  d.shot("", (w) => {
    w.db = "Склад большой. Хватит всем.";
  }, {
    focus: ["A", "B", "products", "db"],
    voice: "Заказы по-прежнему принимают поды A и B, два экземпляра нашего сервиса на Go, а остатки лежат в Postgres, в таблице products. У чайника id три, у кружки id семь, и тех и других по десять штук. Склад большой, и это важно: из-за нехватки товара сегодня никто не пострадает.",
  });
  d.shot("", (w) => {
    code(w, "Go · приём заказа", GO.loop("ReadCommitted"), [
      { line: 5, tone: "ok", note: "атомарный UPDATE" }, { line: 6, tone: "ok" }, { line: 7, tone: "ok" },
      { line: 4, tone: "warn", note: "порядок покупателя" },
    ]);
  }, {
    focus: ["code"],
    voice: "Принимает заказ вот такой код на Go, транзакция на READ COMMITTED. Он идёт по корзине и на каждую позицию делает атомарный UPDATE с проверкой остатка, тот самый, что спас последнюю кружку. Если товар кончился, заказ откатывается; если списалось всё, вставляем заказ и коммитим. Заметьте: цикл идёт по корзине в том порядке, в каком товары положил покупатель.",
  });
  d.shot("", (w) => {
    begin(w, "A", "RC");
    step(w, "A");
    step(w, "A");
  }, {
    sql: true, focus: ["A", "products", "sql"],
    voice: "Тут легко подумать, что UPDATE отпускает строку, как только выполнился. Но нет: запись держит строку запертой до самого коммита, и наш UPDATE не исключение. Пока под A списывает вторую позицию, замок на первой остаётся при нём. Казалось бы, товара хватает обоим, а если и столкнутся, то один просто подождёт, как с кружкой.",
  });

  // Хук: две корзины навстречу — кольцо, секунда, 40P01.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    press(w, "RC", "A", "B");
  }, {
    focus: ["A", "B", "shop"],
    voice: "И вот Аня и Борис оформляют заказы в одну секунду. Под A берёт корзину Ани, под B корзину Бориса, и оба идут по ней сверху вниз.",
  });
  d.shot("", (w) => {
    step(w, "A");
    step(w, "B");
    w.actors.A.thought = THINK.A;
    w.actors.B.thought = THINK.B;
  }, {
    focus: ["A", "B", "products"],
    voice: "Первым делом под A списывает кружку, а под B чайник. Строки разные, поэтому обе записи проходят мгновенно, и каждый под идёт дальше, держа свою запертую строку.",
  });
  d.shot("", (w) => {
    step(w, "B");
    w.actors.B.thought = THINK.wait;
    w.db = "Жду коммита. Дело обычное.";
  }, {
    focus: ["B", "products", "db"],
    voice: "Теперь под B идёт за кружкой, а она заперта у пода A до его коммита. B встаёт и ждёт, и пока всё выглядит привычно: сейчас A закончит, и B пойдёт дальше.",
  });
  d.term("Deadlock");
  d.shot("", (w) => {
    step(w, "A");
    w.actors.A.thought = THINK.soon;
    w.db = "Теперь вы ждёте друг друга.";
  }, {
    focus: ["A", "B", "products", "db"],
    voice: "Но тут под A идёт за чайником, а чайник-то у B! Теперь каждый действительно стоит и ждёт другого, причём ждёт его коммита, а закоммитить ни один не может, пока не получит вторую позицию. Кольцо замкнулось! Это и есть deadlock, взаимная блокировка: ждут друг друга двое, и сами выйти не смогут. Но это не горутины Go и не мьютексы, цикл ожидания живёт в базе. Кто же из них уступит?",
  });
  const hookRing = structuredClone(d.w);
  d.shot("", (w) => {
    w.stopwatch = 1;
    w.events.push({ kind: "tick" });
    w.db = "Поиск дорогой. Жду секунду.";
  }, {
    focus: ["db", "shop"],
    voice: "Зависнут ли они навсегда? Нет, но и сразу Postgres кольцо искать не станет. Искать цикл ожидания дорого, а обычно ожидание кончается само, поэтому он сначала выжидает целую секунду. Эта настройка называется deadlock_timeout. А Аня и Борис всё это время сидят и ждут подтверждения заказа.",
  });
  d.shot("", (w) => {
    resolve(w);
    w.db = "Цикл! Откатываю B.";
  }, {
    sql: true, focus: ["A", "B", "products", "shop", "db"],
    voice: "Секунда вышла, и Postgres находит цикл! Одну транзакцию придётся прервать. У нас это B, он начал ждать первым, хотя заранее, кого прервут, не угадать. Под B получает ошибку 40P01, deadlock detected, его транзакция откатывается целиком, и чайник возвращается на склад. Борис видит «Не удалось оформить заказ» при полном складе! А под A наконец получает чайник, и Аня видит подтверждение, только на секунду позже, так и не узнав почему.",
  });
  const hookEnd = structuredClone(d.w);

  // Норма: по очереди.
  d.scene(ACT.norm);
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: по очереди";
    order(w, "A");
  }, {
    focus: ["A", "products", "shop"],
    voice: "А как должно быть? Пусть заказы идут по очереди. Под A списывает кружку, потом чайник и коммитит, и Аня получает подтверждение сразу, без всякой паузы.",
  });
  d.shot("", (w) => {
    order(w, "B");
  }, {
    focus: ["B", "products", "shop"],
    voice: "Следом под B списывает чайник, потом кружку и тоже коммитит. Оба заказа приняты, и никто никого не ждал по кругу. Борис опять второй, зато с принятым заказом.",
  });

  // КЕЙС.
  d.scene(ACT.case1);
  d.chapter(1, ["оба приняты", "без повтора"]);
  d.shot("", (w) => {
    w.plate = "Кейс\nКак не дать заказам\nзапереть друг друга?";
  }, {
    hold: 2.5,
    voice: "Но в жизни заказы приходят одновременно. Как же добиться того же результата, когда они идут параллельно? Следить будем за двумя вещами: чтобы оба заказа были приняты и чтобы никому не пришлось повторять.",
  });

  // 1 Изоляция: SERIALIZABLE — то же кольцо.
  d.scene(ACT.ser, world());
  d.attempt("SERIALIZABLE");
  d.shot("", (w) => {
    race(w, "SER");
    resolve(w);
    w.sql = [];
    sql(w, "A", SQL.begin("SER"));
    sql(w, "B", SQL.begin("SER"));
    sql(w, "B", SQL.deadlock);
    w.db = "Уровень тут ни при чём.";
  }, {
    sql: true, verdict: ["red", null], focus: ["A", "B", "products", "sql", "board"],
    voice: "Попробуем то, что первым приходит в голову после истории со слотом курьера: поднять изоляцию до SERIALIZABLE. Но кольцо замыкается точно так же! Уровень изоляции решает, какие данные видит транзакция, а замки строк работают одинаково на любом уровне. Здесь ведь никто ничего не посчитал неправильно: двое просто ждут друг друга.",
  });

  // 2 Повтор на 40P01 нашим кодом: с момента после отката B.
  d.scene(ACT.retry, structuredClone(hookEnd), { replay: true });
  d.attempt("повтор на 40P01");
  d.shot("", (w) => {
    code(w, "Go · повтор на 40P01", GO.retry, [{ line: 5, tone: "ok", note: "только 40P01" }, { line: 1, tone: "ok", note: "заново" }]);
  }, {
    focus: ["code"],
    voice: "Раз изоляция не лечит, зайдём с другой стороны. Ошибка 40P01 говорит не «товара нет», а «транзакцию отменили», а отменённую транзакцию можно повторить. Только повторит её не Postgres, он лишь откатил: ловить ошибку и начинать транзакцию заново должен наш код на Go, так же как с 40001 в истории со слотом курьера.",
  });
  d.term("Retry on deadlock");
  d.shot("", (w) => {
    retry(w, "B", "RC");
    customer(w, "B").status = "press";
    sql(w, "B", SQL.begin("RC"));
    finish(w, "B");
    w.stopwatch = 1;
    w.db = "Секунду мы потеряли на двоих.";
  }, {
    sql: true, verdict: ["green", "yellow"], focus: ["B", "products", "shop", "board"],
    voice: "Запускаем заново: это и есть повтор на deadlock, retry. Под A к этому моменту уже закоммитил и снял замки, поэтому второй заход B проходит без помех, и оба заказа приняты. Но цена видна: оба потеряли секунду на ожидании, а под B проделал всю работу дважды.",
  });
  d.shot("", (w) => {
    w.aside = "sale";
  }, {
    focus: ["board"],
    voice: "Пока заказы идут раз в минуту, это можно стерпеть. А на распродаже кольца будут замыкаться снова и снова, и каждое съест секунду. Уменьшить deadlock_timeout? Тогда дорогая проверка будет запускаться чаще, на каждом безобидном ожидании. Лучше не давать кольцу замкнуться вовсе.",
  });

  // 3 Сортировка по id: второй ждёт с пустыми руками — очередь, а не кольцо.
  d.scene(ACT.sort, world());
  d.attempt("сортировка по id");
  d.shot("", undefined, {
    focus: ["A", "B", "shop"],
    voice: "Откуда вообще берётся кольцо? Аня идёт по товарам в одном порядке, Борис в обратном, и посередине они сталкиваются. Если все пойдут в одном порядке, встречных не будет. А порядок задаёт не покупатель, а наш код.",
  });
  d.shot("", (w) => {
    sortPlans(w);
    code(w, "Go · тот же код, порядок по id", GO.loop("ReadCommitted", true), [
      { line: 4, tone: "ok" }, { line: 5, tone: "ok", note: "одна строка" },
    ]);
    w.db = "Чайник первым, по порядку.";
  }, {
    focus: ["code", "db"],
    voice: "Поэтому перед циклом отсортируем позиции корзины по id товара. Одна строка, и у обоих порядок одинаковый: сначала чайник, потом кружка. Остальное не трогаем, мы по-прежнему на READ COMMITTED, как с последней кружкой.",
  });
  d.term("Lock ordering");
  d.shot("", (w) => {
    press(w, "RC", "A", "B");
    step(w, "A");
    step(w, "B");
  }, {
    sql: true, focus: ["A", "B", "products"],
    voice: "Снова одновременное нажатие, и оба идут за чайником. Запирает его под A, и B опять ждёт. Но почувствуйте разницу: в прошлый заход B ждал, держа запертый чайник, а теперь в руках у него ничего нет. Значит, на нём никто не завис, и замкнуть кольцо ему нечем. Этот приём называется lock ordering: все берут замки в одном порядке.",
  });
  d.shot("", (w) => {
    finish(w, "A");
  }, {
    focus: ["A", "products", "shop"],
    voice: "Дальше под A спокойно берёт кружку, до которой B ещё не дошёл, и коммитит. Вопрос, кто уступит, отпал сам собой: никто никому не уступал, один просто постоял в очереди за другим.",
  });
  d.shot("", (w) => {
    wake(w, "B");
    finish(w, "B");
    w.check = { text: "AND stock > 0", ok: true };
    w.db = "Остаток проверил. Проходи.";
  }, {
    sql: true, verdict: ["green", "green"], focus: ["B", "products", "shop", "board"],
    voice: "Тут просыпается под B, и, как с кружкой, база перепроверяет остаток на свежей версии строки. Товар есть, B списывает чайник, потом кружку и коммитит. Оба заказа приняты без единого повтора, а ждал B ровно столько, сколько A оформлял свой заказ, а не целую секунду.",
  });
  const sortEnd = structuredClone(d.w);
  d.shot("", (w) => {
    code(w, "Go · а если одним запросом?", GO.any, [{ line: 2, tone: "warn", note: "порядок решает план" }]);
  }, {
    focus: ["code"],
    voice: "Внимательный инженер спросит: зачем вообще цикл, если можно списать всю корзину одним запросом сразу по списку id? Увы, один запрос не обещает, в каком порядке запрёт строки: это зависит от плана выполнения, а ORDER BY у UPDATE в Postgres нет. Так что кольцо возможно и здесь.",
  });
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: порядок задаёт база";
    code(w, "Go · запереть строки по порядку", GO.forUpdate, [{ line: 3, tone: "ok", note: "по порядку" }, { line: 4, tone: "ok", note: "запереть" }]);
  }, {
    focus: ["code"],
    voice: "Значит, без цикла не обойтись? Обойтись можно, если доверить порядок базе. Сначала выбираем нужные строки через SELECT с ORDER BY и FOR UPDATE, и Postgres запирает их по порядку, одну за другой. Работает так же надёжно, а стоит лишь одного лишнего запроса.",
  });

  // Когда что: порядок во всех путях, повтор — страховка; 40P01 против 40001.
  d.scene(ACT.choice, structuredClone(sortEnd), { replay: true });
  d.shot("", (w) => {
    w.aside = "paths";
  }, {
    voice: "Значит, отсортировали, и повтор больше не нужен? Не совсем. Порядок должен быть одним везде, где транзакция запирает несколько строк: при оформлении, отмене, правке из админки, приёмке на складе. Стоит одному пути пойти в обратном порядке, и кольцо вернётся. Так что повтор на 40P01 оставим страховкой там, где порядок не в наших руках.",
  });
  d.shot("", (w) => {
    w.aside = "codes";
  }, {
    voice: "И не путайте 40P01 с 40001, хотя повторяют их одинаково. 40001 говорит, что данные изменились, и после повтора ответ может стать другим. А 40P01 говорит, что двое ждали друг друга, и данные тут ни при чём. Поэтому 40P01 мы убираем порядком в коде, а ещё держим транзакции короткими: чем короче замок, тем реже кому-то приходится ждать.",
  });

  // Итог — повтором уже виденных сцен: кольцо, отмена, порядок.
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B"] as const) {
        x.actors[id].acts = structuredClone(saved.actors[id].acts);
        x.actors[id].crossed = saved.actors[id].crossed;
      }
      x.sql = [...saved.sql];
      x.db = null;
      x.stopwatch = saved.stopwatch;
      x.check = saved.check;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
    }, { voice, sql: saved.sql.length > 0 });
  };
  recap(hookRing, "Итак, что же случилось? Каждая запись держит строку до коммита, и когда две корзины идут навстречу друг другу, каждый заказ держит то, что нужно другому, и ждёт то, что держит другой.");
  recap(hookEnd, "Через секунду Postgres находит кольцо и отменяет одну из транзакций. Борис получает ошибку при полном складе, а Аня ждёт дольше, чем должна. Повтор это лечит, но ценой секунды и двойной работы.");
  recap(sortEnd, "А спас нас общий порядок. Позиции отсортированы по id, тот, кто ждёт, ничего не держит, и кольцу замкнуться не из чего. Оба заказа приняты, и без всяких повторов.");

  return d.steps;
}

