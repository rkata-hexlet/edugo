import type { Step } from "../../engine/contract";
import type { Code } from "../../kit/code";
import { Director } from "../../kit/director";
import {
  book, capture, charge, claim, crash, hold, insert, log, logged, nextStep, openLog, press, refund, release, reply, settle, skip,
  spawn, world, type Focus, type PodId, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/12-saga.md (сценарий v0) и раскадровкой v1 со слияниями
// (docs/reviews/12-scriptwriter-arc.md: 15 → 13, 20 → 19). MVP: все акты подряд серыми фигурами, без полировки.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  case1: "Кейс 1",
  asIs: "1.1 Как есть",
  compensate: "1.2 Компенсация",
  tcc: "1.3 Холд → бронь → списание",
  case2: "Кейс 2",
  memory: "2.1 Сага в горутине",
  journal: "2.2 Журнал в Postgres",
  keyed: "2.3 Ключ в каждом шаге",
  summary: "Итог",
} as const;

/** Исключения произношения для синтеза; экран и субтитр не меняются. */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
  pending: "пэндинг",
  confirmed: "конфёрмд",
  cancelled: "кэнсэлд",
  SIGTERM: "сигтёрм",
  Kubernetes: "кубернетис",
};

/** Код брони в лоб: четыре шага сверху вниз. */
export const CODE_NAIVE: Code = {
  title: "Бронь · Go",
  lines: [
    "db.Exec(`INSERT INTO bookings … 'pending'`)",
    "gateway.Charge(ctx, card, 12400)",
    "supplier.Book(ctx, room)",
    "db.Exec(`UPDATE bookings SET status = 'confirmed' …`)",
  ],
  mark: [],
};

/** Отказ поставщика — возвращаем деньги и помечаем строку. */
export const CODE_REFUND: Code = {
  title: "Бронь · Go",
  lines: [
    "db.Exec(`INSERT INTO bookings … 'pending'`)",
    "pay, _ := gateway.Charge(ctx, card, 12400)",
    "if err := supplier.Book(ctx, room); err != nil {",
    "    gateway.Refund(ctx, pay)",
    "    db.Exec(`UPDATE bookings SET status = 'cancelled' …`)",
    "}",
  ],
  mark: [{ line: 2, tone: "warn", note: "нет мест" }, { line: 3, tone: "ok", note: "возврат" }],
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
    w.gateway.say = null;
    w.supplier.say = null;
    w.guest.pressed = false;
    w.guest.thought = null;
    w.code = null;
    w.chain = null;
    w.fork = null;
    w.split = false;
  }

  protected override finish(w: World): void {
    w.replay = this.replaying;
  }
}

/** Мир брони; `free` — свободных номеров у поставщика. Подготовка до кадра — без событий. */
function hotel(free = 3, prep: (w: World) => void = () => {}, keyed = false): World {
  const w = world();
  w.supplier.free = free;
  w.keyed = keyed;
  prep(w);
  for (const p of Object.values(w.pods)) p.acts = [];
  w.guest.pressed = false;
  w.events = [];
  return w;
}

/** Деньги ушли, номера нет: строка, списание, отказ поставщика. */
function failed(w: World): void {
  press(w);
  insert(w, "A");
  charge(w, "A");
  book(w, "A");
}

