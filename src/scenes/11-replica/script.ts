import type { Step } from "../../engine/contract";
import type { Code } from "../../kit/code";
import { Director } from "../../kit/director";
import { ask, book, crowd, down, flood, read, tick, world, type Focus, type PodId, type ReplicaId, type Route, type World } from "./sim";

// Акты эпизода — синхронно с docs/episodes/11-read-your-writes.md (сценарий v0) и раскадровкой v1
// (docs/reviews/11-scriptwriter-arc.md). MVP: все акты подряд серыми фигурами, без полировки.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  case1: "Кейс 1",
  replicas: "1.1 Читаем с реплик",
  primary: "1.2 Всё с primary",
  seal: "1.3 Primary 2 с после записи",
  case2: "Кейс 2",
  late: "2.1 Метка 2 с при лаге 3 и 5 с",
  lsn: "2.2 Метка LSN",
  sync: "2.3 remote_apply",
  summary: "Итог",
} as const;

/** Исключения произношения для синтеза; экран и субтитр не меняются. */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
  remote_apply: "ремоут эплай",
};

const SECOND = 1000;

/** Два пула в коде пода: запись — в primary, список броней — с реплик. */
export const CODE_POOLS: Code = {
  title: "Бронь и «Мои брони» · Go",
  lines: [
    "primary.Exec(`INSERT INTO bookings …`, guest, room)",
    "",
    "replica.Query(`SELECT * FROM bookings …`, guest)",
  ],
  mark: [{ line: 0, tone: "ok", note: "пул к primary" }, { line: 2, tone: "ok", note: "пул к репликам" }],
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
    for (const r of Object.values(w.replicas)) r.say = null;
    w.guest.pressed = false;
    w.guest.thought = null;
    w.code = null;
  }

  protected override finish(w: World): void {
    w.replay = this.replaying;
  }
}

/** Мир распродажи: лента за последние секунды забита чужими записями, реплики отстают на `lags`. */
function sale(route: Route, lags: [number, number] = [3 * SECOND, 3 * SECOND]): World {
  const w = world();
  w.clock = 60 * SECOND;
  w.route = route;
  w.replicas[1].lag = lags[0];
  w.replicas[2].lag = lags[1];
  flood(w, 12, 4 * SECOND);
  w.events = [];
  return w;
}

const say = (w: World, id: ReplicaId, text: string) => (w.replicas[id].say = text);

