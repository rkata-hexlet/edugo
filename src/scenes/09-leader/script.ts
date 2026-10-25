import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { ACT as ACT08, buildSteps as buildSteps08 } from "../08-double-charge/script";
import type { World as World08 } from "../08-double-charge/sim";
import {
  ACTORS, IRA, LOCK_ID, SUBS, acquire, advance, charge, crash, cut, factKey, notify, record, recorded, renew, restart, ring,
  tryLock, vanish, world, type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/09-leader.md.
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  recall: "Вспомним оплату",
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс 1",
  lock: "1.1 Advisory lock",
  silent: "1.2 Узел пропал",
  cronjob: "⟲ CronJob",
  case2: "Кейс 2",
  lease: "2.1 Аренда",
  split: "2.2 Два лидера",
  check: "2.3 Проверка перед списанием",
  key: "2.4 Ключ из факта",
  why: "Зачем замок",
  summary: "Итог",
} as const;

/** Случайные ключи запуска: у каждого лидера свои (не совпадают с ключами эпизода 08 во вставке). */
const RANDOM: Record<ActorId, string> = { A: "k-91c4", B: "k-7e20", C: "k-0d5a" };
const randomKey = (who: ActorId, sub: number) => `${RANDOM[who]}·${sub}`;

const SQL = {
  lock: `SELECT pg_try_advisory_lock(${LOCK_ID})`,
  acquire: "UPDATE leader SET holder = $me, epoch = epoch + 1,\n  lease_until = now() + '15s'\n  WHERE name = 'billing' AND lease_until < now()",
  renew: "UPDATE leader SET lease_until = now() + '15s'\n  WHERE name = 'billing' AND holder = $me",
  left: "SELECT lease_until - now() FROM leader\n  WHERE name = 'billing' AND holder = $me",
};

/** Код пода на Go: cron в каждом процессе. */
const GO = {
  cron: [
    "c := cron.New()",
    "c.AddFunc(\"0 3 * * *\", s.ChargeSubscriptions)",
    "c.Start()",
    "",
    "func (s *Service) ChargeSubscriptions() {",
    "  for _, sub := range s.dueToday(ctx) {",
    "    s.bank.Charge(ctx, sub)",
    "    s.saveCharge(ctx, sub)",
    "  }",
    "}",
  ],
};

/** Мысли-заблуждения: висят, пока герой в них верит. */
const THINK = {
  leader: "Я лидер!",
  inTime: "Ещё 2 секунды — успею!",
};

/**
 * Исключения произношения для синтеза; экран и субтитр не меняются.
 * Буквы подов — по-русски (решение пользователя для серии).
 */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
  "9001": "девять тысяч один",
  cron: "крон",
  CronJob: "крон джоб",
  advisory: "эдвайзори",
  lease: "лиз",
  Lease: "лиз",
  fencing: "фэнсинг",
  "split brain": "сплит брейн",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", w.bank ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

const STEPS08 = buildSteps08();
/** Кадр эпизода 08 во вставке: повтор с ключом получает сохранённый ответ, банк второй раз не списывает. */
export const RECALL = STEPS08.findIndex((s) => s.act === ACT08.answer && !!s.state.bank);

