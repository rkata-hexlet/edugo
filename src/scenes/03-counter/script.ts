import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  ACTORS, HOT, WINDOW, batchKey, click, drain, flood, flush, kill, restart, shard, sigterm, spawn, stop, wait, world,
  type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/03-counter.md (сценарий v0, покадрово).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  hook: "0. Хук",
  intro: "Знакомство",
  case1: "Кейс 1",
  direct: "1.1 +1 на каждый клик",
  async: "1.2 go func()",
  sharded: "1.3 16 строк",
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
  shard: (i: number) => `UPDATE link_stats SET clicks = clicks + 1\n  WHERE code = '${HOT}' AND shard = ${i}`,
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

  // 0. Хук: все клики — +1 в одну строку, пулы подов забиты, чужие ссылки ждут соединения.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    flood(w, 10_000);
    for (const id of ACTORS) click(w, id, 40);
    w.db = "Считаю. Просто по одному.";
  }, { voice: "Одну ссылку выложили в большой канал, и через минуту перестали открываться все остальные! А в базе при этом ничего не сломалось: каждый клик по этой ссылке просто ждёт своей очереди." });
  const hook = structuredClone(d.w);

  // Знакомство и норма.
  d.scene(ACT.intro);
  d.shot("", undefined, {
    focus: ["table", "row", "A", "B", "C"],
    voice: "Разберёмся, как так вышло. Перед нами сервис коротких ссылок: для каждой мы считаем клики, а число лежит в базе, в одной строке. Клики принимают три пода одного сервиса.",
  });
  d.shot("", (w) => {
    click(w, "A");
    sql(w, "A", SQL.add);
    sql(w, "A", "COMMIT");
  }, {
    sql: true, focus: ["A", "row", "sql", "adds"],
    voice: "Сначала посмотрим на норму. Пришёл клик, под A прибавил единицу и зафиксировал её через COMMIT. Счёт точный.",
  });
  d.shot("", (w) => {
    wait(w, "B");
    click(w, "A");
    click(w, "B");
  }, {
    focus: ["A", "B", "row", "adds"],
    voice: "Теперь клики приходят почти вместе. Пока под A прибавляет, под B ждёт, а после COMMIT пода A прибавляет уже к свежему значению. Ничего не теряется, но база считает строго по одному.",
  });

  // КЕЙС 1 — поток кликов.
  d.scene(ACT.case1);
  d.chapter(1, ["счёт точный", "база справляется"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nКликов тысячи в секунду. Как выдержать?";
  }, { hold: 2.5, voice: "Теперь представим, что кликов тысячи в секунду, и начинается первый кейс. Мы следим за двумя вещами: чтобы счёт оставался точным и чтобы база справлялась." });

  // 1.1 +1 на каждый клик: очередь к строке, пул кончился.
  d.scene(ACT.direct, structuredClone(hook), { replay: true });
  d.attempt("+1 на каждый клик");
  d.shot("", (w) => {
    w.events.push({ kind: "overload" });
  }, {
    verdict: ["green", "red"], focus: ["row", "queue", "load", "board"],
    voice: "Начнём с самого простого: на каждый клик свой UPDATE с прибавкой единицы. Счёт точный, но очередь к строке растёт на глазах.",
  });
  d.shot("", (w) => {
    w.flashback = { voice: "Поэтому B и C висят" };
  }, {
    voice: "Помните, как в ролике про очередь задач поды B и C висели в ожидании, пока под A не сделает COMMIT? Здесь всё то же самое, только ждут уже не два пода, а тысячи запросов.",
  });
  d.term("Hot row · lock contention");
  d.shot("", (w) => {
    w.db = "Остальные ссылки я бы открыл.";
  }, {
    focus: ["A", "B", "C", "pool", "queue", "browsers"],
    voice: "Каждый запрос, который ждёт строку, держит соединение с базой из пула. Соединения кончаются, и остальные клики, по любой ссылке, ждут уже свободного соединения! Это горячая строка, hot row: запросы дерутся за одну запись, то есть lock contention.",
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
    voice: "Тогда не будем ждать: пусть прибавка выполняется в фоне. Браузер получает ответ сразу, и поначалу кажется, что всё в порядке.",
  });
  d.term("Fire-and-forget");
  d.shot("", (w) => {
    flood(w, 10_000);
    ([["A", 3_120], ["B", 2_980], ["C", 3_050]] as const).forEach(([id, n]) => click(w, id, n));
    drain(w, "B", 1);
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "C", "pool", "queue", "board"],
    voice: "Но строка-то осталась той же! Прибавки копятся в памяти подов, занимают те же соединения и по-прежнему проходят строку по одному. Fire-and-forget, то есть выстрелил и забыл, переносит ожидание в фон, но не убирает его.",
  });
  d.shot("", (w) => {
    restart(w, "A");
    w.db = "Этих кликов я не видел.";
  }, {
    verdict: ["yellow", null], focus: ["A", "row", "browsers", "board"],
    voice: "Хуже того: если под перезапустится, пока прибавки висят в фоне, они пропадут вместе с его памятью. Клик был, ответ браузеру ушёл, а в счёте этого клика нет!",
  });

  // 1.3 Sharded counter: очереди нет, но каждый клик — запись.
  d.scene(ACT.sharded);
  d.attempt("16 строк");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: делим строку";
    shard(w);
    click(w, "A");
    sql(w, "A", SQL.shard(7));
  }, {
    sql: true, focus: ["A", "row", "sql"],
    voice: "Попробуем решить это в самой базе: вместо одной строки заведём шестнадцать, и каждый клик попадёт в любую из них.",
  });
  d.shot("", (w) => {
    flood(w, 10_000);
    for (const id of ACTORS) click(w, id, 40);
    sql(w, "C", SQL.sum);
  }, {
    sql: true, verdict: ["green", null], focus: ["A", "B", "C", "row", "sql", "board"],
    voice: "Теперь запросы почти не ждут друг друга, а общий счёт читается одной суммой по шестнадцати строкам. И он остаётся точным.",
  });
  d.term("Sharded counter");
  d.shot("", (w) => {
    for (const id of ACTORS) click(w, id, 40);
    w.db = "Очередь ушла, а работа нет.";
  }, {
    verdict: [null, "yellow"], focus: ["row", "load", "board"],
    voice: "Но каждый клик по-прежнему отдельная запись и отдельный COMMIT. Ожидание мы разнесли по шестнадцати строкам, а работы у базы меньше не стало. Это sharded counter: один счётчик, разложенный на несколько строк.",
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
    voice: "Посмотрим на задачу иначе: базе вовсе не нужен каждый клик. Пусть каждый под копит прибавки у себя, а браузеру отвечает сразу.",
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
    voice: "А раз в пять секунд под относит всё накопленное одним UPDATE, например сразу плюс восемь тысяч четыреста тридцать один. Вместо тысяч записей в секунду по этой ссылке остаётся по одной от каждого пода раз в пять секунд!",
  });
  const batchShot = structuredClone(d.w);
  d.term("Write batching");
  d.shot("", undefined, {
    verdict: ["yellow", "green"], focus: ["row", "jar", "browsers", "board"],
    voice: "Первая цена видна сразу: число в базе отстаёт от реального на окно сброса, до пяти секунд. Для счётчика кликов это приемлемо. Так работает write batching: записи копятся и уходят пачкой. Но есть и вторая цена: пока клики лежат в поде, они живут только в его памяти.",
  });

  // КЕЙС 2 — под гаснет с полной копилкой.
  d.scene(ACT.case2);
  d.chapter(2, ["не теряем", "не считаем дважды"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nПод погас. Что с кликами?";
  }, { hold: 2.5, voice: "А теперь самое неприятное: накопленное лежит в памяти пода, а поды у нас то и дело гаснут. Что станет с кликами?" });

  // 2.1 Деплой без мягкой остановки: каждый под уносит свою копилку.
  const start = filled();
  d.scene(ACT.deploy, structuredClone(start));
  d.attempt("просто копим, деплой");
  d.shot("", (w) => {
    for (const id of ACTORS) stop(w, id);
  }, {
    focus: ["A", "B", "C", "jar"],
    voice: "Мы выкатываем новую версию сервиса, и поды по очереди гаснут, а на их место встают новые. Это не авария, так бывает каждый день.",
  });
  d.shot("", (w) => {
    for (const id of ACTORS) spawn(w, id);
    w.db = "У меня всё сходится.";
  }, {
    verdict: ["red", "green"], focus: ["A", "B", "C", "row", "browsers", "board"],
    voice: "Но каждый под унёс с собой всё, что накопил! На каждом деплое мы теряем клики.",
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
    voice: "Перед выключением поду приходит сигнал SIGTERM, то есть заканчивай. Тогда под перестаёт принимать новые клики, сбрасывает накопленное и только после этого гаснет.",
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
    voice: "То же самое делают поды B и C, поэтому на деплое теперь ничего не теряется: каждый успевает отнести свою пачку. Это graceful shutdown, мягкая остановка.",
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
    voice: "Но вот под A отправляет последнюю пачку, и в этот момент моргает сеть. База число записала и зафиксировала, а ответ до пода не дошёл.",
  });
  d.term("At-least-once");
  d.shot("", (w) => {
    flush(w, "A");
    w.db = "Ещё +8431? Записал.";
  }, {
    verdict: ["green", "red"], focus: ["A", "row", "adds", "browsers", "board"],
    voice: "Под не может отличить, не дошла пачка или дошла, но потерялся ответ. Терять клики страшнее, поэтому он повторяет отправку. Пачка прибавилась дважды — и счёт теперь больше, чем было кликов! Так устроен at-least-once: пачка дойдёт хотя бы один раз, а может, и не один.",
  });
  d.shot("", (w) => {
    w.flashback = { voice: "Теперь оба письма уходят" };
  }, {
    voice: "В ролике про очередь задач повторное письмо отсекала Почта по ключу идемпотентности. Здесь получатель не Почта, а сама база, поэтому и ключ проверять придётся ей.",
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
    voice: "Вернёмся назад, до сброса, и дадим каждой пачке номер: например, пачка семнадцать от пода A.",
  });
  d.shot("", (w) => {
    sigterm(w, "A");
    const [pod, seq] = batchKey(w, "A").split(" · ");
    flush(w, "A", { lostReply: true });
    sql(w, "A", SQL.keyed(pod as ActorId, Number(seq), 8_431));
  }, {
    sql: true, focus: ["A", "row", "flushes", "sql"],
    voice: "Номер пачки мы записываем в базу в той же транзакции, что и прибавку. Прибавка выполняется, только если такого номера ещё не было, и запишется либо всё сразу, либо ничего.",
  });
  d.term("Idempotent flush");
  d.shot("", (w) => {
    flush(w, "A");
    w.db = "A · 17 уже было. Пропускаю.";
  }, {
    verdict: ["green", "green"], focus: ["A", "row", "flushes", "adds", "board"],
    voice: "Повтор приходит с тем же номером. База его узнаёт, ничего не прибавляет и спокойно отвечает: записано! Сколько ни повторяй, результат один, и это idempotent flush, идемпотентный сброс.",
  });
  const keyedShot = structuredClone(d.w);
  d.shot("", (w) => {
    kill(w, "B");
  }, {
    verdict: ["yellow", null], focus: ["B", "jar", "board"],
    voice: "Остался один случай: под убили без предупреждения, kill девять или нехватка памяти. Тогда пропадают клики за последние секунды, которые он накопил. Эту потерю мы принимаем осознанно, ведь клики — статистика, а не деньги. Для денег мы бы ещё до ответа браузеру записывали каждое событие в надёжный журнал.",
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
  recap(hotRowShot, "Давайте вспомним путь. Сначала мы увидели горячую строку: тысячи кликов стоят в очереди к одной записи, а остальные ссылки не открываются.");
  recap(shardedShot, "Шестнадцать строк убрали очередь, но не работу: каждый клик по-прежнему остался отдельной записью.");
  recap(batchShot, "Помогла пачка: копим у себя и сбрасываем раз в окно, и вместо тысяч записей остаётся несколько.");
  recap(keyedShot, "А чтобы повтор не испортил счёт, пачке нужен номер.");

  return d.steps;
}
