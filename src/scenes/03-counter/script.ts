import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  ACTORS, HOT, WINDOW, batchKey, click, drain, flood, flush, kill, restart, shard, sigterm, spawn, stop, wait, world,
  type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/03-counter.md (сценарий v0, покадрово).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс 1",
  direct: "1.1 +1 на каждый клик",
  async: "1.2 go func()",
  sharded: "1.3 16 частей счётчика",
  batch: "1.4 Копим в поде",
  case2: "Кейс 2",
  deploy: "2.1 Деплой",
  graceful: "2.2 Graceful shutdown",
  retry: "2.3 Повтор сброса",
  keyed: "2.4 Ключ пачки",
  summary: "Итог",
} as const;

const SQL = {
  add: `UPDATE link_stats SET clicks = clicks + 1\n  WHERE code = '${HOT}'`,
  schemaBefore: "CREATE TABLE link_stats (\n  code text PRIMARY KEY, clicks bigint)",
  schema: "CREATE TABLE link_stats (\n  code text, part int, clicks bigint,\n  PRIMARY KEY (code, part))",
  shard: (i: number) => `UPDATE link_stats SET clicks = clicks + 1\n  WHERE code = '${HOT}' AND part = ${i}`,
  sum: `SELECT sum(clicks) FROM link_stats\n  WHERE code = '${HOT}'`,
  batch: (n: number) => `UPDATE link_stats SET clicks = clicks + ${n}\n  WHERE code = '${HOT}'`,
  keyed: (pod: ActorId, seq: number, n: number) =>
    `WITH f AS (\n  INSERT INTO flushes VALUES ('${pod}', ${seq})\n  ON CONFLICT DO NOTHING RETURNING 1)\n` +
    `UPDATE link_stats SET clicks = clicks + ${n}\n  WHERE code = '${HOT}'\n    AND EXISTS (SELECT FROM f)`,
};

/** Исключения произношения для синтеза; экран и субтитр не меняются. Буквы подов — по-русски (решение серии). */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

/** Сверх общего: итог — повтор уже виденного; журнал прибавок — последние три; отсылка к 01 живёт один кадр. */
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
    w.flashback = null;
  }

  protected override finish(w: World): void {
    w.adds = w.adds.slice(-3); // в журнал прибавок влезают три строки
    w.replay = this.replaying;
  }
}

// --- Глаголы сценария: операции модели + запросы в SQL-панели. Поды не двигаются — двигаются стрелки. ---

function sql(w: World, who: ActorId, text: string): void {
  w.sql.push(`${w.actors[who].label} ▸ ${text}`);
}

function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
}

