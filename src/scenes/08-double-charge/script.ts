import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { buildSteps as buildSteps01 } from "../01-skip-locked/script";
import type { World as World01 } from "../01-skip-locked/sim";
import {
  AMOUNT, ORDER, advance, callBank, charge, claimKey, crash, finishKey, insertPayment, paid, readKey, reply, request,
  takeOver, world, type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/08-double-charge.md.
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  intro: "Знакомство",
  norm: "Норма",
  hook: "0. Хук",
  case1: "Кейс 1",
  check: "1.1 Проверка",
  claim: "1.2 Захват ключа",
  answer: "1.3 Ответ в ключе",
  case2: "Кейс 2",
  stuck: "2.1 Завис",
  lease: "2.2 Срок",
  e2e: "2.3 Ключ в банк",
  recall: "Вспомним Почту",
  summary: "Итог",
} as const;

/** Ключи попыток оплаты: первая и новая (после «ключ уже использован»). */
export const KEY = { first: "k-7f3a", second: "k-9c11" };

const OK = "200 · оплачено";

const SQL = {
  check: `SELECT 1 FROM payments WHERE order_id = ${ORDER}`,
  pay: `INSERT INTO payments VALUES (${ORDER}, ${AMOUNT})`,
  claim: (key: string) => `INSERT INTO idempotency_keys (key)\n  VALUES ('${key}') ON CONFLICT DO NOTHING`,
  read: (key: string) => `SELECT status, response\n  FROM idempotency_keys WHERE key = '${key}'`,
  done: (key: string) => `UPDATE idempotency_keys\n  SET status = 'done', response = '${OK}'\n  WHERE key = '${key}'`,
  take: (key: string) => `UPDATE idempotency_keys\n  SET locked_until = now() + '30s'\n  WHERE key = '${key}'\n    AND locked_until < now()`,
};

/** Код пода на Go: наивный обработчик — сначала банк, потом запись. */
const GO = {
  naive: [
    "func (s *Service) Pay(ctx context.Context, r Pay) error {",
    "  if err := s.bank.Charge(ctx, r); err != nil {",
    "    return err",
    "  }",
    "  _, err := s.db.Exec(ctx, `INSERT INTO payments",
    "    VALUES ($1, $2)`, r.OrderID, r.Amount)",
    "  return err",
    "}",
  ],
};

/** Мысли-заблуждения: висят, пока герой в них верит. */
const THINK = {
  ira: "Не прошло?",
  fresh: "Первый раз вижу",
  empty: "Платежа нет, спишу!",
  used: "Не прошло, заплачу заново",
  expired: "Списания не было",
};

/**
 * Исключения произношения для синтеза; экран и субтитр не меняются.
 * Буквы подов — по-русски (решение пользователя для серии).
 */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  "409": "четыреста девять",
  locked_until: "локд антил",
  payments: "пэйментс",
  done: "дан",
  processing: "процессинг",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", w.bank ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

const STEPS01 = buildSteps01();
/** Кадр эпизода 01 во вставке: Почта узнаёт повтор письма по ключу. */
export const RECALL = STEPS01.findIndex((s) => s.state.keyed && !!s.state.mail);

/** Мир этого кадра 01 для его же отрисовки: только сцена — без табло, SQL-панели и реплики (шапку занимает штамп). */
export function recallWorld(step: number): World01 {
  const w = structuredClone(STEPS01[step].state);
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
    w.bank = null;
    w.code = null;
    w.aside = null;
    w.flashback = null;
  }

  protected override finish(w: World): void {
    w.replay = this.replaying;
  }
}

// --- Глаголы сценария: операции модели + запросы в SQL-панели. Поды не двигаются — двигаются стрелки. ---

function sql(w: World, who: ActorId, text: string): void {
  w.sql.push(`${w.actors[who].label} ▸ ${text}`);
}

/** Ира жмёт «Оплатить» или «Повторить»: запрос уходит на под. */
function press(w: World, who: ActorId): void {
  w.events.push({ kind: "press" });
  request(w, who);
}

