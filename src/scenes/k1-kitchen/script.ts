import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { CREW, lagPoints, world, type Focus, type Seal, type Who, type World } from "./sim";

// Кадры «Внутренней кухни» — синхронно с docs/episodes/kitchen-01-late-emails.md (сценарий v1, 11.11).
// Диктора нет: сюжет несут реплики, хлопушки, штампы и подпись кадра. Голосом (синтез) звучат только три реплики
// режиссёра — `voice` в их кадрах. Слово «дубль» — только съёмочное; повторное письмо — «повтор».

export const ACT = {
  title: "Титул",
  s0: "0. Готовый трюк",
  s1: "1. Кастинг и спор",
  s2: "2. Замеры",
  s3: "3. Камера не видит",
  s4: "4. Репетиция трюков",
  s5: "5. Трюки на площадке",
  s6: "6. Каскадёр возвращается",
  s7: "7. CI — пересъёмка",
  credits: "Титры",
} as const;

/** Реплики режиссёра — единственные, что звучат голосом. Держит тест. */
export const DIRECTOR_LINES = ["Забудь.", "На площадку.", "Ещё раз."] as const;

export const OUTRO = "Проверку починки тоже проверяют — нарочным обманом";

/** Время кадра: база + чтение всего текста + пауза на хлопушку и штамп. */
export function holdFor(caption: string, w: World): number {
  const says = CREW.map((k) => w.crew[k].say ?? "");
  const text = [caption, w.title?.text ?? "", w.stop ?? "", ...(w.art?.lines ?? []), ...says, ...(w.credits ?? [])].join("");
  const extra = (w.clap ? 1.2 : 0) + (w.stop ? 1 : 0) + (w.title ? 1.5 : 0);
  return Math.round((1.6 + 0.045 * text.length + extra) * 10) / 10;
}

class Shots extends Director<Focus, World> {
  /** Сорванные дубли за весь ролик: мир каждой сцены свежий, счёт — сквозной. */
  failed = 0;

  constructor() {
    super(world);
  }

  protected hold(caption: string, w: World): number {
    return holdFor(caption, w);
  }

  protected clear(w: World): void {
    w.title = null;
    w.clap = null;
    w.stop = null;
    w.art = null;
    w.needle = false;
    w.failsShown = false;
    for (const k of CREW) w.crew[k].say = null;
  }

  protected finish(w: World): void {
    if (w.clap) w.events.push({ kind: "clap" });
    if (w.stop) w.events.push({ kind: "stop" });
    if (w.needle) w.events.push({ kind: "needle" });
  }

  protected carded(w: World): boolean {
    return !!w.title || !!w.credits;
  }

  // Глаголы сценария.
  enter(w: World, ...who: Who[]): void {
    for (const k of who) w.crew[k].on = true;
  }
  say(w: World, who: Who, text: string, mood: World["crew"][Who]["mood"] = "talk"): void {
    w.crew[who].say = text;
    w.crew[who].mood = mood;
  }
  calm(w: World, ...who: Who[]): void {
    for (const k of who) w.crew[k].mood = "idle";
  }
  clap(w: World, scene: string, take: number): void {
    w.clap = { scene, take };
  }
  stopTake(w: World, reason: string): void {
    w.stop = reason;
    w.fails = ++this.failed;
    w.failsShown = true;
  }
  seal(w: World, s: Seal): void {
    w.seals.push(s);
    w.events.push({ kind: "seal", lamps: [s.ok ? "green" : "red"] });
  }
}