/** Сага по журналу дошла до брони у поставщика: строка и холд записаны, ведёт `by`. */
function upToBooking(w: World, by: PodId): void {
  press(w);
  openLog(w, by);
  logged(w, by, "старт", () => insert(w, by));
  logged(w, by, "холд", () => hold(w, by));
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: последствие, наша база, шлюз, поставщик, код из четырёх шагов, норма.
  d.scene(ACT.intro, hotel(0, (w) => {
    failed(w);
    reply(w, "A", false);
  }));
  d.shot("", () => {}, {
    focus: ["guest"],
    voice: "Это сервис бронирования отеля. Гость выбирает номер на две ночи, нажимает «Забронировать», платит двенадцать тысяч четыреста рублей и ждёт подтверждения. Но вот деньги у него списаны, а номера нет. И никто ничего не ломал! Чтобы понять, как так вышло, заглянем внутрь: гость слева, поды посередине, а справа два внешних сервиса, до которых нам не дотянуться.",
  });
  d.scene(ACT.intro, hotel(3, (w) => (w.unseen = ["gateway", "supplier"])));
  d.shot("", (w) => {
    press(w);
    insert(w, "A");
    w.db = "Моё дело записать.";
  }, {
    focus: ["guest", "A", "db"],
    voice: "Начнём с нашей половины. Гость выбирает номер, запрос обрабатывает под, а брони лежат в Postgres, в таблице со статусами. Статус pending значит «оформляется»: строка уже есть, но бронь ещё не подтверждена, и наш код её пока не трогает.",
  });
  d.shot("", (w) => {
    w.unseen = ["supplier"];
    w.gateway.say = "Деньги принял.";
  }, {
    focus: ["gateway"],
    voice: "Деньги принимаем не мы, а платёжный шлюз: это внешний сервис со своей базой. Что у него внутри, мы не видим, мы только отправляем запросы и получаем ответы.",
  });
  d.shot("", (w) => {
    w.unseen = [];
  }, {
    focus: ["supplier"],
    voice: "А сами номера принадлежат поставщику. У него свой склад комнат и своя система: мы просим номер, он заводит у себя бронь, например R-1042, и отвечает «ок». Так что одна бронь живёт сразу в трёх местах, и каждое хранит своё.",
  });
  d.shot("", (w) => {
    w.code = CODE_NAIVE;
  }, {
    focus: ["code"],
    voice: "Код брони читается сверху вниз. Сначала записываем у себя строку pending, потом просим шлюз списать деньги, потом бронируем номер у поставщика, и только после этого ставим статус confirmed. Каждый из трёх вызовов уходит в другое место.",
  });
  d.shot("", (w) => {
    charge(w, "A");
    book(w, "A");
    settle(w, "A", "confirmed");
    w.db = "Подтверждено.";
  }, {
    focus: ["guest", "A", "db", "gateway", "supplier"],
    voice: "Пока все отвечают «ок», вопросов нет: гость получает письмо, в выписке одна строка, в базе confirmed. Для такого счастливого дня этого кода хватает.",
  });

  // Хук: последний номер продали — деньги ушли, брони нет; почему не одна транзакция на троих.
  d.scene(ACT.hook, hotel(0));
  d.shot("", (w) => {
    failed(w);
    w.supplier.say = "Свободных нет.";
  }, {
    focus: ["A", "db", "gateway", "supplier"],
    voice: "Но вот гость выбирал номер дольше обычного, и последний номер успели продать. Под честно проходит первые два шага: строка у нас записана, деньги у шлюза списаны. А когда он доходит до поставщика, тот отвечает «нет мест».",
  });
  d.shot("", (w) => {
    reply(w, "A", false);
    w.guest.thought = "Деньги списали, а брони нет?!";
  }, {
    focus: ["guest", "A", "db"],
    voice: "Под возвращает гостю ошибку, и на этом всё. Гость смотрит в банковское приложение: деньги ушли. Смотрит на сайт: брони нет. А строка у нас так и висит в pending, потому что дописывать её некому.",
  });
  const robbed = structuredClone(d.w);
  d.shot("", (w) => {
    w.split = true;
    w.events.push({ kind: "split" });
  }, {
    focus: ["db", "gateway", "supplier"],
    voice: "Казалось бы, давайте сделаем одну транзакцию на троих: пусть пройдёт целиком или не пройдёт вовсе. Но шлюз и поставщик — обычные запросы по HTTP, а не участники двухфазного коммита, two-phase commit. Режима «подготовься и жди команды» у них нет: любой вызов сразу делает дело. Значит, общей транзакции у нас не будет.",
  });

  // КЕЙС 1 — номера нет, а деньги ушли.
  d.scene(ACT.case1);
  d.chapter(1, ["при своих", "без возврата"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nНомера нет, а деньги ушли";
  }, { hold: 2.5, voice: "Кейс первый: номера нет, а деньги ушли." });

  d.scene(ACT.asIs, hotel(0, failed));
  d.attempt("как есть");
  d.shot("", (w) => {
    reply(w, "A", false);
  }, {
    verdict: ["red", "green"], focus: ["guest", "gateway", "board"],
    voice: "Вернёмся к гостю из начала. Пока он выбирал, последний номер продали: строка у нас висит в pending, деньги шлюз уже списал, а поставщик ответил «нет мест». Под получил отказ, и теперь ему решать, что делать с уже сделанными шагами. Самый простой вариант — оставить как есть. Смотрим на два вопроса: остались ли деньги у гостя и пришлось ли нам что-то возвращать. Деньги у нас, гость без номера, а возвращать, как ни странно, нечего. Для поддержки это самый частый тикет.",
  });

  d.scene(ACT.compensate, hotel(0, (w) => {
    press(w);
    insert(w, "A");
    charge(w, "A");
  }));
  d.attempt("компенсация");
  d.shot("", (w) => {
    book(w, "A");
    w.code = CODE_REFUND;
  }, {
    focus: ["code"],
    voice: "Значит, исправим сами. Если поставщик отказал, под должен вернуть деньги: ловим ошибку, вызываем возврат у шлюза и помечаем нашу строку как cancelled.",
  });
  d.term("Compensating transaction");
  d.shot("", (w) => {
    refund(w, "A");
    settle(w, "A", "cancelled");
  }, {
    verdict: ["green", "red"], focus: ["guest", "A", "gateway", "db", "board"],
    voice: "Посмотрим на выписку гостя. Там теперь две строки: списание и возврат. Заметьте, мы не стёрли списание, как будто его не было: оно было, гость его видел. Это не откат, а новое действие вперёд, обратное по смыслу. Такое действие называют compensating transaction, компенсирующая транзакция. Но у исправления есть цена. Возврат идёт на карту гостя от пяти до десяти рабочих дней, комиссию за исходный платёж никто не возвращает, а в выписке навсегда остаются обе строки. Гость при своих, но нервы потрачены.",
  });
  const twoLines = structuredClone(d.w);
  d.term("Saga");
  d.shot("", (w) => {
    w.chain = "pairs";
  }, {
    focus: ["chain"],
    voice: "Получается, у каждого шага есть свой обратный шаг. Если что-то сломалось, мы выполняем обратные шаги для уже сделанных, по порядку с конца. Такую цепочку называют сага, saga. Это не транзакция: мгновенно и незаметно ничего не отменится. Но сага обещает, что в итоге мы придём либо к «всё сделано», либо к «всё исправлено».",
  });

  d.scene(ACT.tcc, hotel(0));
  d.attempt("холд → бронь → списание");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: сначала холд";
    press(w);
    insert(w, "A");
    hold(w, "A");
    w.guest.thought = "Заморозили… ну ладно";
  }, {
    focus: ["guest", "A", "gateway"],
    voice: "Давайте спросим иначе: а зачем мы вообще списывали деньги, пока не знали, есть ли номер? Платёжные системы умеют по-другому: сначала холд, hold. Деньги на карте гостя замораживаются, но к нам не уходят. Шаги теперь такие: строка pending, холд, бронь у поставщика.",
  });
  d.shot("", (w) => {
    book(w, "A");
    release(w, "A");
    settle(w, "A", "cancelled");
    w.supplier.say = "Свободных нет.";
  }, {
    verdict: ["green", "green"], focus: ["guest", "A", "gateway", "supplier", "db", "board"],
    voice: "Поставщик снова отвечает «нет мест». Что делаем? Просто снимаем холд: деньги к нам не уходили, поэтому возвращать нечего и в выписке нет лишних строк. Остаётся пометить нашу строку cancelled.",
  });
  d.scene(ACT.tcc, hotel(1));
  d.term("Try-Confirm-Cancel");
  d.shot("", (w) => {
    press(w);
    insert(w, "A");
    hold(w, "A");
    book(w, "A");
    capture(w, "A");
    settle(w, "A", "confirmed");
  }, {
    focus: ["guest", "A", "gateway", "supplier", "db"],
    voice: "А если номер есть, бронь у поставщика проходит, и только после этого мы подтверждаем холд, то есть списываем деньги, capture. Этот приём называется Try-Confirm-Cancel: сначала резервируем, Try, потом подтверждаем, Confirm, а если не вышло, снимаем резерв, Cancel.",
  });
  const tcc = structuredClone(d.w);
  d.shot("", (w) => {
    w.chain = "pivot";
    w.gateway.say = "Холд держу до 7 дней.";
    w.supplier.say = "Холд не умеем.";
  }, {
    focus: ["chain", "gateway", "supplier"],
    voice: "Заметьте порядок. Сначала идёт то, что легко отменить: наша строка и холд. Посередине стоит шаг, который может отказать, — бронь у поставщика. А необратимое, списание, мы поставили в самый конец. Шаг, после которого пути назад нет, называют pivot, точка невозврата. Всё, что после него, мы только повторяем, пока не пройдёт. Но бесплатных обедов не бывает. Пока холд не подтверждён и не снят, деньги гостя заморожены, и это видно в его банковском приложении: до семи дней. К тому же холд умеет шлюз, а поставщик номеров его не умеет, поэтому его шаг нам по-прежнему приходится исправлять обычной компенсацией.",
  });

  // КЕЙС 2 — под упал посреди брони.
  d.scene(ACT.case2);
  d.chapter(2, ["дошла до конца", "одна бронь"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nПод упал посреди брони";
  }, { hold: 2.5, voice: "Кейс второй: под упал посреди брони." });

  d.scene(ACT.memory, hotel(3, (w) => spawn(w, "A")));
  d.attempt("сага в горутине");
  d.shot("", (w) => {
    press(w);
    insert(w, "A");
    w.db = "Я только строка.";
  }, {
    focus: ["A", "db"],
    voice: "Теперь номер есть, и бронь идёт в правильном порядке: строка pending, холд, бронь у поставщика, списание. Это четыре запроса подряд в разные места, и вся бронь занимает секунды. Кто-то должен вести эти шаги от первого до последнего. Пока это обычная горутина внутри пода: она идёт по шагам, а что уже сделано, помнит только в своей памяти.",
  });
  d.shot("", (w) => {
    hold(w, "A");
    book(w, "A");
    crash(w, "A");
  }, {
    verdict: ["red", "green"], focus: ["A", "guest", "gateway", "supplier", "db", "board"],
    voice: "И вот под а успевает создать строку, заморозить деньги, забронировать номер... и тут Kubernetes выкатывает новую версию и шлёт ему SIGTERM! Горутина исчезает вместе с подом, а память о шагах пропадает вместе с ней. Холд висит, у поставщика бронь, у нас вечный pending. Шлюз снимет холд сам, но через неделю: всё это время номер занят, а гость без денег.",
  });

  d.scene(ACT.journal, hotel(3));
  d.attempt("журнал в Postgres");
  d.term("Saga log");
  d.shot("", (w) => {
    press(w);
    openLog(w, "A");
    logged(w, "A", "старт", () => insert(w, "A"));
  }, {
    focus: ["A", "db", "log"],
    voice: "Значит, помнить нужно там, где память переживёт под. Заведём в нашей базе журнал саги, saga log. Перед каждым шагом записываем, что собираемся делать, а после — чем всё закончилось. Журнал лежит в Postgres, рядом с бронями.",
  });
  d.shot("", (w) => {
    logged(w, "A", "холд", () => hold(w, "A"));
    logged(w, "A", "бронь", () => book(w, "A"), true);
    claim(w, "B");
    skip(w, "C");
    logged(w, "B", nextStep(w)!, () => book(w, "B"));
    logged(w, "B", "списание", () => capture(w, "B"));
    settle(w, "B", "confirmed");
  }, {
    verdict: ["green", null], focus: ["A", "B", "C", "log", "board"],
    voice: "Теперь другой под раз в несколько секунд ищет саги, которые давно не двигались. Находит строку пода а и берёт её себе. Чтобы две копии не вели одну сагу, строку захватывает ровно один: занятые остальные пропускают, это тот же FOR UPDATE SKIP LOCKED. Обратите внимание, что помнит сагу не какой-то особый оркестратор, а обычная строка в базе, а шаги ведёт наш же код. Такой подход называют orchestration.",
  });
  const pickedUp = structuredClone(d.w);
  d.shot("", (w) => {
    w.supplier.say = "Ещё одна? Пожалуйста.";
  }, {
    verdict: [null, "red"], focus: ["log", "supplier", "board"],
    voice: "Но тут подвох. Под а успел забронировать номер у поставщика, но умер раньше, чем записал об этом в журнал. Журнал честно говорит, что брони ещё нет, и под бэ повторяет шаг. Теперь у поставщика две брони, R-1042 и R-1043, а нужна одна. Записать в журнал и позвонить поставщику — два разных действия, и умереть можно ровно между ними.",
  });

  d.scene(ACT.keyed, hotel(3, () => {}, true));
  d.attempt("ключ в каждом шаге");
  d.term("Idempotency key");
  d.shot("", (w) => {
    upToBooking(w, "A");
    logged(w, "A", "бронь", () => book(w, "A"), true);
    claim(w, "B");
    logged(w, "B", nextStep(w)!, () => book(w, "B"));
    logged(w, "B", "списание", () => capture(w, "B"));
    settle(w, "B", "confirmed");
    w.supplier.say = "Уже есть: R-1042";
  }, {
    verdict: ["green", "green"], focus: ["B", "supplier", "gateway", "log", "board"],
    voice: "Чтобы повтор не создавал дубль, кладём в каждый запрос ключ — наш номер брони, H-7731. Поставщик, который умеет узнавать повтор по номеру, видит, что такая бронь уже есть, и просто возвращает её, а не заводит вторую. Так же и шлюз: повторный запрос на холд, списание или возврат с тем же ключом ничего не меняет. И в этом нет ничего нового для компенсаций: те же ключи идут и в них.",
  });
  const keyed = structuredClone(d.w);

  d.scene(ACT.keyed, hotel(3, (w) => upToBooking(w, "B"), true));
  d.shot("", (w) => {
    w.supplier.slow = true;
    log(w, "B", "бронь", false);
    book(w, "B");
    book(w, "B");
    log(w, "B", "бронь", true);
    w.fork = "forward";
    w.guest.thought = "Ну что там?";
  }, {
    focus: ["B", "supplier", "fork"],
    voice: "Осталось понять, что делает под бэ, когда шаг споткнулся. Допустим, поставщик не ответил за три секунды. Это не значит, что брони нет: она могла создаться за мгновение до таймаута. Исход неизвестен, и такие временные сбои, будь то таймаут, ошибка сервера или «слишком много запросов», мы повторяем вперёд, с тем же ключом.",
  });
  d.scene(ACT.keyed, hotel(0, (w) => upToBooking(w, "B"), true));
  d.shot("", (w) => {
    log(w, "B", "бронь", false);
    book(w, "B");
    release(w, "B");
    settle(w, "B", "cancelled");
    w.fork = "fix";
    w.supplier.say = "Свободных нет.";
  }, {
    focus: ["B", "supplier", "gateway", "db", "fork"],
    voice: "Совсем другое дело, если ответ окончательный: «нет мест» или «карта отклонена». Повторять бессмысленно, и тогда включаем обратные шаги с конца: снимаем холд и помечаем строку cancelled. Если же шаг упал по таймауту и время ожидания вышло, отменяем и его, на всякий случай: «отмени бронь H-7731, если она есть».",
  });
  const fork = structuredClone(d.w);
  d.scene(ACT.keyed, hotel(0, (w) => {
    upToBooking(w, "B");
    log(w, "B", "бронь", false);
    book(w, "B");
    w.gateway.failNext = 2;
  }, true));
  d.shot("", (w) => {
    while (!release(w, "B"));
    settle(w, "B", "cancelled");
    w.fork = "retry";
  }, {
    focus: ["B", "gateway", "fork"],
    voice: "Но и исправление может споткнуться: шлюз не ответил или ответил ошибкой. Бросить сагу на полпути нельзя, иначе деньги гостя так и останутся замороженными, а номера у него нет. Поэтому исправление повторяем, пока не пройдёт, и тот же ключ защищает его от дублей. А если бронь уже сделана и мы дошли до списания, назад не идём вообще: списание повторяем вперёд, сколько потребуется. Если отменить совсем невозможно, дело передаём человеку из поддержки.",
  });

  // Итог — повтором уже виденных образов.
  d.chapter(null);
  const recap = (saved: World, voice: string, extra: (x: World) => void = () => {}) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      x.pods = structuredClone(saved.pods);
      x.guest = structuredClone(saved.guest);
      x.gateway.say = saved.gateway.say;
      x.supplier.say = saved.supplier.say;
      x.db = saved.db;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
      extra(x);
    }, { voice });
  };
  recap(robbed, "Помните гостя, у которого и деньги ушли, и номера нет? Так бывает, когда цепочка вызовов к разным сервисам идёт без плана на случай отказа.");
  recap(twoLines, "Первое лекарство — компенсация. В выписке остаются обе строки, списание и возврат: это не откат, а новое действие, и его следы видны.");
  recap(tcc, "Лучше всего, когда деньги вообще не уходят до подтверждения: холд, потом бронь, потом списание. Отменяемое ставим вперёд, необратимое в конец.", (x) => (x.chain = "pivot"));
  recap(pickedUp, "А когда под падает посреди брони, сагу ведёт не его память, а журнал в базе: другой под находит строку и продолжает.");
  recap(keyed, "Но продолжать надо осторожно. Без ключа повтор оставляет у поставщика две брони, а с нашим номером брони дубль не рождается.");
  recap(fork, "И при любой ошибке под выбирает: временную повторяем вперёд, окончательную исправляем компенсацией, а саму компенсацию повторяем, пока не пройдёт.", (x) => (x.fork = "fix"));
  return d.steps;
}