/** Наивный обработчик целиком: банк, запись, ответ. */
function naive(w: World, who: ActorId): void {
  charge(w, who);
  insertPayment(w, who);
  sql(w, who, SQL.pay);
  reply(w, who, "оплачено", "ok", "paid");
}

/** Приложение не дождалось ответа: ошибка сети, Ира думает, что не прошло. */
function timeout(w: World): void {
  w.phone.screen = "error";
  w.phone.thought = THINK.ira;
  w.doubt = true;
}

/** Захват ключа текущей попытки: INSERT … ON CONFLICT DO NOTHING. */
function claim(w: World, who: ActorId, lease = false): "inserted" | "conflict" {
  const key = w.phone.key!;
  sql(w, who, SQL.claim(key));
  const r = claimKey(w, who, key, lease);
  sql(w, who, r === "inserted" ? "-- INSERT 0 1" : "-- INSERT 0 0: такой ключ уже есть");
  return r;
}

/** Банк ответил: платёж, done и ответ — одной транзакцией. */
function settle(w: World, who: ActorId): void {
  const key = w.phone.key!;
  sql(w, who, "BEGIN");
  sql(w, who, SQL.pay);
  sql(w, who, SQL.done(key));
  sql(w, who, "COMMIT");
  finishKey(w, who, key, OK);
}