const crewOnly = (): World => world();
const onStage = (): World => {
  const w = world();
  w.stage.on = true;
  w.inbox.on = true;
  return w;
};

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Титул.
  d.scene(ACT.title);
  d.shot("", (w) => {
    w.title = { head: "incident-lab", text: "Тренажёр для бэкендеров:\nживой сервис, настоящая поломка,\nпроверка починки" };
  });

  // 0. Готовый трюк — анимация, на стенде этот кадр не снят.
  d.scene(ACT.s0, onStage());
  d.shot("Распродажа. Письма о заказах опаздывают", (w) => {
    w.stage.sale = true;
  }, { focus: ["stage", "inbox"] });
  d.shot("Самая старая задача ждёт всё дольше", (w) => {
    w.chart = { on: true, points: lagPoints(6), alert: true };
    w.events.push({ kind: "alert" });
  }, { focus: ["chart"] });
  d.shot("Ученик чинит", (w) => {
    w.art = { title: "service/queue.go", lines: ["ORDER BY id LIMIT 1", "FOR UPDATE SKIP LOCKED"] };
  }, { focus: ["art"] });
  d.shot("", (w) => {
    w.stage.spread = true;
    w.chart.points = lagPoints(6, 4);
    w.chart.alert = false;
    w.inbox.letters = 52;
    w.events.push({ kind: "letters" }, { kind: "applause" });
    w.seals = [{ name: "Починка", ok: true, note: "принята" }];
  }, { focus: ["stage", "chart", "inbox", "seals"] });
  d.shot("", (w) => d.clap(w, "1", 1));

  // 1. Кастинг и спор.
  d.scene(ACT.s1, crewOnly());
  d.shot("", (w) => {
    d.enter(w, "director", "exec", "stunt", "arch");
    d.say(w, "exec", "Нагрузка тройная!");
  });
  d.shot("", (w) => {
    d.calm(w, "exec");
    d.say(w, "director", "Забудь.");
    d.stopTake(w, "дубль отменён режиссёром");
  }, { voice: "Забудь." });
  d.shot("Алерт видит сайт. А очередь — нет.", (w) => d.calm(w, "director"));
  d.shot("", (w) => d.say(w, "arch", "Поставим зонд в сервис"));
  d.shot("", (w) => {
    d.calm(w, "arch");
    d.say(w, "stunt", "Зонд верит коду ученика.\nЗаглушка его обманет");
  });
  d.shot("Метрику берём снаружи. Зонд пригодится другим сюжетам", (w) => {
    d.calm(w, "stunt");
    w.crew.arch.mood = "lost";
  });
  d.shot("", (w) => {
    w.crew.arch.mood = "idle";
    d.say(w, "stunt", "Проверите задержку —\nзавалите позднюю верную починку");
  });
  d.shot("Заказы проверки встают в хвост и не успевают", (w) => {
    d.calm(w, "stunt");
    w.stage = { ...w.stage, on: true, queue: 6, tail: "+30 000" };
  }, { focus: ["stage"] });
  d.shot("Судим по скорости отправки, а не по задержке", (w) => {
    w.crew.stunt.mood = "won";
  });
  d.shot("", (w) => {
    w.stage.on = false;
    d.calm(w, "stunt");
    d.say(w, "exec", "А ждущий получит ноль строк!");
  });
  d.shot("", (w) => {
    d.calm(w, "exec");
    d.say(w, "stunt", "При хвосте — возьмёт следующую");
  });
  d.shot("", (w) => {
    d.calm(w, "stunt");
    d.say(w, "director", "На площадку.");
  }, { voice: "На площадку." });

  // 2. Замеры.
  d.scene(ACT.s2, onStage());
  d.shot("", (w) => {
    d.enter(w, "exec", "stunt");
    d.clap(w, "2", 1);
  });
  d.shot("Три сессии psql держат строку по секунде", (w) => {
    w.art = { title: "psql × 3", lines: ["A  → строка 1", "B  ждёт 1 с → строка 2", "C  ждёт 2 с → строка 3"] };
  }, { focus: ["art"] });
  d.shot("Прав каскадёр", (w) => d.say(w, "exec", "…снимаю", "lost"));
  d.shot("Сколько обработчиков ни ставь", (w) => {
    d.calm(w, "exec");
    w.art = { title: "писем за 20 с", lines: ["1 обработчик   131", "4 обработчика  131", "8 обработчиков 131"] };
  }, { focus: ["art", "stage"] });
  d.shot("Каждый держит строку всё письмо:\n150 мс сети внутри транзакции", (w) => {
    w.stage.sale = true;
  }, { focus: ["stage"] });
  d.shot("", (w) => {
    w.stage.workers = 16;
    w.art = { title: "psql", lines: ["FATAL: sorry, too many clients already"] };
    d.stopTake(w, "too many clients");
  }, { focus: ["art"] });
  d.shot("Площадку арендовали у сюжета про пул соединений —\nего сервис съел все соединения базы", (w) => {
    w.stage.host = "busy";
  }, { focus: ["stage"] });
  d.shot("kill -STOP: хозяина площадки заморозили", (w) => {
    d.clap(w, "2", 2);
    w.stage.host = "frozen";
    w.events.push({ kind: "freeze" });
  }, { focus: ["stage"] });
  d.shot("Индекс по новым задачам остаётся", (w) => {
    w.stage.workers = 8;
    w.stage.spread = true;
    w.art = { title: "писем в секунду", lines: ["8 + SKIP LOCKED      52", "без индекса          40"] };
  }, { focus: ["art", "stage"] });
  d.shot("", (w) => d.say(w, "stunt", "Сходится", "won"));

  // 3. Камера не видит.
  d.scene(ACT.s3, onStage());
  d.shot("Сайт здоров, а письма не идут", (w) => {
    d.clap(w, "3", 1);
    w.stage.sale = true;
    w.art = { title: "сайт", lines: ["ошибок   0%", "ответ    3 мс", "алерт    тишина"] };
  }, { focus: ["art", "inbox"] });
  d.shot("Новая камера: «самая старая задача ждёт N с»", (w) => {
    w.chart = { on: true, points: lagPoints(6), alert: true };
    w.events.push({ kind: "alert" });
  }, { focus: ["chart"] });
  d.shot("Проверка проверки: порог выключен нарочно", (w) => {
    d.enter(w, "exec", "stunt");
    w.art = { title: "go test", lines: ["--- FAIL: TestAlertReason"] };
  }, { focus: ["art", "exec"] });
  d.shot("Тест краснеет — как и должен. Вторая порча даже не собралась", (w) => {
    d.say(w, "stunt", "Так и надо", "won");
  });

  // 4. Репетиция трюков.
  d.scene(ACT.s4, crewOnly());
  d.shot("18 трюков в копии сервиса —\nчтобы не тратить час на виртуалке", (w) => {
    d.enter(w, "exec", "stunt", "director");
    d.clap(w, "4", 1);
    w.tricks = { honest: 6, fake: 12 };
    w.events.push({ kind: "tricks" });
  });
  d.shot("", (w) => {
    w.art = { title: "go build", lines: ["\"errors\" imported and not used"] };
    d.stopTake(w, "трюк не собрался");
  }, { focus: ["art"] });
  d.shot("", (w) => {
    d.say(w, "exec", "Прикрою строчкой");
    w.art = { title: "repairs", lines: ["_, _, _ = id, orderID, errors.Is(nil, sql.ErrNoRows)"] };
  }, { focus: ["art", "exec"] });
  d.shot("Поправили до площадки", (w) => {
    d.calm(w, "exec");
    d.say(w, "stunt", "Ну и костыль", "lost");
  });

  // 5. Трюки на площадке — кульминация.
  d.scene(ACT.s5, crewOnly());
  d.shot("Ложный трюк пойман — значит, проверка отработала", (w) => {
    d.enter(w, "exec", "stunt", "director");
    d.clap(w, "5", 1);
    d.seal(w, { name: "Без починки", ok: true, note: "алерт через 2:07" });
  }, { focus: ["seals"] });
  d.shot("Шлюз разгребает и хвост", (w) => {
    d.seal(w, { name: "SKIP LOCKED, поздно", ok: true, note: "620 писем на 400 заказов" });
  }, { focus: ["seals"] });
  d.shot("", (w) => {
    d.seal(w, { name: "Просто убрали FOR UPDATE", ok: true, note: "повторы у 79 заказов" });
  }, { focus: ["seals"] });
  d.shot("Очередь вдвое длиннее — писем столько же", (w) => {
    d.seal(w, { name: "16 обработчиков", ok: true, note: "писем не прибавилось" });
  }, { focus: ["seals"] });
  d.shot("Эталонный путь — так сюжет проходит ученик", (w) => d.clap(w, "5", 2));
  d.shot("", (w) => {
    d.seal(w, { name: "Эталонный путь", ok: false, note: "шаг «что в логах»" });
    d.stopTake(w, "улика не найдена");
  }, { focus: ["seals"] });
  d.shot("«очередь писем» — раз в 10 с,\nа svc logs видит последние 50 строк — меньше двух секунд", (w) => {
    w.needle = true;
    w.art = { title: "svc logs", lines: ["GET /orders 200 3ms", "POST /orders 201 4ms", "GET /orders 200 2ms", "…"] };
  }, { focus: ["art"] });
  d.shot("", (w) => d.say(w, "exec", "grep 'очередь писем'", "work"));
  d.shot("", (w) => {
    d.calm(w, "exec");
    d.clap(w, "5", 3);
    w.seals[w.seals.length - 1] = { name: "Эталонный путь", ok: true, note: "дубль 2" };
    w.events.push({ kind: "seal", lamps: ["green"] });
  }, { focus: ["seals"] });
  d.shot("Через минуту", (w) => d.say(w, "stunt", "Эталонный путь будет падать\nв половине прогонов!"));
  d.shot("", (w) => {
    d.calm(w, "stunt");
    d.say(w, "exec", "— Уже.", "won");
  });

  // 6. Каскадёр возвращается.
  d.scene(ACT.s6, onStage());
  d.shot("", (w) => {
    d.enter(w, "stunt", "exec");
    d.clap(w, "6", 1);
    d.say(w, "stunt", "А таймаут простоя транзакции?");
  });
  d.shot("База рвёт обработчик — строка возвращается в очередь,\nи письмо уходит снова", (w) => {
    d.calm(w, "stunt");
    w.inbox.letters = 2;
    w.inbox.repeats = 1;
    w.events.push({ kind: "letters" });
  }, { focus: ["stage", "inbox"] });
  d.shot("Письмо — то же. Раз за разом", (w) => {
    w.inbox.letters = 88;
    w.inbox.repeats = 87;
    w.events.push({ kind: "letters" });
  }, { focus: ["inbox"] });
  d.shot("Проверка трюк валила — писем мало.\nНо подсказка ученику говорила не о том", (w) => {
    d.stopTake(w, "подсказка не о том");
  });
  d.shot("Шлюз научили считать повторы", (w) => {
    w.art = { title: "проверка", lines: ["88 писем, из них 87 повторных"] };
  }, { focus: ["art"] });
  d.shot("Ловится по времени ответа сайта", (w) => {
    d.say(w, "stunt", "И письмо прямо при оформлении заказа");
    w.tricks = { honest: 6, fake: 14 };
    w.events.push({ kind: "tricks" });
  });
  d.shot("Снимок для разбора", (w) => {
    d.enter(w, "method");
    d.calm(w, "stunt");
    d.say(w, "method", "Ждут tuple");
    d.say(w, "stunt", "Точно tuple");
    w.stage.on = false;
    w.inbox.on = false;
  });
  d.shot("На стенде — transactionid", (w) => {
    d.say(w, "method", "…", "lost");
    d.say(w, "stunt", "…", "lost");
    w.art = { title: "pg_stat_activity", lines: ["Lock | transactionid | 7", "держатель: idle in transaction"] };
  }, { focus: ["art"] });
  d.shot("В разбор — настоящий вывод со стенда", (w) => d.calm(w, "method", "stunt"));

  // 7. CI — пересъёмка.
  d.scene(ACT.s7, crewOnly());
  d.shot("Строку алерта переписали", (w) => {
    d.enter(w, "exec", "director");
    d.clap(w, "7", 1);
    w.art = { title: "алерт", lines: ["отставание 30 с за 10 с", "→ самая старая задача ждёт 30 с"] };
  }, { focus: ["art"] });
  d.shot("Пуш. CI гоняет все 22 случая на чужих машинах", (w) => {
    w.art = { title: "CI", lines: ["e2e · changed · идёт 14 мин"] };
  }, { focus: ["art"] });
  d.shot("Пуш с этой правкой отменил прогон", (w) => {
    w.art = { title: "CI", lines: ["e2e · cancelled"] };
    d.stopTake(w, "прогон отменён");
  });
  d.shot("", (w) => {
    d.say(w, "director", "Ещё раз.");
    d.clap(w, "7", 2);
  }, { voice: "Ещё раз." });
  d.shot("Итог прогона — дописать", (w) => d.calm(w, "director"));

  // Титры.
  d.scene(ACT.credits, crewOnly());
  d.shot("", (w) => {
    d.enter(w, "director", "arch", "method", "exec", "stunt");
    w.tricks = { honest: 6, fake: 14 };
    w.fails = d.failed;
    w.credits = ["20 трюков: 6 честных, 14 ложных", "22 случая e2e", `${d.failed} сорванных дублей`];
  });
  d.shot(OUTRO, (w) => {
    for (const k of ["director", "arch", "method", "exec"] as const) w.crew[k].bow = true;
    w.events.push({ kind: "applause" });
  });
  d.shot("", (w) => {
    w.crew.stunt.bow = true;
    w.crew.stunt.mood = "won";
  }, { focus: ["stunt"] });

  return d.steps;
}