/** Мир этого кадра 08 для его же отрисовки: только сцена — без табло, кейса, SQL-панели и реплики (шапку занимает штамп). */
export function recallWorld(step: number): World08 {
  const w = structuredClone(STEPS08[step].state);
  return { ...w, board: null, chapter: null, sql: [], db: null, term: null };
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
    w.slot = false;
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

/** Наивная задача целиком: банк, запись, уведомление — по каждой подписке. */
function runAll(w: World, who: ActorId, key?: (sub: number) => string): void {
  for (const s of SUBS) {
    charge(w, who, s.id, key ? key(s.id) : null);
    record(w, who, s.id);
    if (s.id === IRA) notify(w, who);
  }
}

/** Лидер продолжает с места: только то, чего нет в charges. Без связи с базой — по загруженному списку и без записи. */
function rest(w: World, who: ActorId, key?: (sub: number) => string, subs = SUBS.map((s) => s.id)): void {
  const online = w.actors[who].conn === "open";
  for (const id of subs) {
    if (online && recorded(w, who, id)) continue;
    charge(w, who, id, key ? key(id) : null);
    if (online) record(w, who, id);
  }
}

/** Будильник cron во всех живых подах. */
function night(w: World): void {
  for (const id of ACTORS) if (!w.actors[id].dead && !w.actors[id].hidden) ring(w, id);
}

/** Мир с аренды: строка leader заведена заранее (номер срока уже 7), часы БД в кадре. */
function leased(): World {
  const w = world();
  w.shown.conns = true;
  w.shown.clock = true;
  w.leader = { holder: null, epoch: 7, leaseUntil: 0 };
  return w;
}

/** Старт кейса 2.2: A — лидер, B и C ждут. */
function splitStart(): World {
  const w = leased();
  night(w);
  acquire(w, "A");
  acquire(w, "B");
  acquire(w, "C");
  return w;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Вспомним оплату: кадр 08 его же отрисовкой.
  d.scene(ACT.recall);
  d.shot("", (w) => {
    w.flashback = RECALL;
    w.stamp = "⟲ Вспомним: двойное списание";
  }, {
    voice: "Помните Иру? В ролике про двойное списание мы научили сервис оплаты не списывать деньги дважды, даже когда приложение повторяет запрос. Для этого приложение прикрепляло к каждой попытке оплаты свой ключ, и повтор с тем же ключом получал сохранённый ответ.",
  });

  // Знакомство: ночь, подписки, cron.
  const intro = world();
  intro.shown.subs = false;
  intro.shown.charges = false;
  d.scene(ACT.intro, intro);
  d.shot("", undefined, {
    focus: ["ira", "A", "B", "C"],
    voice: "С тех пор сервис вырос, и подов у него уже три. А Ира подключила подписку «Плюс» за двести девяносто девять рублей в месяц. Ира спит, а деньги кто-то должен списать сам, без неё.",
  });
  d.shot("", (w) => {
    w.shown.subs = true;
    w.shown.charges = true;
  }, {
    focus: ["subs", "charges", "db"],
    voice: "Кому и когда списывать, лежит в базе, в таблице подписок. Подписка Иры здесь под номером сорок два, а рядом ещё Олег и Марта. Каждое удачное списание сервис записывает в таблицу charges.",
  });
  d.shot("", (w) => {
    w.code = { title: "Go · ночная задача", lines: GO.cron, mark: [{ line: 2, tone: "warn", note: "в каждом поде" }] };
  }, {
    focus: ["code"],
    voice: "Делает это сам сервис: в каждом поде живёт планировщик, cron. В три часа ночи он берёт подписки на сегодня, по каждой идёт в банк и записывает списание. Пока под был один, всё работало как часы.",
  });

  // Хук: три будильника — три списания.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    night(w);
  }, {
    focus: ["A", "B", "C", "ira"],
    voice: "Но подов-то теперь три! В три часа ночи будильник звенит в каждом из них, и каждый берёт тот же список подписок.",
  });
  d.term("Cron on every replica");
  d.shot("", (w) => {
    for (const id of ACTORS) runAll(w, id);
    w.bank = "Три так три.";
  }, {
    focus: ["A", "B", "C", "bank", "ira"],
    voice: "И каждый, не зная о других, честно списывает плату за тот же самый месяц. С Иры уходит три платежа вместо одного, и с Олега и Марты тоже. Так это и называется: cron в каждой реплике, cron on every replica.",
  });
  const hookEnd = structuredClone(d.w);
  d.shot("", (w) => {
    w.ira.asleep = false;
    w.db = "Одна задача. Три пода.";
  }, {
    focus: ["ira", "db"],
    voice: "Утром Ира видит три уведомления вместо одного. Совсем как в ролике про очередь задач: там три пода отправили три письма, а здесь сняли три платежа.",
  });
  d.shot("", (w) => {
    w.actors.A.acts.push({ kind: "bank", sub: 42, key: null, replayed: false });
    w.slot = true;
  }, {
    focus: ["A", "bank"],
    voice: "Внимательный зритель спросит: а где же ключ? Тот ключ ставило приложение на свои запросы. А ночная задача ходит в банк сама, телефона у неё нет, а значит, нет и ключа.",
  });

  // Норма: один делает, остальные подхватят.
  d.scene(ACT.norm);
  d.shot("", (w) => {
    night(w);
    rest(w, "A");
    w.actors.A.leader = true;
  }, {
    focus: ["A", "B", "C", "bank"],
    voice: "А хотим мы другого. Ночью подписки списывает один под, а остальные ему не мешают.",
  });
  d.scene(ACT.norm);
  d.shot("", (w) => {
    night(w);
    charge(w, "A", 42);
    record(w, "A", 42);
    crash(w, "A");
    rest(w, "B");
    w.actors.B.leader = true;
  }, {
    focus: ["A", "B", "charges", "bank"],
    voice: "Но этого мало. Если под упал посреди списка, кто-то должен доделать остальное и не тронуть тех, с кого уже списали.",
  });

  // КЕЙС 1: одно списание / доделают.
  d.scene(ACT.case1);
  d.chapter(1, ["одно списание", "доделают"]);
  d.shot("", (w) => {
    w.plate = "Кейс 1 из 2\nТри пода, одна задача.\nКак запустить её один раз?";
  }, {
    hold: 2.5,
    voice: "Итак, следить будем за двумя вещами: чтобы каждую подписку списали один раз и чтобы работу доделали, даже если под пропал посреди списка.",
  });

  // 1.1 Advisory lock: замок на соединении; под убит — соединение закрыто, замок снят.
  const conns = () => {
    const w = world();
    w.shown.conns = true;
    return w;
  };
  d.scene(ACT.lock, conns());
  d.attempt("advisory lock");
  d.shot("", (w) => {
    night(w);
    sql(w, "A", SQL.lock);
    tryLock(w, "A");
    sql(w, "A", "-- true");
    w.db = "Это просто число 9001.";
  }, {
    sql: true, focus: ["A", "conn", "db", "sql"],
    voice: "Начнём с самого простого. Пусть поды договорятся о числе, скажем девять тысяч один, и работает тот, кто первым захватил на него замок. Это рекомендательный замок, advisory lock: база не знает, что он охраняет, для неё это просто номер.",
  });
  d.term("Advisory lock");
  d.shot("", (w) => {
    for (const id of ["B", "C"] as const) {
      sql(w, id, SQL.lock);
      tryLock(w, id);
    }
    sql(w, "C", "-- false");
    w.actors.C.asleep = true;
  }, {
    sql: true, focus: ["B", "C", "conn", "sql"],
    voice: "Поды B и C получают «занято», но не расходятся: они пробуют снова, скажем раз в минуту. Иначе, упади лидер, до следующей ночи работу никто не доделает. Так у нас и появляется лидер, тот, кто сейчас держит замок.",
  });
  d.shot("", (w) => {
    charge(w, "A", 42);
    record(w, "A", 42);
    crash(w, "A");
    advance(w, 60);
    w.actors.C.asleep = false;
    tryLock(w, "B");
    rest(w, "B");
    w.db = "Соединение закрыто,\nзамок снят.";
  }, {
    verdict: ["green", "green"], focus: ["A", "B", "conn", "charges", "bank", "board"],
    voice: "И вот посреди списка под A убивает OOM Killer. Вместе с процессом закрывается и его соединение, и база сама отпускает замок. Через минуту замок берёт под B и по таблице charges продолжает с того места, где остановился A.",
  });
  d.shot("", (w) => {
    w.db = "Починили? Ну-ну.";
  }, {
    focus: ["conn", "db"],
    voice: "Казалось бы, замок отпускается всякий раз, когда умирает под. Давайте проверим.",
  });

  // 1.2 Узел пропал: соединение для базы живо — замок висит.
  d.scene(ACT.silent, conns());
  d.attempt("узел без связи");
  d.term("Session-bound lock");
  d.shot("", (w) => {
    night(w);
    tryLock(w, "A");
    tryLock(w, "B");
    tryLock(w, "C");
    w.actors.A.acts = [];
    charge(w, "A", 42);
    record(w, "A", 42);
    vanish(w, "A");
    w.doubt = "A";
    w.db = "Соединение живо,\nзамок держу.";
  }, {
    focus: ["A", "conn", "db"],
    voice: "Теперь под A пропадает иначе: его узел отваливается от сети, а соединение никто не закрыл. Для базы оно по-прежнему живое, а значит, и замок остаётся за A. Умер он или просто молчит, база не знает.",
  });
  d.shot("", (w) => {
    advance(w, 3 * 3600);
    tryLock(w, "B");
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "conn", "board"],
    voice: "Часы идут, под B честно стучится каждую минуту, а замок всё занят. Базе нужно время, чтобы понять, что соединение мертво, и по умолчанию это больше двух часов. Выходит, замок принадлежит не поду, а соединению.",
  });
  const silentEnd = structuredClone(d.w);

  // ⟲ Иначе: CronJob — запуск «примерно один раз».
  const job = world();
  job.actors.A.label = "Job";
  job.actors.B.hidden = true;
  job.actors.C.hidden = true;
  d.scene(ACT.cronjob, job);
  d.attempt("CronJob");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: CronJob";
    ring(w, "A");
  }, {
    focus: ["A"],
    voice: "Тут вы, конечно, скажете: вынесите задачу в CronJob, и пусть Kubernetes сам запускает её один раз в отдельном поде.",
  });
  d.shot("", (w) => {
    charge(w, "A", 42);
    crash(w, "A");
    restart(w, "A");
    rest(w, "A");
  }, {
    verdict: ["red", "green"], focus: ["A", "bank", "charges", "board"],
    voice: "Но Job может упасть сразу после ответа банка, ещё до записи, и Kubernetes запустит его заново с начала списка. Документация честно предупреждает: запуск будет лишь примерно один раз, а сама задача должна быть идемпотентной. Так что защита от повтора нам всё равно понадобится.",
  });

  // КЕЙС 2: доделают / одно списание.
  d.scene(ACT.case2);
  d.chapter(2, ["доделают", "одно списание"]);
  d.shot("", (w) => {
    w.plate = "Кейс 2 из 2\nЛидер замолчал.\nКто доделает и не спишет дважды?";
  }, {
    hold: 2.5,
    voice: "Раз замок держится за соединение, нам нужен такой, который кончается сам. Привяжем его ко времени. Следим всё за тем же: чтобы работу доделали и чтобы каждую подписку списали один раз.",
  });

  // 2.1 Аренда: строка leader со сроком по часам БД.
  d.scene(ACT.lease, leased());
  d.attempt("аренда");
  d.term("Leader election · lease");
  d.shot("", (w) => {
    night(w);
    sql(w, "A", SQL.acquire);
    acquire(w, "A");
    acquire(w, "B");
    acquire(w, "C");
    w.db = "Занято до 03:00:15.";
  }, {
    sql: true, focus: ["A", "B", "C", "leader", "db", "sql"],
    voice: "Заведём в базе строку: кто сейчас лидер и до какого времени. Срок, как и в ролике про очередь задач, отсчитывают часы базы, только теперь аренду берут на роль, а не на отдельную задачу. Это выбор лидера через аренду, leader election.",
  });
  d.shot("", (w) => {
    charge(w, "A", 42);
    record(w, "A", 42);
    advance(w, 5);
    sql(w, "A", SQL.renew);
    renew(w, "A");
  }, {
    sql: true, focus: ["A", "leader", "sql"],
    voice: "Пока под A работает, он между списаниями продлевает аренду ещё на пятнадцать секунд.",
  });
  d.shot("", (w) => {
    vanish(w, "A");
    w.doubt = "A";
    advance(w, 16);
    acquire(w, "B");
    rest(w, "B");
    w.db = "Я не слежу,\nя сверяю часы.";
  }, {
    verdict: ["green", "green"], focus: ["A", "B", "leader", "bank", "board", "db"],
    voice: "И вот под A пропадает, а продлений больше нет. Никто не следит, жив ли он: просто когда под B снова приходит за ролью, база сверяет срок со своими часами, видит, что он вышел, и отдаёт роль B.",
  });
  d.shot("", (w) => {
    w.aside = "lease";
  }, {
    focus: ["leader"],
    voice: "Кстати, в Kubernetes для этого есть готовый объект Lease и библиотека выбора лидера. Устроены они на той же идее аренды и так же не обещают, что лидер всегда будет один.",
  });
  d.shot("", (w) => {
    w.db = "Починили? Ну-ну.";
  }, {
    focus: ["A", "conn", "db"],
    voice: "Почему не обещают? Потому что под A мог и не умереть, а только потерять связь с базой.",
  });

  // 2.2 Два лидера: связь с базой пропала, банк доступен.
  d.scene(ACT.split, splitStart());
  d.attempt("связь с базой пропала");
  d.shot("", (w) => {
    w.actors.A.acts = [];
    charge(w, "A", 42);
    cut(w, "A");
    w.actors.A.thought = THINK.leader;
    rest(w, "A", undefined, [17]);
  }, {
    focus: ["A", "conn", "bank"],
    voice: "Так и есть: на этот раз под A жив. Он списал деньги с Иры, но тут пропала связь с базой, а до банка он по-прежнему достучаться может. Записать списание и продлить аренду он не в силах, но и узнать об этом ему не у кого, поэтому он списывает дальше.",
  });
  d.term("Split brain");
  d.shot("", (w) => {
    advance(w, 16);
    acquire(w, "B");
    rest(w, "B");
    w.bank = "Дважды за ноябрь?";
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "charges", "bank", "board"],
    voice: "Тем временем срок вышел, и лидером стал под B. В таблице charges у подписки Иры пусто, ведь запись от A до базы так и не дошла. И B списывает снова! Теперь лидеров два, это называют split brain, а у Иры двойной платёж.",
  });
  const splitEnd = structuredClone(d.w);

  // 2.3 Проверка аренды перед каждым списанием: проверил — и пауза.
  const checkStart = leased();
  night(checkStart);
  acquire(checkStart, "A");
  d.scene(ACT.check, checkStart);
  d.attempt("проверка аренды");
  d.shot("", (w) => {
    advance(w, 13);
    sql(w, "A", SQL.left);
    sql(w, "A", "-- 2 s");
    w.actors.A.thought = THINK.inTime;
    charge(w, "A", 42);
    w.actors.A.atBank = true;
  }, {
    sql: true, focus: ["A", "leader", "bank", "sql"],
    voice: "Хорошо, а если перед каждым списанием проверять, что ты всё ещё лидер? Под A спрашивает базу, видит, что аренды осталось ещё две секунды, и отправляет запрос в банк.",
  });
  d.term("Check-then-act");
  d.shot("", (w) => {
    advance(w, 5);
    acquire(w, "B");
    rest(w, "B");
    w.actors.A.atBank = false;
    renew(w, "A");
    w.actors.A.crossed = w.actors.A.thought;
    w.actors.A.thought = null;
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "leader", "bank", "board"],
    voice: "А банк сегодня отвечает целых пять секунд. Пока под A ждёт, аренда кончается, роль уходит к B, и тот снова списывает с Иры. Это всё тот же check-then-act: между проверкой и действием всегда остаётся окно.",
  });
  d.shot("", undefined, {
    focus: ["A", "bank"],
    voice: "Выходит, лидер просто не может сразу узнать, что его уже сменили. Значит, остановить дубль должен тот, кто принимает операцию, то есть банк.",
  });

  // 2.4 ⟲ Ключ: случайный — у каждого лидера свой; из бизнес-факта — один на всех.
  d.scene(ACT.key, splitStart(), { replay: true });
  d.attempt("случайный ключ");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: связь пропала";
    w.actors.A.acts = [];
    charge(w, "A", 42, randomKey("A", 42));
    cut(w, "A");
    rest(w, "A", (s) => randomKey("A", s), [17]);
    advance(w, 16);
    acquire(w, "B");
    rest(w, "B", (s) => randomKey("B", s));
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "bank", "board"],
    voice: "Вернёмся к двум лидерам. Ключ идемпотентности мы уже знаем, но в ролике про двойное списание его придумывало приложение, а здесь приложения нет. Возьми каждый лидер случайный ключ, и у A с B ключи окажутся разными, а банк спишет дважды.",
  });
  d.scene(ACT.key, splitStart(), { replay: true });
  d.attempt("ключ из факта");
  d.term("Deterministic idempotency key");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: ключ из факта";
    w.actors.A.acts = [];
    charge(w, "A", 42, factKey(42));
    cut(w, "A");
    rest(w, "A", factKey, [17]);
    advance(w, 16);
    acquire(w, "B");
    rest(w, "B", factKey);
    w.bank = "Подписка 42, ноябрь? Уже было.";
  }, {
    verdict: ["green", "green"], focus: ["A", "B", "bank", "board"],
    voice: "Поэтому ключ собираем из самого факта: подписка сорок два, ноябрь. Кто бы ни стал лидером, он соберёт тот же ключ, и банк узнает повтор и вернёт прежний результат. А от повтора через месяц нас бережёт уникальный индекс в charges по подписке и месяцу.",
  });
  const keyEnd = structuredClone(d.w);

  // Зачем тогда замок: без него три пода делают всю работу втроём.
  d.scene(ACT.why);
  d.shot("", (w) => {
    night(w);
    for (const id of ACTORS) {
      for (const s of SUBS) {
        charge(w, id, s.id, factKey(s.id));
        if (s.id === IRA) notify(w, id);
      }
    }
    w.ira.asleep = false;
  }, {
    focus: ["A", "B", "C", "bank", "ira"],
    voice: "Тогда зачем нам вообще замок? Без него все три пода делали бы всю работу втроём, банк гасил бы лишние запросы, а Ире всё равно пришло бы три уведомления. Замок экономит работу, а деньги бережёт ключ.",
  });
  d.scene(ACT.why, structuredClone(splitEnd), { replay: true });
  d.shot("", (w) => {
    w.shown.epoch = true;
    for (const id of ACTORS) w.actors[id].acts = [];
  }, {
    focus: ["leader"],
    voice: "И ещё одно. Если получатель записи наше собственное хранилище, лидеру выдают номер срока, и хранилище отбрасывает записи со старым номером. Это называют fencing token. Но банк таких номеров не проверяет, поэтому у нас ключ.",
  });

  // Итог — повтором уже виденных сцен.
  d.chapter(null);
  const recap = (saved: World, voice: string, patch?: (w: World) => void) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ACTORS) {
        x.actors[id].acts = structuredClone(saved.actors[id].acts);
        x.actors[id].crossed = saved.actors[id].crossed;
      }
      x.db = null;
      x.bank = saved.bank;
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
      patch?.(x);
    }, { voice });
  };
  recap(hookEnd, "Подведём итог. Сервис вырос до трёх подов, cron сработал в каждом, и с Иры ушло три платежа за один месяц.");
  recap(silentEnd, "Замок на число помог, пока поды умирали честно. Но держит его соединение, а не под: стоило узлу пропасть из сети, и работа встала до утра.");
  recap(splitEnd, "Аренда с часами базы решила это, но лидер не может знать, что его уже сменили, и два лидера списали дважды.");
  recap(keyEnd, "Спас нас тот, кто списывает: банк узнал повтор по ключу из подписки и месяца, и Ира заплатила за ноябрь один раз.", (x) => {
    x.ira.asleep = false;
  });

  return d.steps;
}