/** Мир кейса 2: копилки подов уже наполнены, часы идут, поток спокойный. */
function filled(): World {
  const w = world();
  w.mode = "batch";
  w.flow = 10_000;
  w.clock = 3;
  w.rows[0].clicks = w.clicked = 1_204_310;
  ([["A", 8_431], ["B", 8_390], ["C", 8_466]] as const).forEach(([id, n]) => click(w, id, n));
  w.events = [];
  for (const a of Object.values(w.actors)) a.acts = [];
  return w;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: система в покое — клик, +1 в строку, ответ браузеру.
  d.scene(ACT.intro);
  d.shot("", (w) => click(w, "A"), {
    focus: ["table", "row", "A", "B", "C", "browsers"],
    voice: "Перед нами сервис коротких ссылок. Когда человек кликает по ссылке, мы сначала увеличиваем счётчик в базе и только после этого редиректим его на целевой адрес, чтобы автор видел честную статистику переходов. Запросы принимают три пода нашего сервиса, а сами счётчики хранятся в Postgres — по одной строке на каждую ссылку.",
  });
  const calm = structuredClone(d.w);
  calm.adds = []; // журнал прибавок нормы начинается с её клика

  // Хук: все клики — +1 в одну строку, пулы подов забиты, чужие ссылки ждут соединения.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    flood(w, 10_000);
    for (const id of ACTORS) click(w, id, 40);
    w.db = "Считаю. Просто по одному.";
  }, { voice: "Всё работает отлично ровно до того момента, пока автор не выложит свою ссылку в крупный Telegram-канал. На сервис тут же обрушиваются тысячи кликов в секунду, и неожиданно ложится всё: перестают открываться даже остальные ссылки! При этом сама база в порядке, а каждый клик по этой ссылке всего лишь встаёт в одну и ту же очередь к единственной строке." });
  const hook = structuredClone(d.w);

  // Норма: +1 и COMMIT; два клика вместе — по одному.
  d.scene(ACT.norm, calm);
  d.shot("", (w) => {
    click(w, "A");
    sql(w, "A", SQL.add);
    sql(w, "A", "COMMIT");
  }, {
    sql: true, focus: ["A", "row", "sql", "adds"],
    voice: "Давайте разберёмся, почему так происходит, и начнём со штатного режима. Приходит клик, под A честно выполняет инкремент и фиксирует его через COMMIT. Счётчик идеален, данные точны.",
  });
  d.shot("", (w) => {
    wait(w, "B");
    click(w, "A");
    click(w, "B");
  }, {
    focus: ["A", "B", "row", "adds"],
    voice: "А теперь клики начинают приходить практически одновременно. Пока под A выполняет свой запрос, под B вынужден ждать. Как только под A делает COMMIT, база прибавляет единицу пода B уже к обновлённому значению. Данные не теряются, но база обрабатывает прибавки строго по очереди, по одной.",
  });

  // КЕЙС 1 — поток кликов.
  d.scene(ACT.case1);
  d.chapter(1, ["счёт точный", "база справляется"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nКликов тысячи в секунду. Как выдержать?";
  }, { hold: 2.5, voice: "А теперь представим, что поток вырастает до тысяч кликов в секунду, и начинается первый кейс. Задача у нас двойная: сохранить точность подсчёта и не завалить при этом базу." });

  // 1.1 +1 на каждый клик: очередь к строке, пул кончился.
  d.scene(ACT.direct, structuredClone(hook), { replay: true });
  d.attempt("+1 на каждый клик");
  d.shot("", (w) => {
    w.events.push({ kind: "overload" });
  }, {
    verdict: ["green", "red"], focus: ["row", "queue", "load", "board"],
    voice: "Начнём с самого очевидного решения: на каждый входящий клик отправляем отдельный UPDATE с прибавкой единицы. Счётчик остаётся точным, но очередь к нашей строке растёт с катастрофической скоростью.",
  });
  d.shot("", (w) => {
    w.flashback = { voice: "Поэтому B и C висят" };
  }, {
    voice: "Помните, как в ролике про очередь задач поды B и C висели в ожидании, пока под A не завершит транзакцию? Здесь происходит ровно то же самое, только ждут уже не два пода, а тысячи запросов.",
  });
  d.term("Hot row · lock contention");
  d.shot("", (w) => {
    w.db = "Остальные ссылки я бы открыл.";
  }, {
    focus: ["A", "B", "C", "pool", "queue", "browsers"],
    voice: "И вот главный подвох: каждый запрос, застрявший в ожидании строки, продолжает держать соединение из пула. Соединения быстро заканчиваются, и даже те, кто кликает по совсем другим ссылкам, просто не могут получить свободное соединение с базой! Это классическая горячая строка, hot row: из-за борьбы за блокировку, lock contention, запросы буквально дерутся за одну и ту же запись.",
  });
  const hotRowShot = structuredClone(d.w);

  // 1.2 go func(): ответ сразу, прибавки копятся в фоне у той же строки; рестарт их теряет.
  d.scene(ACT.async);
  d.attempt("go func()");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: не ждём ответа";
    w.mode = "async";
    for (const id of ACTORS) click(w, id, 12);
  }, {
    focus: ["A", "B", "C", "browsers"],
    voice: "Попробуем обхитрить систему и не заставлять пользователя ждать: вынесем запись в базу в фоновую горутину. Браузер моментально получает ответ, и на первый взгляд кажется, что проблема решена.",
  });
  d.term("Fire-and-forget");
  d.shot("", (w) => {
    flood(w, 10_000);
    ([["A", 3_120], ["B", 2_980], ["C", 3_050]] as const).forEach(([id, n]) => click(w, id, n));
    drain(w, "B", 1);
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "C", "pool", "queue", "board"],
    voice: "Но ведь сама строка в базе никуда не делась! Фоновые прибавки копятся в памяти подов, занимают всё те же соединения из пула и точно так же выстраиваются в затылок друг другу. Подход «выстрелил и забыл», fire-and-forget, просто перенёс ожидание в фон, а саму очередь к строке не убрал.",
  });
  d.shot("", (w) => {
    restart(w, "A");
    w.db = "Этих кликов я не видел.";
  }, {
    verdict: ["yellow", null], focus: ["A", "row", "browsers", "board"],
    voice: "И что ещё хуже: если под перезапустится, пока прибавки висят в памяти, они сгорят безвозвратно. Пользователю мы уже ответили, а в базе этот клик так и не появится.",
  });

  // 1.3 Sharded counter: очереди нет, но каждый клик — запись.
  d.scene(ACT.sharded);
  d.attempt("16 частей счётчика");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: 16 частей счётчика";
    w.sql.push(SQL.schemaBefore);
  }, {
    sql: true, focus: ["row", "table", "sql"],
    voice: "Ладно, попробуем решить это на стороне самой базы. Сейчас у каждой ссылки в таблице одна строка, а значит, и один замок на все её клики.",
  });
  d.shot("", (w) => {
    shard(w);
    w.events.push({ kind: "shard" });
    w.sql.push(SQL.schema);
  }, {
    sql: true, focus: ["row", "table", "sql"],
    voice: "Добавим в таблицу колонку part, номер части, и заведём нашей ссылке шестнадцать строк вместо одной. Таблица та же, база та же, просто счётчик ссылки разрезан на шестнадцать частей.",
  });
  d.shot("", (w) => {
    click(w, "A", 1, 2);
    click(w, "B", 1, 0);
    sql(w, "A", SQL.shard(2));
    sql(w, "B", SQL.shard(0));
  }, {
    sql: true, focus: ["A", "B", "row", "sql"],
    voice: "Теперь на каждый клик приложение выбирает случайную часть и прибавляет единицу только в неё. Замок встаёт на одну эту строку, а соседний клик, которому выпала другая часть, никого не ждёт. Был один замок на все клики, а стало шестнадцать!",
  });
  d.shot("", (w) => {
    flood(w, 10_000);
    for (const id of ACTORS) click(w, id, 40);
    sql(w, "C", SQL.sum);
  }, {
    sql: true, verdict: ["green", null], focus: ["A", "B", "C", "row", "sql", "board"],
    voice: "На каждую строку теперь приходится в шестнадцать раз меньше запросов, они почти не ждут друг друга, а общий счёт автор получает одной суммой по всем шестнадцати частям, как выручка магазина складывается из всех его касс. И точность при этом полностью сохраняется.",
  });
  d.term("Sharded counter");
  d.shot("", (w) => {
    for (const id of ACTORS) click(w, id, 40);
    w.db = "Очередь ушла, а работа нет.";
  }, {
    verdict: [null, "yellow"], focus: ["row", "load", "board"],
    voice: "Но одно не изменилось: каждый клик по-прежнему отдельный UPDATE и отдельный COMMIT, и их всё так же тысячи в секунду. Мы разнесли толпу по шестнадцати дверям, но людей меньше не стало. Такая схема называется шардированным счётчиком, sharded counter. Только не путайте его с шардированием базы: все шестнадцать частей лежат в той же таблице на том же сервере.",
  });
  const shardedShot = structuredClone(d.w);

  // 1.4 Копим в поде, сбрасываем пачкой раз в 5 с.
  d.scene(ACT.batch);
  d.attempt("копим, сброс раз в 5 с");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: считаем у себя";
    w.mode = "batch";
    flood(w, 10_000);
    ([["A", 2_104], ["B", 2_087], ["C", 2_121]] as const).forEach(([id, n]) => click(w, id, n));
  }, {
    focus: ["A", "B", "C", "jar", "browsers", "clock"],
    voice: "Зайдём с другой стороны: базе на самом деле вообще не нужно знать про каждый отдельный клик. Пусть под копит счётчик у себя в памяти, а пользователю отвечает сразу.",
  });
  d.shot("", (w) => {
    setClock(w, WINDOW);
    ([["A", 6_327], ["B", 6_303], ["C", 6_345]] as const).forEach(([id, n]) => click(w, id, n));
    flush(w, "A");
    sql(w, "A", SQL.batch(8_431));
    w.events.push({ kind: "calm" });
    w.db = "Ого. Тишина.";
  }, {
    sql: true, focus: ["A", "row", "jar", "load", "clock", "sql"],
    voice: "И раз в пять секунд под относит в базу всё, что успел накопить, одним суммарным запросом, например сразу плюс восемь тысяч четыреста тридцать один. В итоге вместо тысяч UPDATE в секунду горячая строка получает по одной прибавке от каждого пода раз в пять секунд! Очередь испаряется, соединения свободны, и остальные ссылки снова летают.",
  });
  const batchShot = structuredClone(d.w);
  d.term("Write batching");
  d.shot("", undefined, {
    verdict: ["yellow", "green"], focus: ["row", "jar", "browsers", "board"],
    voice: "Правда, за это приходится платить. Первая цена очевидна: цифра в базе отстаёт от реальности на окно сброса, в нашем случае до пяти секунд. Для счётчика кликов это вполне приемлемый компромисс. Такой приём называется пакетной записью, write batching. Но есть и вторая цена: пока клики лежат внутри пода, они существуют только в его оперативной памяти.",
  });

  // КЕЙС 2 — под гаснет с полной копилкой.
  d.scene(ACT.case2);
  d.chapter(2, ["не теряем", "не считаем дважды"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nПод погас. Что с кликами?";
  }, { hold: 2.5, voice: "И вот мы подходим к самому неприятному сценарию: пачка кликов лежит в памяти пода, а поды в Kubernetes не вечны и регулярно перезапускаются. Что станет с накопленным?" });

  // 2.1 Деплой без мягкой остановки: каждый под уносит свою копилку.
  const start = filled();
  d.scene(ACT.deploy, structuredClone(start));
  d.attempt("просто копим, деплой");
  d.shot("", (w) => {
    for (const id of ACTORS) stop(w, id);
  }, {
    focus: ["A", "B", "C", "jar"],
    voice: "Представим обычный деплой новой версии сервиса. Поды по очереди останавливаются, и на их месте поднимаются новые. Это совершенно штатная ситуация, так бывает каждый день.",
  });
  d.shot("", (w) => {
    for (const id of ACTORS) spawn(w, id);
    w.db = "У меня всё сходится.";
  }, {
    verdict: ["red", "green"], focus: ["A", "B", "C", "row", "browsers", "board"],
    voice: "Но если под гаснет прямо сейчас, он уносит в могилу всё, что успел накопить за последние секунды! Получается, на каждом релизе мы теряем куски статистики.",
  });

  // 2.2 Graceful shutdown: SIGTERM → сброс → гаснет.
  d.scene(ACT.graceful, structuredClone(start), { replay: true });
  d.attempt("graceful shutdown");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: гасим вежливо";
    sigterm(w, "A");
    flush(w, "A");
    sql(w, "A", SQL.batch(8_431));
  }, {
    sql: true, focus: ["A", "row", "jar", "sql"],
    voice: "Чтобы этого избежать, воспользуемся тем, что умеет сама платформа. Перед остановкой Kubernetes отправляет поду сигнал SIGTERM. Под перехватывает его, перестаёт принимать новые клики, сбрасывает накопленную пачку в базу и только после этого завершает работу.",
  });
  d.term("Graceful shutdown");
  d.shot("", (w) => {
    stop(w, "A");
    for (const id of ["B", "C"] as const) {
      sigterm(w, id);
      flush(w, id);
      stop(w, id);
    }
    for (const id of ACTORS) spawn(w, id);
  }, {
    verdict: ["yellow", "green"], focus: ["A", "B", "C", "row", "browsers", "board"],
    voice: "Так же отрабатывают поды B и C, поэтому при деплое мы теперь ничего не теряем: каждый под успевает сохранить свою пачку. Это и есть мягкая остановка, graceful shutdown.",
  });

  // 2.3 Сброс оборвался — повторяем: пачка прибавилась дважды.
  d.scene(ACT.retry, structuredClone(start), { replay: true });
  d.attempt("повтор сброса");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: сеть моргнула";
    sigterm(w, "A");
    flush(w, "A", { lostReply: true });
  }, {
    focus: ["A", "row", "adds"],
    voice: "Но давайте усложним жизнь нашему сервису. Под A отправляет последнюю пачку, и прямо в этот момент случается сетевой сбой. База успешно выполнила запрос и зафиксировала данные, а ответ до пода так и не дошёл.",
  });
  d.term("At-least-once");
  d.shot("", (w) => {
    flush(w, "A");
    w.db = "Ещё +8431? Записал.";
  }, {
    verdict: ["green", "red"], focus: ["A", "row", "adds", "browsers", "board"],
    voice: "Под со своей стороны не знает, что произошло: то ли запрос не дошёл до базы, то ли потерялся ответ. Терять клики не хочется, поэтому под отправляет пачку повторно. В результате одна и та же пачка прибавляется дважды, и счётчик начинает безбожно врать в большую сторону! Так проявляется гарантия «хотя бы один раз», at-least-once: пачка дойдёт, но, возможно, не один раз.",
  });
  d.shot("", (w) => {
    w.flashback = { voice: "Теперь оба письма уходят" };
  }, {
    voice: "В ролике про очередь задач повторные письма отсекал сервис почты по ключу идемпотентности. Но здесь внешнего сервиса нет: получатель — сама база, а значит, и проверять дубликаты придётся ей.",
  });

  // 2.4 Ключ пачки в той же транзакции: повтор база узнаёт.
  const keyed = structuredClone(start);
  keyed.keyed = true;
  d.scene(ACT.keyed, keyed, { replay: true });
  d.attempt("ключ пачки");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: до сброса";
  }, {
    focus: ["A", "jar", "flushes"],
    voice: "Отмотаем назад, до сброса, и дадим каждой пачке уникальный номер: например, пачка семнадцать от пода A.",
  });
  d.shot("", (w) => {
    sigterm(w, "A");
    const [pod, seq] = batchKey(w, "A").split(" · ");
    flush(w, "A", { lostReply: true });
    sql(w, "A", SQL.keyed(pod as ActorId, Number(seq), 8_431));
  }, {
    sql: true, focus: ["A", "row", "flushes", "sql"],
    voice: "Этот номер мы записываем в служебную таблицу в той же транзакции, где делаем прибавку к счётчику. Прибавка сработает, только если такого номера в базе ещё не было, а транзакция либо выполнится целиком, либо не выполнится вообще.",
  });
  d.term("Idempotent flush");
  d.shot("", (w) => {
    flush(w, "A");
    w.db = "A · 17 уже было. Пропускаю.";
  }, {
    verdict: ["green", "green"], focus: ["A", "row", "flushes", "adds", "board"],
    voice: "Теперь при повторе прилетает та же пачка семнадцать: база видит знакомый номер, пропускает прибавку, но всё равно отвечает поду, что пачка учтена! Сколько бы повторов ни пришло, итог в базе не изменится. Мы получили идемпотентный сброс, idempotent flush.",
  });
  const keyedShot = structuredClone(d.w);
  d.shot("", (w) => {
    kill(w, "B");
  }, {
    verdict: ["yellow", null], focus: ["B", "jar", "board"],
    voice: "Внимательный инженер спросит: а что, если под убьют жёстко, через kill девять, или его прибьёт OOM Killer? Тогда клики, накопленные за последние секунды, всё же пропадут. И это осознанный выбор: клики по ссылкам — статистика, а не транзакции с реальными деньгами. Для денег мы бы ещё до ответа клиенту записывали каждое событие в надёжный журнал, куда только дописывают.",
  });

  // Итог — повтором узнаваемых моментов (команды, стрелки), а не конца акта.
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ACTORS) x.actors[id].acts = structuredClone(saved.actors[id].acts);
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
      x.db = null;
    }, { voice });
  };
  recap(hotRowShot, "Давайте подведём итог и вспомним пройденный путь. Сначала мы столкнулись с горячей строкой: тысячи запросов встали в затылок к одной записи и парализовали весь сервис.");
  recap(shardedShot, "Шестнадцать частей счётчика ослабили борьбу за блокировку, но не уменьшили общий объём работы: каждый клик по-прежнему оставался отдельной транзакцией, и база оставалась нагружена.");
  recap(batchShot, "Спасением стала пакетная запись: мы начали копить клики в памяти и сбрасывать их пачками, сократив число обращений к базе в тысячи раз.");
  recap(keyedShot, "А чтобы сетевые сбои и повторные отправки не ломали точность, мы сделали сброс идемпотентным с помощью номера пачки.");

  return d.steps;
}
