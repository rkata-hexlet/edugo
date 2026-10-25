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
};

/** Код пода на Go: cron в каждом процессе. */
const GO = {
  cron: [
    "c := cron.New()",
    "c.AddFunc(\"0 3 * * *\", s.ChargeSubscriptions)",
    "c.Start()",
    "",
    "func (s *Service) ChargeSubscriptions() {",
    "  ctx := context.Background()",
    "  for _, sub := range s.dueToday(ctx) {",
    "    if err := s.bank.Charge(ctx, sub); err != nil {",
    "      continue",
    "    }",
    "    s.saveCharge(ctx, sub)",
    "  }",
    "}",
  ],
};

/** Мысли-заблуждения: висят, пока герой в них верит. */
const THINK = {
  leader: "Я лидер!",
  inTime: "Ещё 15 секунд — успею!",
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
  charges: "чарджез",
  idempotency: "идемпотенси",
  key: "кей",
  token: "токен",
  election: "илекшн",
  leader: "лидер",
  lock: "лок",
  Job: "джоб",
  Kubernetes: "кубернетес",
  "OOM Killer": "оом киллер",
  replica: "рэплика",
  every: "эври",
  "check-then-act": "чек зен экт",
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

/** Наивная задача целиком: банк и запись по каждой подписке. Уведомления Ира увидит утром — отдельным кадром. */
function runAll(w: World, who: ActorId): void {
  for (const s of SUBS) {
    charge(w, who, s.id);
    record(w, who, s.id);
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
    voice: "Помните Иру? В ролике про двойное списание мы научили сервис оплаты не списывать деньги дважды, даже когда приложение повторяет запрос: оно прикрепляло к каждой попытке ключ идемпотентности, idempotency key. Повтор с тем же ключом банк узнавал и отвечал сохранённым результатом.",
  });

  // Знакомство: ночь, подписки, cron.
  const intro = world();
  intro.shown.subs = false;
  intro.shown.charges = false;
  d.scene(ACT.intro, intro);
  d.shot("", undefined, {
    focus: ["ira", "A", "B", "C"],
    voice: "С тех пор сервис вырос, и подов у него теперь три. А Ира подключила подписку «Плюс» за двести девяносто девять рублей в месяц. Ира спит, но деньги всё равно должны списаться, и кто-то обязан сделать это за неё.",
  });
  d.shot("", (w) => {
    w.shown.subs = true;
    w.shown.charges = true;
  }, {
    focus: ["subs", "charges", "db"],
    voice: "Кого и когда списывать, сервис узнаёт из базы, из таблицы подписок. Подписка Иры здесь под номером сорок два, а рядом ещё Олег и Марта. Каждое удачное списание сервис записывает в таблицу charges.",
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
    voice: "Но подов-то теперь три! В три часа ночи cron срабатывает в каждом из них, и каждый берёт один и тот же список подписок.",
  });
  d.term("Cron on every replica");
  d.shot("", (w) => {
    for (const id of ACTORS) runAll(w, id);
    w.bank = "Три так три.";
  }, {
    focus: ["A", "B", "C", "bank", "ira"],
    voice: "И каждый, не зная о других, честно списывает плату за тот же самый месяц. С Иры уходит три платежа вместо одного, и с Олега с Мартой тоже. Это и называется cron on every replica: cron в каждой реплике.",
  });
  const hookEnd = structuredClone(d.w);
  d.shot("", (w) => {
    w.ira.asleep = false;
    for (const id of ACTORS) notify(w, id);
    w.db = "Одна задача. Три пода.";
  }, {
    focus: ["ira", "db"],
    voice: "Утром Ира просыпается и видит три уведомления вместо одного. Картина знакомая по ролику про очередь задач: там три пода отправили три письма, а здесь ушли три списания.",
  });
  d.shot("", (w) => {
    w.actors.A.acts.push({ kind: "bank", sub: 42, key: null, replayed: false });
    w.slot = true;
  }, {
    focus: ["A", "bank"],
    voice: "Внимательный зритель спросит: а где же ключ? Тот ключ ставило приложение на свои запросы. А ночная задача ходит в банк сама, приложения за ней нет, и ключа на её запросах тоже нет.",
  });

  // Норма: один делает, остальные подхватят.
  d.scene(ACT.norm);
  d.shot("", (w) => {
    night(w);
    rest(w, "A");
    w.actors.A.leader = true;
  }, {
    focus: ["A", "B", "C", "bank"],
    voice: "Что же мы хотим на самом деле? Чтобы ночью подписки списывал один под, а остальные ему не мешали.",
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
    voice: "Но этого мало. Если под упал посреди списка, кто-то должен доделать остальное и не списывать повторно с тех, с кого уже списали.",
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
  }, {
    sql: true, focus: ["A", "conn", "db", "sql"],
    voice: "Начнём с самого простого. Каждый под держит с базой соединение, и на нём можно повесить замок. Пусть поды договорятся о числе, скажем девять тысяч один, и работает тот, кто первым захватил на него замок. Это рекомендательный замок, advisory lock: база не знает, что он охраняет, для неё это просто число.",
  });
  d.term("Advisory lock");
  d.shot("", (w) => {
    for (const id of ["B", "C"] as const) {
      sql(w, id, SQL.lock);
      tryLock(w, id);
    }
    sql(w, "B", "-- false");
    sql(w, "C", "-- false");
    w.actors.C.asleep = true;
  }, {
    sql: true, focus: ["B", "C", "conn", "sql"],
    voice: "Поды B и C получают «занято», но не расходятся: они пробуют снова, скажем, раз в минуту. Иначе, если лидер упадёт, до следующей ночи работу никто не доделает. Так и появляется лидер: под, который сейчас держит замок.",
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
    voice: "И вот посреди списка под A убивает OOM Killer. Вместе с процессом закрывается его соединение, и база сама отпускает замок. Через минуту замок берёт под B, смотрит в таблицу charges и продолжает с того места, где остановился A.",
  });
  d.shot("", (w) => {
    w.db = "Починили? Ну-ну.";
  }, {
    focus: ["conn", "db"],
    voice: "Казалось бы, замок снимается всякий раз, когда умирает под. Но давайте проверим, что будет, если он умрёт тихо.",
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
    advance(w, 2 * 3600);
    tryLock(w, "B");
  }, {
    verdict: ["green", "red"], focus: ["A", "B", "conn", "ira", "board"],
    voice: "Часы идут, под B честно стучится каждую минуту, а замок по-прежнему занят. Чтобы понять, что соединение мертво, базе нужно время, и по умолчанию это больше двух часов. А значит, замок принадлежит не поду, а соединению, и всё это время списания стоят.",
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
    voice: "Тут вы, конечно, возразите: зачем весь этот замок, вынесите задачу в CronJob, и пусть Kubernetes запускает её один раз в отдельном поде.",
  });
  d.shot("", (w) => {
    charge(w, "A", 42);
    crash(w, "A");
    restart(w, "A");
    rest(w, "A");
  }, {
    verdict: ["red", "green"], focus: ["A", "bank", "charges", "board"],
    voice: "Но Job может упасть сразу после ответа банка, ещё до записи, и Kubernetes перезапустит его с начала списка. Документация и сама честно предупреждает: задача запускается примерно один раз, поэтому должна быть идемпотентной. Так что защита от повтора нам всё равно нужна.",
  });

  // КЕЙС 2: одно списание / доделают — тот же порядок, что в кейсе 1.
  d.scene(ACT.case2);
  d.chapter(2, ["одно списание", "доделают"]);
  d.shot("", (w) => {
    w.plate = "Кейс 2 из 2\nЛидер замолчал.\nКто доделает и не спишет дважды?";
  }, {
    hold: 2.5,
    voice: "Раз замок держится за соединение, нужен такой, который истекает сам. Привяжем его ко времени. А следим мы всё за тем же: чтобы каждую подписку списали один раз и чтобы работу доделали.",
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
    voice: "Заведём в базе строку: кто сейчас лидер и до какого времени. Срок, как и в ролике про очередь задач, отсчитывают часы самой базы, а не наши. Только теперь аренду берут на роль лидера, а не на отдельную задачу. Это и есть leader election, выбор лидера через аренду, lease.",
  });
  d.shot("", (w) => {
    charge(w, "A", 42);
    record(w, "A", 42);
    advance(w, 5);
    sql(w, "A", SQL.renew);
    renew(w, "A");
  }, {
    sql: true, focus: ["A", "leader", "sql"],
    voice: "Пока под A работает, он между списаниями продлевает аренду, каждый раз ещё на пятнадцать секунд.",
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
    voice: "Но вот под A пропадает, и продлений больше нет. Никто не следит, жив ли он. Просто когда под B снова приходит за ролью, база сверяет срок со своими часами, видит, что он вышел, и отдаёт роль поду B!",
  });
  d.shot("", (w) => {
    w.aside = "lease";
  }, {
    focus: ["leader"],
    voice: "Кстати, в Kubernetes для этого есть готовый объект Lease и библиотека выбора лидера. Устроены они на той же идее аренды и так же не гарантируют, что лидер всегда будет один.",
  });
  d.shot("", (w) => {
    w.db = "А если он жив?";
  }, {
    focus: ["A", "conn", "db"],
    voice: "Почему не гарантируют? Потому что под A мог и не умереть, а только потерять связь с базой.",
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
    voice: "Так и есть: на этот раз под A жив. Он успел списать деньги с Иры, но тут пропадает связь с базой, а до банка достучаться он по-прежнему может. Записать списание и продлить аренду он уже не в силах, а спросить, лидер ли он, ему не у кого. Поэтому он уверенно списывает дальше!",
  });
  d.term("Split brain");
  d.shot("", (w) => {
    advance(w, 16);
    acquire(w, "B");
    rest(w, "B");
    w.bank = "Дважды за ноябрь?";
  }, {
    verdict: ["red", "green"], focus: ["A", "B", "charges", "bank", "board"],
    voice: "Тем временем срок аренды вышел, и лидером становится под B. В таблице charges у подписки Иры пусто, ведь запись от A до базы так и не дошла, и под B списывает снова! Лидеров теперь два, это называют split brain, а у Иры двойной платёж.",
  });
  const splitEnd = structuredClone(d.w);

  // 2.3 Проверка аренды перед каждым списанием: проверил — и пауза.
  const checkStart = leased();
  night(checkStart);
  acquire(checkStart, "A");
  d.scene(ACT.check, checkStart);
  d.attempt("продление аренды");
  d.shot("", (w) => {
    advance(w, 13);
    sql(w, "A", SQL.renew);
    renew(w, "A");
    sql(w, "A", "-- UPDATE 1");
    w.actors.A.thought = THINK.inTime;
    w.bank = "Минутку…";
    charge(w, "A", 42);
    w.actors.A.atBank = true;
  }, {
    sql: true, focus: ["A", "leader", "bank", "sql"],
    voice: "Беда в том, что под A так и не узнал, что роль ушла. Ладно, тогда пусть лидер перед каждым списанием продлевает аренду и только потом идёт в банк. Под A продлевает её ещё на пятнадцать секунд и спокойно отправляет запрос.",
  });
  d.term("Check-then-act");
  d.shot("", (w) => {
    advance(w, 20);
    acquire(w, "B");
    rest(w, "B");
    w.actors.A.atBank = false;
    renew(w, "A");
    w.actors.A.crossed = w.actors.A.thought;
    w.actors.A.thought = null;
  }, {
    verdict: ["red", "green"], focus: ["A", "B", "leader", "bank", "board"],
    voice: "А банк сегодня отвечает целых двадцать секунд! Пока под A ждёт ответа, аренда кончается, роль уходит поду B, и тот снова списывает с Иры. Это всё тот же check-then-act: между проверкой и действием остаётся окно гонки, и проверка успевает устареть.",
  });
  d.shot("", undefined, {
    focus: ["A", "bank"],
    voice: "Выходит, сколько ни проверяй, лидер не может сразу узнать, что его уже сменили. С advisory lock было бы так же: оборвись соединение у живого пода, база отпустит замок, а сам под об этом не узнает. Значит, дубль должен остановить тот, кто принимает операцию, то есть банк.",
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
    verdict: ["red", "green"], focus: ["A", "B", "bank", "board"],
    voice: "Вернёмся к двум лидерам. Ключ идемпотентности мы уже знаем, но в ролике про двойное списание его придумывало приложение, а здесь приложения нет. Если каждый лидер возьмёт случайный ключ, у A и B ключи окажутся разными, и банк спишет дважды.",
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
    w.bank = "Подписка 42, ноябрь?\nУже было.";
  }, {
    verdict: ["green", "green"], focus: ["A", "B", "bank", "board"],
    voice: "Значит, ключ не должен зависеть от того, кто лидер, и мы собираем его из самого факта: подписка сорок два, ноябрь. Кто бы ни стал лидером, он соберёт тот же ключ, а банк узнает повтор и вернёт прежний результат.",
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
    voice: "Тогда напрашивается вопрос: зачем нам вообще замок? Без него все три пода делали бы всю работу втроём, банк отвечал бы на повторы сохранённым результатом, а Ире всё равно пришло бы три уведомления, ведь каждый под, получив ответ банка, шлёт своё. Замок экономит работу, а деньги бережёт ключ.",
  });
  d.scene(ACT.why, structuredClone(splitEnd), { replay: true });
  d.shot("", (w) => {
    w.shown.epoch = true;
    for (const id of ACTORS) w.actors[id].acts = [];
  }, {
    focus: ["leader"],
    voice: "И ещё одно. Если записи принимает не банк, а наше собственное хранилище, лидеру можно выдавать номер, который растёт при каждой смене лидера, и хранилище будет отбрасывать записи со старым номером. Это называют fencing token. Но банк таких номеров не проверяет, поэтому у нас ключ.",
  });

  // Итог — повтором уже виденных сцен.
  d.chapter(null);
  const recap = (saved: World, patch: ((w: World) => void) | undefined, voice: string) => {
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
  recap(hookEnd, (x) => {
    x.ira.notes = 3;
  }, "Подведём итог. Сервис вырос до трёх подов, cron сработал в каждом из них, и с Иры за один месяц ушло три платежа.");
  // Образ «узел пропал» звучит в итоге: событие исчезновения — из кадра 1.2, а снимок — с его конца.
  recap(silentEnd, (x) => {
    x.events.unshift({ kind: "silent", by: "A" });
  }, "Мы взяли advisory lock на число. Он помог, пока поды умирали честно, но держит его соединение, а не под, поэтому стоило узлу пропасть из сети — и работа встала на два с лишним часа.");
  recap(splitEnd, undefined, "Аренда с часами базы эту проблему решила, но лидер не может сразу узнать, что его сменили, и потому два лидера списали деньги дважды. Получился split brain.");
  // Финал — одно уведомление Ире: рифма с тремя в хуке.
  recap(keyEnd, (x) => {
    x.ira.asleep = false;
    notify(x, "B");
  }, "Спас нас тот, кто принимает операцию: банк узнал повтор по ключу из подписки и месяца, и Ира заплатила за ноябрь один раз.");

  return d.steps;
}