/** Повтор с сохранённым ответом: ключ уже есть — читаем строку и отвечаем по статусу. */
function answer(w: World, who: ActorId): void {
  const key = w.phone.key!;
  claim(w, who);
  sql(w, who, SQL.read(key));
  const k = readKey(w, who, key);
  if (k.status === "done") reply(w, who, "оплачено", "ok", "paid");
  else reply(w, who, "409 · ещё в работе", "warn", "busy");
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: Ира, система, код, норма.
  d.scene(ACT.intro);
  d.shot("", undefined, {
    focus: ["phone"],
    voice: "Это Ира. Она едет в метро и покупает кроссовки за девятьсот девяносто рублей, это заказ номер семь. Заплатит она один раз, а с карты у неё уйдёт вдвое больше. Давайте разберёмся, как так вышло.",
  });
  d.shot("", (w) => {
    w.db = "Банк? Не знаю такого.";
  }, {
    focus: ["A", "B", "payments", "bank", "db"],
    voice: "Сначала познакомимся с системой. Приложение Иры отправляет оплату в наш сервис на Go, он крутится на двух подах, A и B, и балансировщик отдаёт запрос любому из них. Платежи мы храним в Postgres, в таблице payments. А деньги списывает банк: он живёт снаружи, и наша база про его дела ничего не знает.",
  });
  d.shot("", (w) => {
    w.code = { title: "Go · приём оплаты", lines: GO.naive, mark: [{ line: 1, tone: "warn", note: "сначала банк" }, { line: 4, tone: "warn", note: "потом запись" }] };
  }, {
    focus: ["code"],
    voice: "Теперь заглянем в обработчик оплаты. Под сначала вызывает банк, и когда тот отвечает «списано», записывает платёж в таблицу и отвечает приложению. Запомним этот порядок: сначала банк, потом запись в базу. Банк и наша база друг о друге не знают, одной транзакцией их не связать, и именно на этом всё и сломается.",
  });

  d.scene(ACT.norm);
  d.shot("", (w) => {
    press(w, "A");
    naive(w, "A");
  }, {
    sql: true, focus: ["phone", "A", "bank", "payments"],
    voice: "Теперь посмотрим, как это работает, пока со связью всё в порядке. Ира жмёт «Оплатить», и кнопка на время запроса блокируется, чтобы случайно не нажать дважды. Под A списывает девятьсот девяносто рублей, записывает платёж и отвечает «оплачено». Один заказ, одно списание, всё честно.",
  });

  // Хук: ответ теряется в туннеле, повтор на B — второе списание.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    w.phone.tunnel = true;
    press(w, "A");
    naive(w, "A");
  }, {
    sql: true, focus: ["phone", "A", "bank", "payments"],
    voice: "Но тут поезд ныряет в туннель! Запрос тот же и под тот же, A, банк так же списывает деньги, и платёж ложится в таблицу. А вот ответ летит обратно в пустоту: связи нет, и до телефона он не доходит.",
  });
  d.shot("", (w) => {
    timeout(w);
  }, {
    focus: ["phone", "bank"],
    voice: "Приложение ждёт ответа, ждёт, а потом сдаётся: «Ошибка сети. Повторить?». Ира понимает это как «не прошло». Но деньги-то давно списаны! Выходит, отсутствие ответа вовсе не значит «нет», оно значит «неизвестно».",
  });
  d.shot("", (w) => {
    w.phone.tunnel = false;
    w.phone.thought = null;
    press(w, "B");
    w.actors.B.thought = THINK.fresh;
  }, {
    focus: ["phone", "B"],
    voice: "Конечно, Ира жмёт «Повторить». На этот раз балансировщик отправляет запрос на под B, а для него это совершенно новая оплата заказа семь. Про первую попытку он ничего не знает, а наш код ничего и не проверяет: он сразу идёт в банк.",
  });
  d.term("Retry after timeout");
  d.shot("", (w) => {
    naive(w, "B");
    w.actors.B.thought = null;
    w.doubt = false;
    w.bank = "Просили дважды.";
  }, {
    focus: ["phone", "B", "bank"],
    voice: "И банк списывает ещё раз! Кроссовки одни, а списаний два. Деньги потом вернут, но Ира уже напугана, а нам писать извинения. Так это и называется: повтор после таймаута, retry after timeout. Ответ потерялся, клиент повторил, и оба запроса дошли до банка. Заметьте, кнопку дважды Ира не нажимала, так что блокировка кнопки тут не спасёт.",
  });
  const hookEnd = structuredClone(d.w);

  // КЕЙС 1: одно списание / честный ответ.
  d.scene(ACT.case1);
  d.chapter(1, ["одно списание", "честный ответ"]);
  d.shot("", (w) => {
    w.plate = "Кейс 1 из 2\nИра повторила оплату.\nКак списать один раз?";
  }, {
    hold: 2.5,
    voice: "Запретить повторы нельзя: сеть рвётся, и приложение обязано переспросить. Поэтому научим сервис их переживать. Следить будем за двумя вещами: чтобы на одну попытку оплаты уходило одно списание и чтобы приложение получало честный ответ о том, что случилось на самом деле.",
  });

  // 1.1 Проверка по заказу: SELECT, потом банк — повтор проскакивает, пока первый ждёт банк.
  d.scene(ACT.check, world());
  d.attempt("проверка по заказу");
  d.shot("", (w) => {
    press(w, "A");
    paid(w, "A");
    sql(w, "A", SQL.check);
    sql(w, "A", "-- 0 строк");
    callBank(w, "A");
  }, {
    sql: true, focus: ["phone", "A", "payments", "bank", "sql"],
    voice: "Начнём с самого очевидного. В туннеле платёж уже лежал в таблице, так что спросим у базы перед списанием, нет ли платежа по этому заказу. Под A проверяет, видит пусто и идёт в банк. Но повтор бывает и раньше: банк сегодня отвечает медленно, и у приложения раньше кончается терпение.",
  });
  d.shot("", (w) => {
    timeout(w);
    w.phone.thought = null;
    press(w, "B");
    paid(w, "B");
    sql(w, "B", SQL.check);
    sql(w, "B", "-- 0 строк");
    w.actors.B.thought = THINK.empty;
  }, {
    sql: true, focus: ["phone", "A", "B", "payments", "sql"],
    voice: "Ира, конечно, жмёт «Повторить», и запрос попадает на под B. Тот тоже проверяет базу по заказу семь, и там опять пусто. Неудивительно: платёж мы записываем только после ответа банка, а под A всё ещё ждёт этого ответа.",
  });
  d.term("Check-then-act");
  d.shot("", (w) => {
    naive(w, "A");
    naive(w, "B");
    w.actors.B.crossed = w.actors.B.thought;
    w.actors.B.thought = null;
    w.doubt = false;
  }, {
    verdict: ["red", "green"], focus: ["B", "bank", "phone", "board"],
    voice: "И вот результат: в банк идут оба, денег уходит вдвое больше, а Ира при этом видит честное «оплачено». Это классический check-then-act: проверка и действие разнесены во времени, и в окно между ними проскочил повтор. Ту же гонку мы видели в ролике про конкурентную обработку задач, когда три пода схватили одну задачу.",
  });

  // 1.2 Захват ключа: UNIQUE и ON CONFLICT, COMMIT до банка — но ответ «ключ уже использован».
  d.scene(ACT.claim, world());
  d.shot("", (w) => {
    w.keyCols = ["key"];
  }, {
    focus: ["keys"],
    voice: "Значит, проверять и действовать по отдельности нельзя. Занять оплату нужно одной атомарной операцией, и сделать это должна база: заведём таблицу с уникальным индексом, и вторую такую же строку она просто не пустит.",
  });
  d.shot("", (w) => {
    w.aside = "attempts";
  }, {
    voice: "Но уникальный по чему? Номер заказа напрашивается сам, но подведёт: если банк отклонил карту, а Ира заплатила другой, это законная вторая попытка того же заказа. Нам нужно отличать повтор того же запроса от новой попытки.",
  });
  d.shot("", (w) => {
    w.phone.key = KEY.first;
  }, {
    focus: ["phone"],
    voice: "Поэтому ключ придумывает приложение, как только Ира открыла экран оплаты, ещё до нажатия кнопки. Один ключ на одну попытку: все повторы летят с этим же ключом, а новая попытка получит новый. Это и есть ключ идемпотентности, idempotency key: сколько раз ни повтори запрос с ним, эффект должен быть один.",
  });
  d.attempt("уникальный ключ");
  d.term("Unique constraint · ON CONFLICT");
  d.shot("", (w) => {
    w.phone.tunnel = true;
    press(w, "A");
    claim(w, "A");
    charge(w, "A", null);
    insertPayment(w, "A");
    reply(w, "A", "оплачено", "ok", "paid");
  }, {
    sql: true, focus: ["phone", "A", "keys", "bank", "sql"],
    voice: "Попробуем. Под первым делом вставляет ключ через INSERT с ON CONFLICT DO NOTHING, коммитит и только после этого идёт в банк. Почему не держать транзакцию до ответа банка? Тогда соединение с базой простаивало бы, пока банк думает, а упади под после банка, откат унёс бы и ключ, и следующий повтор снова пошёл бы в банк. Деньги списаны, но ответ снова теряется в туннеле.",
  });
  d.shot("", (w) => {
    timeout(w);
    w.phone.thought = null;
    w.phone.tunnel = false;
    press(w, "B");
    claim(w, "B");
    w.db = "Такой ключ уже есть.";
  }, {
    sql: true, focus: ["phone", "B", "keys", "bank", "sql", "db"],
    voice: "Ира повторяет с тем же ключом, и запрос снова попадает на под B. Вставка возвращает ноль строк: уникальный индекс не пускает второй такой же ключ. Заметьте, повтор здесь опознала не база, она просто отказалась вставлять, а решение принимает под. Раз ключ уже есть, в банк он не идёт. Дубль отбит!",
  });
  d.shot("", (w) => {
    reply(w, "B", "ключ уже использован", "error", "used");
    w.phone.thought = THINK.used;
  }, {
    verdict: ["green", "red"], focus: ["phone", "B", "bank", "board"],
    voice: "Но что при этом ответить Ире? Пока под B просто возвращает ошибку «ключ уже использован». Списание одно, зато Ира видит ошибку и решает, что оплата не прошла. Выходит, мы опять сказали «нет» там, где на самом деле всё прошло.",
  });
  d.shot("", (w) => {
    w.phone.thought = null;
    w.doubt = false;
    w.phone.key = KEY.second;
    w.phone.screen = "buy";
  }, {
    focus: ["phone"],
    voice: "А что ей остаётся? Ира закрывает ошибку и открывает оплату заново, как сделал бы любой. Для приложения это уже не повтор, а новая попытка, поэтому и ключ у неё новый.",
  });
  d.shot("", (w) => {
    press(w, "A");
    claim(w, "A");
    charge(w, "A", null);
    insertPayment(w, "A");
    reply(w, "A", "оплачено", "ok", "paid");
  }, {
    sql: true, focus: ["phone", "A", "keys", "bank"],
    voice: "Нажатие проходит, и банк честно списывает деньги. Второе списание, и на этот раз вообще без гонки! Дубль мы пропустили сами: не дали честного ответа.",
  });

  // 1.3 Ответ в строке ключа: done → сохранённый ответ, processing → 409.
  d.scene(ACT.answer, world());
  d.attempt("ответ в строке ключа");
  d.shot("", (w) => {
    w.keyCols = ["key", "status"];
    w.phone.key = KEY.first;
    w.phone.tunnel = true;
    press(w, "A");
    claim(w, "A");
    charge(w, "A", null);
    w.sql = [];
    settle(w, "A");
    reply(w, "A", "оплачено", "ok", "paid");
  }, {
    sql: true, focus: ["phone", "A", "keys", "payments", "sql"],
    voice: "Выходит, ключу мало помнить, что запрос был: он должен помнить, чем всё закончилось. Поэтому добавим в строку ключа статус и сам ответ. Пока под ходит в банк, статус processing, то есть в работе. Когда банк ответил, под одной транзакцией записывает платёж, ставит статус done, то есть готово, и кладёт ответ рядом, чтобы платёж и закрытый ключ не разошлись. Ответ Ире снова теряется в туннеле, но теперь он сохранён в базе.",
  });
  d.term("Idempotency key · replay");
  d.shot("", (w) => {
    timeout(w);
    w.phone.thought = null;
    w.phone.tunnel = false;
    press(w, "B");
    answer(w, "B");
    w.doubt = false;
    w.bank = "Меня не беспокоили.";
  }, {
    sql: true, focus: ["phone", "B", "keys", "bank", "sql"],
    voice: "Ира повторяет с тем же ключом, и запрос снова приходит на под B. Вставка упирается в уже существующий ключ, тогда под читает строку и видит статус готово. В банк он не идёт, а просто отдаёт сохранённый ответ «оплачено». Этот приём называют replay: повтор получает записанный результат, а не новое выполнение. И раз строка лежит в общей базе, а не в памяти пода, неважно, на какой под попал повтор.",
  });
  // Повтор, пока первый у банка: строка processing — «ещё в работе».
  d.scene(ACT.answer, (() => {
    const w = world();
    w.keyCols = ["key", "status"];
    w.phone.key = KEY.first;
    return w;
  })(), { replay: true });
  d.shot("", (w) => {
    press(w, "A");
    claim(w, "A");
    callBank(w, "A");
    timeout(w);
    w.phone.thought = null;
    w.sql = [];
    press(w, "B");
    answer(w, "B");
  }, {
    sql: true, focus: ["phone", "A", "B", "keys"],
    voice: "Но внимательный инженер спросит: а если повтор придёт, пока первый запрос ещё ждёт банк? Тогда в строке статус «в работе», и под B так и отвечает: «ещё в работе», код 409. Это не отказ, а честное «подождите», и списания он не трогает.",
  });
  d.shot("", (w) => {
    charge(w, "A", null);
    settle(w, "A");
    w.sql = [];
    press(w, "B");
    answer(w, "B");
    w.doubt = false;
    w.db = "Починили? Ну-ну.";
  }, {
    verdict: ["green", "green"], focus: ["phone", "A", "B", "keys", "board", "db"],
    voice: "Что делает приложение? Выждав паузу, оно повторяет с тем же ключом. Под A к этому времени уже записал платёж и закрыл ключ, поэтому повтор получает сохранённое «оплачено». Одно списание и честный ответ: оба условия выполнены. Неужели починили?",
  });

  // КЕЙС 2: не зависает / одно списание.
  d.scene(ACT.case2);
  d.chapter(2, ["не зависает", "одно списание"]);
  d.shot("", (w) => {
    w.plate = "Кейс 2 из 2\nПод упал посреди оплаты.\nЧто ответить повтору?";
  }, {
    hold: 2.5,
    voice: "Рано радоваться. Мы ни разу не проверили, что будет, если под упадёт посреди оплаты. Теперь следим за другим: чтобы оплата не зависала навсегда и чтобы списание по-прежнему оставалось одно.",
  });

  // 2.1 Под A упал после банка: ключ processing навсегда.
  const midPay = (lease: boolean) => {
    const w = world();
    w.keyCols = lease ? ["key", "status", "lease"] : ["key", "status"];
    w.clockShown = lease;
    w.clock = lease ? 12 * 3600 : 0;
    w.phone.key = KEY.first;
    return w;
  };
  d.scene(ACT.stuck, midPay(false));
  d.attempt("как есть");
  d.shot("", (w) => {
    press(w, "A");
    claim(w, "A");
    charge(w, "A", null);
    crash(w, "A");
    w.phone.screen = "spin";
    w.doubt = true;
  }, {
    sql: true, focus: ["A", "keys", "bank", "payments"],
    voice: "И вот посреди оплаты под A падает: его убивает OOM Killer. Ключ он занять успел, в банк сходить тоже, деньги списаны, а вот записать ответ не успел. Откатывать нечего: ключ закоммичен ещё до похода в банк, а списание в банке наша база откатить не может. В таблице платежей пусто, а ключ так и остался в статусе «в работе».",
  });
  d.shot("", (w) => {
    press(w, "B");
    answer(w, "B");
    w.db = "Он всё ещё в работе.";
  }, {
    verdict: ["red", "green"], focus: ["phone", "B", "keys", "board", "db"],
    voice: "Ира повторяет с тем же ключом, но под B видит статус «в работе» и отвечает 409. Через пару секунд всё то же самое, и ещё раз, и ещё. Закрыть ключ некому, поэтому оплата висит вечно, а Ира так и ждёт ответа, которого не будет. Зато второго списания хотя бы нет.",
  });

  // 2.2 Срок захвата: перехват брошенного ключа — снова банк.
  d.scene(ACT.lease, midPay(true));
  d.attempt("срок захвата");
  d.term("Lease");
  d.shot("", (w) => {
    press(w, "A");
    claim(w, "A", true);
    charge(w, "A", null);
    crash(w, "A");
    w.phone.screen = "spin";
    w.doubt = true;
  }, {
    focus: ["A", "keys", "bank"],
    voice: "Похожую беду мы уже чинили в ролике про конкурентную обработку задач: у захвата должен быть срок, lease. Добавим ключу колонку locked_until: при захвате ключ сразу получает срок, тридцать секунд. Если за это время владелец ключ не закрыл, его считают брошенным, и следующий повтор может его забрать.",
  });
  d.shot("", (w) => {
    advance(w, 31);
    press(w, "B");
    sql(w, "B", SQL.take(KEY.first));
    takeOver(w, "B", KEY.first);
    w.actors.B.thought = THINK.expired;
    charge(w, "B", null);
  }, {
    sql: true, verdict: ["green", "red"], focus: ["B", "keys", "bank", "board"],
    voice: "Проходит полминуты, Ира повторяет, и под B забирает брошенный ключ. Ответа в строке нет, значит, и списания не было, рассуждает он и идёт в банк. Тот же вывод, что сделала Ира: нет ответа, значит, не прошло. Но списание было! Банк списывает второй раз: в таблице ключей одна строка, а в банке два списания.",
  });
  const leaseDouble = structuredClone(d.w);
  d.shot("", (w) => {
    w.actors.B.crossed = w.actors.B.thought;
    w.actors.B.thought = null;
    w.db = "Списаний я не вижу.";
  }, {
    focus: ["B", "bank", "db"],
    voice: "В чём же ошибка? Под судил о списании по своей таблице, а правду знает только банк. Срок сделал повтор возможным, но безопасным не сделал, а живой, но медленный под и вовсе можно принять за мёртвого. Спросить банк перед повтором тоже можно, это называется сверкой. Только пока первый вызов ещё в пути, банк честно ответит «не списано», и мы снова получим check-then-act.",
  });

  // 2.3 ⟲ Тот же ключ — в банк: банк возвращает прежний результат.
  // Тот же старт, что в 2.2, только под A ходил в банк с ключом попытки: банк его запомнил.
  const keyedCrash = midPay(true);
  request(keyedCrash, "A");
  claimKey(keyedCrash, "A", KEY.first, true);
  charge(keyedCrash, "A", KEY.first);
  crash(keyedCrash, "A");
  Object.assign(keyedCrash.phone, { screen: "spin" });
  keyedCrash.doubt = true;
  d.scene(ACT.e2e, keyedCrash, { replay: true });
  d.attempt("ключ и в банк");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: срок вышел";
    advance(w, 31);
    press(w, "B");
    takeOver(w, "B", KEY.first);
  }, {
    focus: ["B", "keys", "phone"],
    voice: "Перемотаем к моменту, когда срок вышел и под B забрал ключ. Но теперь каждый под передаёт банку тот самый ключ, с которым пришёл запрос Иры, и под A успел отправить его вместе со списанием ещё до падения. Платёжные API принимают такой ключ в заголовке запроса, точно так же, как мы принимаем его от приложения.",
  });
  d.term("End-to-end idempotency");
  d.shot("", (w) => {
    charge(w, "B", KEY.first);
    settle(w, "B");
    w.sql = [];
    reply(w, "B", "оплачено", "ok", "paid");
    w.doubt = false;
    w.bank = "Этот ключ я помню.";
  }, {
    verdict: ["green", "green"], focus: ["B", "bank", "phone", "board"],
    voice: "Под B идёт в банк, а тот узнаёт ключ, второй раз не списывает и возвращает прежний результат. Это сквозная идемпотентность, end-to-end idempotency: ключ защищает всю цепочку до банка. Под B записывает платёж, закрывает ключ и отвечает Ире «оплачено». Наша таблица ключей при этом не лишняя: обычный повтор она гасит сама, без похода в банк. Правда, банк помнит ключ не вечно, обычно сутки, так что повтор безопасен только в этом окне.",
  });
  const e2eEnd = structuredClone(d.w);

  // Вспомним Почту: кадр 01 его же отрисовкой.
  d.chapter(null);
  d.scene(ACT.recall);
  d.shot("", (w) => {
    w.flashback = RECALL;
    w.stamp = "⟲ Вспомним: очередь задач";
  }, {
    voice: "Помните Почту из ролика про конкурентную обработку задач? Там письмо ушло дважды, и дубль погасила сама Почта: увидела знакомый ключ и ответила «уже отправлено». Здесь то же самое: мы гасим повторы от приложения, но необратимое действие делает банк. Поэтому ключ должен дойти по цепочке до него, иначе защита закончится на нашей стороне.",
  });

  // Итог — повтором уже виденных сцен.
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B"] as const) {
        x.actors[id].acts = structuredClone(saved.actors[id].acts);
        x.actors[id].crossed = saved.actors[id].crossed;
      }
      x.db = null;
      x.bank = saved.bank;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
    }, { voice });
  };
  recap(hookEnd, "Подведём итог. Ответ потерялся в туннеле, Ира нажала «Повторить», и без ключа под B, ничего не подозревая, честно списал деньги ещё раз.");
  recap(leaseDouble, "Потом мы добавили ключ попытки и сохранённый ответ, и повторы стали безопасными, пока поды живы. Но стоило поду упасть на полпути, как срок захвата истёк, второй под забрал ключ и снова отправил деньги в банк.");
  recap(e2eEnd, "Выручил тот же ключ, который мы передали и банку: повторный вызов вернул прежний результат и ничего не списал. Кроссовки оплачены один раз, как Ира и хотела.");

  return d.steps;
}