/** Часы: мс от 12:00:00. */
export function clock(ms: number): string {
  const t = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${12 + Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: гость, под и primary, реплики, лента журнала, два пула в коде, норма.
  d.scene(ACT.intro);
  d.shot("", (w) => {
    w.unseen = ["replicas", "tape", "crowd"];
  }, {
    focus: ["guest", "A", "B", "C", "primary"],
    voice: "Мы снова в нашем сервисе бронирования отелей. Гости ищут номера на выходные, наши поды показывают им свободные, а когда гость выбирает, записывают бронь в базу, в Postgres. Сегодня один гость забронирует один и тот же номер дважды, хотя в нашем коде нет ни одной ошибки и база не упала. Но сначала посмотрим, как всё устроено, пока спокойно.",
  });
  d.shot("", (w) => {
    w.guest.pressed = true;
    w.events.push({ kind: "press" });
    book(w, "A");
  }, {
    focus: ["guest", "A", "primary"],
    voice: "Гость выбрал номер и нажимает «Забронировать». Нажатие приходит в один из подов, и под записывает бронь в Postgres: здесь лежат все брони. Пока база одна, ей приходится и принимать записи, и отвечать на все чтения.",
  });
  d.shot("", (w) => {
    w.unseen = ["replicas", "tape"];
    w.route = "primary";
    crowd(w);
  }, {
    focus: ["primary", "crowd"],
    voice: "А чтений у нас в десятки раз больше, чем записей: листают номера многие, а бронируют немногие. И все эти чтения идут в ту же единственную базу.",
  });
  d.term("Read replica");
  d.shot("", (w) => {
    w.unseen = ["tape"];
    w.route = "replica";
    crowd(w);
  }, {
    focus: ["primary", 1, 2, "crowd"],
    voice: "Поэтому рядом с главной базой, primary, мы держим две копии, реплики. Записи принимает primary, а поиск и списки читают с реплик, и главная база не тонет в чтениях.",
  });
  d.shot("", (w) => {
    w.unseen = [];
    tick(w, 100);
  }, {
    focus: ["primary", "tape", 1, 2],
    voice: "Но как копия узнаёт, что в главной базе что-то изменилось? Таблицу ей целиком не пересылают. Primary каждое изменение сначала записывает в журнал, WAL: это лента, на которой записи идут строго по порядку. Эту ленту primary сразу же отправляет репликам, запись за записью, а каждая реплика проигрывает полученное у себя в том же порядке. Место, до которого она дошла, и есть её позиция: слева от неё уже проиграно, справа ещё нет.",
  });
  d.shot("", (w) => {
    w.code = CODE_POOLS;
  }, {
    focus: ["code"],
    voice: "Теперь посмотрим, кто решает, куда идти. Postgres сам чтения по репликам не разносит: для него это просто другие адреса. Разводит наш код на Go: у пода два пула соединений, один к primary, второй к репликам. Запись уходит в первый, а список броней читаем из второго.",
  });
  d.shot("", (w) => {
    read(w, "B", 1);
    say(w, 1, "Одна бронь.");
  }, {
    focus: ["guest", "B", 1, "tape"],
    voice: "Пока всё спокойно, это никому не мешает. Бронь записана в primary, золотая карточка встаёт в конец ленты, и реплики проигрывают её за миллисекунды. Гость нажал кнопку, оказался на странице «Мои брони», и бронь уже там. Реплики отстают от главной базы всегда, но в обычное время это не заметно.",
  });

  // Хук: распродажа, лаг 3 с, «Мои брони» пусто, гость жмёт ещё раз.
  const hook = world();
  hook.clock = 60 * SECOND;
  hook.crowd = "replicas";
  d.scene(ACT.hook, hook);
  d.term("Replication lag");
  d.shot("", (w) => {
    w.replicas[1].lag = 3 * SECOND;
    w.replicas[2].lag = 3 * SECOND;
    flood(w, 12, 4 * SECOND);
  }, {
    focus: ["tape", 1, 2],
    voice: "Но вот начинается распродажа. Записей на primary сыплется столько, что лента растёт быстрее, чем реплики успевают её проигрывать: проигрывает её один процесс, и он просто не успевает за потоком. Реплика теперь отстаёт на три секунды. Это replication lag.",
  });
  d.shot("", (w) => {
    book(w, "A");
  }, {
    focus: ["guest", "A", "tape"],
    voice: "И именно в этот момент наш гость жмёт «Забронировать». Под записывает бронь в primary, она встаёт в самый конец длинной ленты, а гостя, как обычно, отправляют на страницу «Мои брони».",
  });
  d.shot("", (w) => {
    tick(w, 200);
    read(w, "B", 1);
    say(w, 1, "Броней нет.");
    w.guest.thought = "Не прошло?";
  }, {
    focus: ["guest", "B", 1, "tape"],
    voice: "Список броней под читает с реплики, как мы сами ему велели. А реплика до записи гостя ещё не дошла. Она не знает, что отстаёт, и честно отвечает по тому, что успела проиграть: броней нет. Это называют устаревшим чтением, stale read. Для гостя же это выглядит так, будто нажатие не сработало.",
  });
  const empty = structuredClone(d.w);
  d.shot("", (w) => {
    book(w, "A");
    tick(w, 3 * SECOND);
    read(w, "B", 1);
    say(w, 1, "Теперь две.");
  }, {
    focus: ["guest", "B", 1, "tape", "clock"],
    voice: "Что сделает нормальный человек? Нажмёт ещё раз. Вторая бронь встаёт на ленту следом за первой, и через три секунды реплика наконец проигрывает обе. В списке две брони на одни и те же даты. Мы ничего не сломали ни в записи, ни в базе: гость просто не увидел то, что только что сделал сам.",
  });

  // КЕЙС 1 — гость не видит свою бронь.
  d.scene(ACT.case1);
  d.chapter(1, ["гость видит", "primary не тонет"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nГость не видит свою бронь";
  }, { hold: 2.5, voice: "Кейс первый. Гость не видит собственную бронь, и вопрос такой: как сделать так, чтобы видел?" });

  d.scene(ACT.replicas, sale("replica"));
  d.attempt("читаем с реплик");
  d.shot("", (w) => {
    book(w, "A");
    read(w, "B", 1);
    say(w, 1, "Броней нет.");
    crowd(w);
  }, {
    verdict: ["red", "green"], focus: ["guest", 1, "crowd", "board"],
    voice: "Начнём с того, что есть: все чтения идут на реплики. Главной базе легко, а гость своей брони не видит.",
  });

  d.scene(ACT.primary, sale("primary"));
  d.attempt("всё с primary");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: всё с primary";
    book(w, "A");
    read(w, "B");
    crowd(w);
  }, {
    verdict: ["green", "red"], focus: ["guest", "primary", "crowd", "board"],
    voice: "Самый простой выход: раз реплика отстаёт, читаем всё с primary. Гость и правда сразу видит свою бронь. Но тогда в главную базу пошли и все листающие номера, а их там в десятки раз больше, чем записей. Брони стоят в очереди за чтениями, а реплики скучают. Мы вернули primary именно ту нагрузку, от которой его когда-то спасали.",
  });
  const allPrimary = structuredClone(d.w);

  d.scene(ACT.seal, sale("seal"));
  d.attempt("primary 2 с");
  d.term("Read-your-writes");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: primary после записи";
    book(w, "A");
    read(w, "B");
    crowd(w);
  }, {
    verdict: ["green", "green"], focus: ["guest", "A", "B", "primary", "crowd", "board"],
    voice: "Вернёмся и зайдём с другой стороны. Primary нужен не всем, а только тому, кто сам что-то записал. Сразу после записи под отмечает гостя на две секунды, и пока отметка держится, его чтения идут в primary, где бронь уже есть. Остальные гости, да и сам гость чуть позже, читают с реплик. Так гость видит свои собственные записи, и это называется read-your-writes.",
  });
  d.shot("", (w) => {
    tick(w, 2 * SECOND);
  }, {
    focus: ["guest", "clock"],
    voice: "Получилось неплохо, но у приёма есть границы. Метка ставится, только когда запись сделал сам гость: если бронь потом изменит чужой процесс или гость откроет сервис с телефона, метка этого не знает. И главное, две секунды мы просто угадали. Посмотрим, что будет, если угадали не совсем.",
  });

  // КЕЙС 2 — реплики отстают дольше двух секунд.
  d.scene(ACT.case2);
  d.chapter(2, ["гость видит", "primary не тонет"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nОтстаём дольше двух секунд";
  }, { hold: 2.5, voice: "Кейс второй. Распродажа продолжается, и реплики отстают дольше двух секунд. Что тогда будет с нашей меткой?" });

  d.scene(ACT.late, sale("seal", [3 * SECOND, 5 * SECOND]));
  d.attempt("метка 2 с");
  d.shot("", (w) => {
    book(w, "A");
    read(w, "B");
    crowd(w);
    tick(w, 2500);
    read(w, "B", 1);
    say(w, 1, "Броней нет.");
    w.guest.thought = "Она же была!";
  }, {
    verdict: ["red", "green"], focus: ["guest", "B", 1, 2, "tape", "clock", "board"],
    voice: "Первая реплика отстаёт на три секунды, вторая ещё сильнее, на пять. Гость забронировал и сначала увидел бронь, потому что метка отправила его в primary. Но через две секунды метка погасла, и следующее чтение ушло на реплику, которая ещё не дошла до записи. Бронь, которую он только что видел, снова не видна. Можно было бы поставить не две секунды, а тридцать, но тогда мы просто вернёмся к кейсу выше, да и число опять останется догадкой.",
  });
  d.term("Monotonic reads");
  d.shot("", (w) => {
    tick(w, SECOND);
    read(w, "B", 1);
    say(w, 1, "Бронь есть.");
    read(w, "B", 2);
    say(w, 2, "Броней нет.");
    w.guest.thought = "Была… и нет?";
  }, {
    verdict: ["red", null], focus: ["guest", "B", 1, 2, "tape", "board"],
    voice: "Дальше ещё интереснее. Наш код читает то с первой реплики, то со второй. Первая успела проиграть бронь, и гость её видит. Он обновил страницу, ответила вторая, отстающая сильнее, и брони снова нет. Это уже другая беда: раньше он не видел свою запись, а теперь увидел и потерял. Так нарушается monotonic reads: чтения не должны идти назад во времени.",
  });
  const flicker = structuredClone(d.w);

  const lsn = sale("lsn", [3 * SECOND, 5 * SECOND]);
  lsn.lsn = true;
  d.scene(ACT.lsn, lsn);
  d.attempt("метка LSN");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: метка с номером LSN";
    book(w, "A");
  }, {
    focus: ["guest", "A", "primary", "tape"],
    voice: "Что не так с нашей меткой? Она считает секунды, а должна смотреть на ленту: нам не важно, сколько прошло времени, нам важно, дошла ли реплика до записи гостя. Поэтому сразу после COMMIT под спрашивает primary, на каком месте ленты тот стоит, и кладёт этот номер гостю. Он называется LSN. Брать его до COMMIT нельзя: номер окажется раньше самой записи.",
  });
  d.shot("", (w) => {
    tick(w, 3500);
    read(w, "B", 2);
    crowd(w);
  }, {
    verdict: ["green", "green"], focus: ["guest", "B", 1, 2, "board"],
    voice: "А перед чтением под спрашивает реплику, до какого места ленты она проиграла. Вторая ещё позади записи гостя, поэтому её мы пропускаем. Первая ответила, что дошла дальше, и читаем с неё. А если бы не дошла ни одна, чтение пошло бы в primary. Сама реплика по-прежнему не знает, что отстаёт, но теперь это знает наш код, сравнив два числа.",
  });
  const ticket = structuredClone(d.w);
  d.shot("", (w) => {
    for (const id of [1, 2, 1] as ReplicaId[]) read(w, "B", id);
    say(w, 1, "Бронь есть.");
  }, {
    focus: ["guest", "B", 1, 2],
    voice: "Заодно уходит и мигание: билет гостя только растёт, а реплика, которая позади него, ему не годится. Бронь, которую гость однажды увидел, он больше не теряет.",
  });
  d.shot("", (w) => {
    ask(w, "C", 2);
    say(w, 2, "Свободен!");
  }, {
    focus: ["C", 2, "tape"],
    voice: "Но вот что запомним. Всё, на чём мы решаем, можно ли записывать, например свободен ли номер, читаем только с primary. Отстающая реплика так же уверенно ответит «свободен», а номер уже занят, и мы продадим его дважды. Реплики годятся для того, что не страшно увидеть с опозданием.",
  });

  const sync = sale("sync", [3 * SECOND, 5 * SECOND]);
  sync.replicas[1].sync = true;
  d.scene(ACT.sync, sync);
  d.attempt("remote_apply");
  d.term("Synchronous replication");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: remote_apply";
    book(w, "A");
    read(w, "B");
    crowd(w);
  }, {
    verdict: ["green", "green"], focus: ["guest", "A", "B", 1, "tape", "clock", "board"],
    voice: "Вернёмся к началу и зайдём совсем с другой стороны: пусть primary вообще не отпускает гостя, пока реплика не проиграла его бронь. Так умеет синхронная репликация, synchronous replication. Тут важна оговорка: обычный синхронный режим ждёт, пока реплика запишет ленту на диск, а видимой запись становится, только когда реплика её проиграла. Нужен режим remote_apply: тогда COMMIT возвращается, когда реплика уже проиграла запись, и читать с неё можно сразу.",
  });
  d.shot("", (w) => {
    down(w, 1);
    book(w, "A");
    w.db = "Записал. Жду реплику.";
  }, {
    focus: ["guest", "A", 1, 2, "primary"],
    voice: "Но платим мы за это на каждой записи. Пока синхронная реплика отстаёт, каждая бронь ждёт, пока та её проиграет. А если реплика легла, COMMIT на primary просто висит, и брони не проходят совсем, хотя сама главная база здорова. К тому же ждём мы только синхронную реплику: остальные отстают по-прежнему. По лампам этот вариант выглядит лучшим, но цену они не показывают.",
  });
  const hang = structuredClone(d.w);

  // Итог — повтором уже виденных образов.
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B", "C"] as PodId[]) x.pods[id].acts = structuredClone(saved.pods[id].acts);
      for (const id of [1, 2] as ReplicaId[]) x.replicas[id].say = saved.replicas[id].say;
      x.guest.thought = saved.guest.thought;
      x.guest.pressed = saved.guest.pressed;
      x.db = saved.db;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card", "clock"].includes(e.kind)));
    }, { voice });
  };
  recap(empty, "Вот и вся история. Гость нажал «Забронировать», а реплика, ещё не проигравшая ленту, уверенно ответила из прошлого.");
  recap(allPrimary, "Читать всё с primary значило вернуть ему всю нагрузку.");
  recap(flicker, "Метка на пару секунд помогала, пока реплика укладывалась в срок, а потом вернулись и пустая страница, и мигание.");
  recap(ticket, "Номер места на ленте решил обе беды: читаем только с реплики, которая уже дошла.");
  recap(hang, "А ждать на каждой записи, пока реплика проиграет, можно, но тогда записи лягут вместе с ней.");
  return d.steps;
}
