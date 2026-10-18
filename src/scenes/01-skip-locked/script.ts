import type { Step } from "../../engine/contract";
import {
  claimLease, commit, complete, deliver, selectTask, updateTask, world,
  type ActorId, type LockMode, type Place, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/01-skip-locked.md (сценарий v2).

export const ACT = {
  hook: "0. Хук",
  race: "1. Нормальный мир → час пик",
  naive: "2. Наивные фиксы",
  crowd: "3a. Толпа",
  convoy: "3b. Конвой",
  skip: "3c. Обход",
  lease: "4. Курьер завис",
  zombie: "5. Два B",
  cheat: "6. Шпаргалка",
} as const;

const SQL = {
  select: (lock: LockMode) =>
    "SELECT id FROM tasks WHERE status='new'\n  ORDER BY id LIMIT 1" +
    (lock === "for_update" ? " FOR UPDATE" : lock === "skip_locked" ? "\n  FOR UPDATE SKIP LOCKED" : ""),
  take: (id: number) => `UPDATE tasks SET status='in_progress' WHERE id=${id}`,
  takeIfNew: (id: number) => `UPDATE tasks SET status='in_progress'\n  WHERE id=${id} AND status='new'`,
  claim:
    "UPDATE tasks SET status='in_progress',\n" +
    "       claim_token=gen_random_uuid(), lease_until=now()+'30s'\n" +
    " WHERE id = (SELECT id FROM tasks\n" +
    "   WHERE status='new'\n" +
    "      OR (status='in_progress' AND lease_until < now())\n" +
    "   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)\n" +
    "RETURNING id, claim_token",
  doneByToken: (id: number, token: string) =>
    `UPDATE tasks SET status='done'\n  WHERE id=${id} AND claim_token='${token}'`,
};

const home: Place = { kind: "home" };
const road: Place = { kind: "road" };
const door: Place = { kind: "door" };
const shelf = (row: number): Place => ({ kind: "shelf", row });

class Director {
  readonly steps: Step<World>[] = [];
  w: World = world();
  private act = "";

  scene(act: string, w: World = world()): void {
    this.act = act;
    this.w = w;
  }

  /** Применить действия и записать кадр. Реплики, SQL и титры живут один кадр. */
  shot(caption: string, action?: (w: World) => void): void {
    const w = this.w;
    w.sql = [];
    w.db = null;
    w.client = null;
    w.race = false;
    w.card = null;
    for (const a of Object.values(w.actors)) a.say = null;
    action?.(w);
    this.steps.push({ act: this.act, caption, state: structuredClone(w) });
  }
}

// --- Глаголы сценария: операции модели + реплики и перемещения ---

function say(w: World, who: ActorId, line: string | null, sql?: string): void {
  w.actors[who].say = line;
  if (sql) w.sql.push(`${w.actors[who].label} ▸ ${sql}`);
}

/** Подойти к стеллажу и выбрать задачу; встать у найденной полки или в очередь. */
function look(w: World, who: ActorId, lock: LockMode = "none", line: string | null = null): void {
  selectTask(w, who, lock);
  place(w, who);
  say(w, who, line, SQL.select(lock));
}

/** Поставить воркера туда, где его держит запрос: в очередь за замком или к найденной полке. */
function place(w: World, who: ActorId): void {
  const a = w.actors[who];
  if (a.scan?.waitingFor != null) a.at = { kind: "queue", row: a.scan.waitingFor };
  else if (a.seen !== null) a.at = shelf(a.seen);
}

/** UPDATE по id без проверок + COMMIT: посылка в руках. */
function take(w: World, who: ActorId, id: number): void {
  updateTask(w, who, id, { status: "in_progress" });
  commit(w, who);
  w.actors[who].carrying = id;
  say(w, who, null, `${SQL.take(id)}; COMMIT`);
}

/** Условный UPDATE … AND status='new' + COMMIT; берёт, только если задел строку. */
function takeIfNew(w: World, who: ActorId, id: number, loserLine: string): void {
  updateTask(w, who, id, { status: "in_progress" }, (d) => d.status === "new");
  commit(w, who);
  const won = w.actors[who].affected === 1;
  if (won) w.actors[who].carrying = id;
  say(w, who, won ? "моя!" : loserLine, `${SQL.takeIfNew(id)}; COMMIT  → ${won ? 1 : 0} строк`);
}

/** Довезти до двери и отметить done (без талонов). */
function drop(w: World, who: ActorId, id: number): void {
  w.actors[who].at = door;
  deliver(w, who, id);
  complete(w, who, id, false);
  w.actors[who].carrying = null;
}

function grabWithLease(w: World, who: ActorId): number {
  const id = claimLease(w, who);
  if (id === null) throw new Error(`сценарий: ${who} не нашёл задачу`);
  const a = w.actors[who];
  a.at = shelf(id);
  a.carrying = id;
  say(w, who, `талон #${a.token}`, SQL.claim);
  return id;
}

export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `12:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Финал акта 5 у двери: idempotent=false — версия хука (клиент без ключа заказа). */
function doorFinale(w: World, idempotent: boolean): void {
  const b = w.actors.B;
  b.at = door;
  deliver(w, "B", 1, idempotent);
  complete(w, "B", 1, true);
  b.carrying = null;
  const b2 = w.actors.B2;
  b2.at = door;
  deliver(w, "B2", 1, idempotent);
  complete(w, "B2", 1, true);
  b2.carrying = null;
}

export function buildSteps(): Step<World>[] {
  const d = new Director();

  // 1. Нормальный мир → час пик.
  d.scene(ACT.race);
  d.shot("Сортировочный цех. Стеллаж — таблица tasks, полки — строки. Курьеры — три пода одного сервиса.");
  d.shot("Pod A спрашивает: что свободно? Первая новая — #1.", (w) => look(w, "A", "none", "что свободно?"));
  d.shot("A помечает #1 «в работе». До COMMIT правку видит только он (жёлтая), а строка под замком.", (w) => {
    updateTask(w, "A", 1, { status: "in_progress" });
    say(w, "A", null, SQL.take(1));
  });
  d.shot("COMMIT — теперь «в работе» видят все. Замок снят.", (w) => {
    commit(w, "A");
    w.actors.A.carrying = 1;
    w.actors.A.at = road;
    say(w, "A", null, "COMMIT");
    w.db = "Бери. Распишись. Следующий.";
  });
  d.shot("B приходит позже: #1 уже в работе, ему достаётся #2.", (w) => {
    drop(w, "A", 1);
    look(w, "B");
  });
  d.shot("Работает. Пока курьеры не приходят одновременно.", (w) => {
    w.actors.A.at = home;
    take(w, "B", 2);
    w.actors.B.at = road;
  });
  d.shot("Час пик. A подходит к стеллажу: свободна #3.", (w) => {
    drop(w, "B", 2);
    look(w, "A", "none", "полка 3 свободна!");
  });
  d.shot("B смотрит долей секунды позже. A ещё ничего не записал — для B #3 тоже свободна.", (w) => {
    look(w, "B", "none", "полка 3 свободна!");
    say(w, "A", "полка 3 свободна!");
    w.race = true;
    w.db = "Была. Когда вы смотрели.";
  });
  d.shot("Стоп-кадр. Посмотреть и взять — два шага. Между ними влезет сосед.", (w) => {
    w.race = true;
    w.card = "ОКНО ГОНКИ\n\nSELECT ──── сюда влезет сосед ──── UPDATE";
    w.db = "Я показываю только то, что уже записано.\nЧто будет через миг — не моё дело.";
  });
  d.shot("A берёт #3. B тоже: его UPDATE ставит статус по id и ничего не проверяет.", (w) => {
    take(w, "A", 3);
    take(w, "B", 3);
  });
  d.shot("Дубль: клиент получил #3 дважды.", (w) => {
    drop(w, "A", 3);
    drop(w, "B", 3);
    w.client = "Две одинаковые?!";
  });

  // 2. Наивные фиксы — монтаж.
  d.scene(ACT.naive);
  d.shot("Фикс №1: перед UPDATE ещё раз проверим статус.", (w) => {
    look(w, "A");
    look(w, "B");
  });
  d.shot("Оба перепроверили — оба видят new. Окно гонки не закрылось. Оно переехало.", (w) => {
    look(w, "A", "none", "точно new? ✓");
    look(w, "B", "none", "точно new? ✓");
    w.race = true;
  });
  d.shot("И снова оба взяли #1.", (w) => {
    take(w, "A", 1);
    take(w, "B", 1);
  });
  d.scene(ACT.naive);
  d.shot("Фикс №2: обернём GetTasks в sync.Mutex.", (w) => {
    w.actors.B.mutex = true;
    say(w, "B", "Я повесил замок!");
    w.db = "На свой рюкзак.";
  });
  d.shot("A тоже берёт мьютекс — свой. Mutex видит только свой под; соседи — в других процессах.", (w) => {
    w.actors.A.mutex = true;
    look(w, "A", "none", "mu.Lock() ✓");
    look(w, "B");
    w.race = true;
  });
  d.shot("Договариваться надо в базе.", (w) => {
    w.actors.A.mutex = false;
    w.actors.B.mutex = false;
    w.card = "Внутри кода пода это не чинится.\nОбщее у подов — только база.";
  });

  // 3a. Толпа: условный UPDATE.
  d.scene(ACT.crowd);
  d.shot("Способ 1: условный UPDATE — «бери, только если всё ещё new», и проверь, сколько строк задел.", (w) => {
    look(w, "A");
    look(w, "B");
    look(w, "C");
  });
  d.shot("Кто первый отметил — того и полка. Остальным — ноль строк.", (w) => {
    takeIfNew(w, "A", 1, "");
    takeIfNew(w, "B", 1, "0 строк…");
    takeIfNew(w, "C", 1, "0 строк…");
  });
  d.shot("Проигравшие бегут к #2 — и снова толпа.", (w) => {
    w.actors.A.at = road;
    look(w, "B");
    look(w, "C");
  });
  d.shot("Корректно: дублей нет. Но каждая полка — толкотня, и кто-то всегда проигрывает.", (w) => {
    takeIfNew(w, "C", 2, "");
    takeIfNew(w, "B", 2, "Опять ноль строк…");
  });

  // 3b. Конвой: FOR UPDATE.
  d.scene(ACT.convoy);
  d.shot("Способ 2: SELECT … FOR UPDATE. A берёт #1 и вешает замок до конца своей транзакции.", (w) =>
    look(w, "A", "for_update"));
  d.shot("B хочет то же и встаёт в очередь. Замок держит база — поэтому его видят все поды.", (w) => {
    look(w, "B", "for_update");
    w.db = "Занято. Жди.";
  });
  d.shot("C — за ним. Хотя #2, #3 и #4 свободны.", (w) =>
    look(w, "C", "for_update", "Я стою за тем, кто стоит за тем, кто держит."));
  d.shot("Сколько ждёт B? Ровно столько, сколько длится транзакция A.", (w) => {
    w.clock += 3;
    updateTask(w, "A", 1, { status: "in_progress" });
    say(w, "A", "не тороплюсь…", SQL.take(1));
  });
  d.shot("COMMIT. B перепроверил #1 — уже не new — и взял #2. А C теперь ждёт B: замок на #1 перешёл к нему.", (w) => {
    commit(w, "A");
    w.actors.A.carrying = 1;
    w.actors.A.at = road;
    place(w, "B");
    place(w, "C");
    say(w, "B", "#2!");
  });
  d.shot("B закончил — C тащится дальше: #1 и #2 уже в работе, ему #3. Конвой.", (w) => {
    w.clock += 3;
    updateTask(w, "B", 2, { status: "in_progress" });
    commit(w, "B");
    w.actors.B.carrying = 2;
    w.actors.B.at = road;
    place(w, "C");
  });
  d.shot("Дублей нет. Зато ждёшь, пока чужая транзакция договорит.", (w) => {
    w.card = "FOR UPDATE: дублей нет,\nно все стоят в очереди за замком.";
  });

  // 3c. Обход: SKIP LOCKED.
  d.scene(ACT.skip);
  d.shot("Способ 3: FOR UPDATE SKIP LOCKED. A берёт #1 под замок.", (w) => look(w, "A", "skip_locked"));
  d.shot("B видит замок, пожимает плечами и берёт следующую.", (w) =>
    look(w, "B", "skip_locked", "Занято? Ну и ладно."));
  d.shot("C — #3. Никто никого не ждёт.", (w) => {
    look(w, "C", "skip_locked");
    w.db = "Наконец-то воспитанный.";
  });
  d.shot("Все трое отмечают свои посылки и коммитят.", (w) => {
    for (const who of ["A", "B", "C"] as const) {
      const id = w.actors[who].seen!;
      take(w, who, id);
      w.actors[who].at = road;
    }
  });
  d.shot("Без дублей и без очереди.", (w) => {
    drop(w, "A", 1);
    drop(w, "B", 2);
    drop(w, "C", 3);
    w.card = "FOR UPDATE SKIP LOCKED\nЗанято — иди к следующей.";
  });

  // 4. Курьер завис → талон.
  d.scene(ACT.lease);
  d.shot("Ну всё, починили?", (w) => {
    w.card = "Починили! 🎉";
  });
  d.shot("Доставка долгая. Держать транзакцию — и замок — всё это время дорого.", (w) => {
    look(w, "B", "skip_locked");
    w.actors.B.carrying = 1;
    w.actors.B.at = road;
    w.card = "Держать транзакцию всю доставку:\n• занято соединение из пула\n• VACUUM не может подмести\n• завис курьер — замок навсегда";
  });
  d.shot("B завис на внешнем API без таймаута. Он жив, соединение открыто — #1 под замком.", (w) => {
    w.clock = 5;
    w.actors.B.frozen = true;
    say(w, "B", "📞 …");
    w.db = "Упал бы — я бы сам снял замки.\nХуже, когда живой и молчит.";
  });
  d.shot("Проходит 10 минут. Остальные обходят #1 — а её никто не везёт.", (w) => {
    w.clock = 600;
    look(w, "A", "skip_locked");
    look(w, "C", "skip_locked");
  });
  d.scene(ACT.lease);
  d.shot("Решение: короткая транзакция выдаёт талон с номером и сроком — и сразу COMMIT.", (w) => {
    w.card = "Взял талон — закрыл транзакцию.\nРаботай без замка на складе.";
  });
  d.shot("B получил талон до 12:00:30. Замка на складе нет — транзакция уже закрыта.", (w) => {
    grabWithLease(w, "B");
    w.db = "Я не держу полки вечно. Талон до 12:00:30.\nПо моим часам.";
  });
  d.shot("12:00:05. B снова завис на том же API.", (w) => {
    w.clock = 5;
    w.actors.B.at = road;
    w.actors.B.frozen = true;
    say(w, "B", "📞 …");
  });
  d.shot("12:00:31. Срок по часам склада вышел.", (w) => {
    w.clock = 31;
    w.db = "Талон #7f3a просрочен.";
  });
  d.shot("Другой воркер того же пода B подбирает просроченную #1 — с новым талоном.", (w) => {
    w.actors.B2.present = true;
    grabWithLease(w, "B2");
  });
  d.shot("Посылка снова едет.", (w) => {
    w.actors.B2.at = road;
  });
  const afterLease = structuredClone(d.w);

  // 5. Два B → та же дверь.
  d.scene(ACT.zombie, structuredClone(afterLease));
  d.shot("12:00:40. Старый воркер B отвис. Он не знает, сколько простоял.", (w) => {
    w.clock = 40;
    w.actors.B.frozen = false;
    say(w, "B", "По моим — ещё 12:00:20!");
    w.db = "Здесь время — моё.";
  });
  d.shot("Имя одно на двоих. Различает их только талон.", (w) => {
    say(w, "B", "Я — B.");
    say(w, "B2", "Нет, я — B.");
    w.db = "Мне всё равно, как вас зовут.\nТалон покажите.";
  });
  d.shot("Старый B отмечает доставку по талону #7f3a — 0 строк. Запись на складе цела. Но посылка уже у клиента.", (w) => {
    const b = w.actors.B;
    b.at = door;
    deliver(w, "B", 1, true);
    complete(w, "B", 1, true);
    b.carrying = null;
    say(w, "B", "…а посылку я уже отвёз.", `${SQL.doneByToken(1, "7f3a")}  → 0 строк`);
    w.db = "Талон #7f3a сгорел.\nСейчас действует #c21e.";
  });
  d.shot("Новый B приходит к той же двери. Клиент узнаёт заказ по ключу.", (w) => {
    const b2 = w.actors.B2;
    b2.at = door;
    deliver(w, "B2", 1, true);
    complete(w, "B2", 1, true);
    b2.carrying = null;
    say(w, "B2", null, `${SQL.doneByToken(1, "c21e")}  → 1 строка`);
    w.client = "Заказ 42? Уже получил. Спасибо.";
  });
  d.shot("Доставка — минимум один раз. «Ровно один» обеспечивает дверь.", (w) => {
    w.db = "Ровно один раз? Это не ко мне. Это к двери.";
    w.card = "Склад бережёт свою запись.\nДвойной эффект ловит получатель.";
  });

  // 6. Шпаргалка.
  d.scene(ACT.cheat);
  d.shot("Шпаргалка для собеседования.", (w) => {
    w.card =
      "UPDATE tasks SET status='in_progress',\n" +
      "       claim_token=gen_random_uuid(), attempts=attempts+1,\n" +
      "       lease_until=now()+interval '30s'\n" +
      " WHERE id IN (SELECT id FROM tasks\n" +
      "   WHERE (status='new' OR (status='in_progress' AND lease_until<now()))\n" +
      "     AND attempts < 5\n" +
      "   ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)\n" +
      "RETURNING id, claim_token;\n\n" +
      "done / продление — только WHERE id=$1 AND claim_token=$2\n" +
      "индекс: ON tasks(id) WHERE status='new' + по lease_until\n" +
      "attempts ≥ 5 → полка возвратов · порядок — не строгий FIFO\n" +
      "эффекты идемпотентны: доставка at-least-once";
  });

  // 0. Хук — тот же финал акта 5, но клиент без ключа заказа. Ставится в начало.
  const hook = new Director();
  hook.scene(ACT.hook, structuredClone(afterLease));
  hook.shot("Оба курьера всё сделали правильно. Клиенту списали дважды.", (w) => {
    w.clock = 40;
    w.actors.B.frozen = false;
    doorFinale(w, false);
    w.client = "Списано дважды?!";
    w.card = "Как так?";
  });

  return [...hook.steps, ...d.steps];
}
