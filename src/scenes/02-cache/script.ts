import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  HOT, L1_TTL, NEW, OLD, TTL, addRedis, click, commit, crash, del, get, publish, reply, select, set, update, world,
  type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/02-cache.md (сценарий v2, покадрово).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  hook: "0. Хук",
  intro: "Знакомство",
  case1: "Кейс 1",
  hour: "1.1 Кэш на час",
  short: "1.2 Короткий TTL",
  delFirst: "1.3 Удалить, потом база",
  dbFirst: "1.4 База, потом удалить",
  lost: "1.5 DEL не дошёл",
  case2: "Кейс 2",
  hot: "2.1 Горячий ключ",
  nodes: "2.2 Больше узлов",
  local: "2.3 Локальный кэш",
  pubsub: "2.4 Рассылка «сбрось»",
  summary: "Итог",
} as const;

const SQL = {
  get: `GET ${HOT}`,
  select: `SELECT long_url FROM links\n  WHERE code='${HOT}'`,
  set: (url: string, ttl: number) => `SET ${HOT} '${url}' EX ${ttl}`,
  del: `DEL ${HOT}`,
  update: `BEGIN;\nUPDATE links SET long_url='${NEW}'\n  WHERE code='${HOT}'`,
  publish: `PUBLISH invalidate ${HOT}`,
};

/**
 * Исключения произношения для синтеза; экран и субтитр не меняются.
 * Буквы подов — по-русски (решение пользователя для серии).
 */
export const PRONOUNCE: Record<string, string> = {
  A: "а",
  B: "бэ",
  C: "цэ",
  L1: "эль один",
  "404": "четыреста четыре",
};

/** Время кадра без голоса: база + чтение текста в кадре. */
export function holdFor(caption: string, w: World): number {
  const text = [caption, w.plate ?? "", w.stamp ?? "", w.db ?? "", ...w.sql].join("");
  return Math.round((1.5 + 0.035 * text.length) * 10) / 10;
}

/** Сверх общего: итог — повтор уже виденного; журнал браузеров — последние шесть строк. */
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
  }

  protected override finish(w: World): void {
    w.clicks = w.clicks.slice(-6); // в журнал браузеров влезает шесть строк
    w.replay = this.replaying;
  }
}

// --- Глаголы сценария: операции модели + команды в SQL-панели. Поды не двигаются — двигаются стрелки. ---

function sql(w: World, who: ActorId, text: string): void {
  w.sql.push(`${w.actors[who].label} ▸ ${text}`);
}

function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
}

/** Клик с командами в панели: GET [→ промах → SELECT → SET]. */
function visit(w: World, who: ActorId, ttl = TTL): void {
  const before = w.actors[who];
  const pocketed = w.l1 && before.l1 && before.l1.expiresAt > w.clock;
  click(w, who, ttl);
  if (pocketed || !w.redis) return;
  const a = w.actors[who];
  const hit = a.acts.some((x) => x.kind === "get" && x.hit);
  sql(w, who, `${SQL.get}  ${hit ? `-- '${a.hand}'` : "-- (nil)"}`);
  if (!hit) {
    sql(w, who, `${SQL.select}  -- '${a.hand}'`);
    sql(w, who, SQL.set(a.hand!, ttl));
  }
}

/** Автор правит ссылку через под A: BEGIN; UPDATE (без COMMIT). */
function edit(w: World): void {
  update(w, "A", NEW);
  sql(w, "A", SQL.update);
}

function commitEdit(w: World): void {
  commit(w, "A");
  w.actors.A.editing = false;
  sql(w, "A", "COMMIT");
}

function delKey(w: World): void {
  const n = del(w, "A");
  sql(w, "A", `${SQL.del}  -- ${n}`);
}

/** Мир кейса: в базе и Redis прежний адрес, жить записи ещё `left` с, поток кликов `flow`. */
function cached(left: number, flow = 20_000, clockAt = 1200): World {
  const w = world();
  w.clock = clockAt;
  w.flow = flow;
  addRedis(w);
  w.redis!.entries.push({ key: HOT, value: OLD, expiresAt: clockAt + left, ttl: left > 60 ? TTL : 10 });
  return w;
}

/** Часы: t секунд от 12:00:00. */
export function clock(t: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${12 + Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // 0. Хук: все клики — в базу.
  d.scene(ACT.hook);
  d.w.flow = 20_000;
  d.shot("", (w) => {
    for (const who of ["A", "B", "C"] as const) visit(w, who);
    w.events.push({ kind: "flood" }, { kind: "overload" });
    w.db = "Опять эта ссылка? Только что отвечал!";
  }, { voice: "Возьмём сервис коротких ссылок. Нашу ссылку выложил крупный Telegram-канал, и на неё сыплются двадцать тысяч кликов в секунду. Каждый клик превращается в отдельный запрос в Postgres за адресом, куда она ведёт, и у базы кончаются соединения! Запросы встают в очередь, а страница открывается по несколько секунд." });

  // Знакомство и норма.
  d.scene(ACT.intro);
  d.shot("", undefined, {
    focus: ["table", "row"],
    voice: "Как так вышло? Давайте по порядку. Слева таблица ссылок в Postgres: для каждой ссылки записаны её код и адрес, куда она ведёт. Ссылок у нас миллионы, а нас интересует одна.",
  });
  d.shot("", (w) => visit(w, "A"), {
    focus: ["A", "row", "browsers"],
    voice: "Теперь посмотрим, как ходят клики. В центре стоят три пода нашего сервиса: приходит клик, под A берёт из базы адрес, куда ведёт ссылка, и отправляет посетителя туда. Пока кликов мало, так всё и работает.",
  });
  d.shot("", (w) => addRedis(w), {
    focus: ["redis"],
    voice: "Но ссылки читают в сотни раз чаще, чем меняют, а спрашивать базу об одном и том же каждый раз расточительно. Поэтому поставим рядом с ней Redis: копию нужных адресов прямо в памяти. Пока он пуст.",
  });
  d.shot("", (w) => {
    get(w, "A");
    sql(w, "A", `${SQL.get}  -- (nil)`);
    select(w, "A");
    sql(w, "A", `${SQL.select}  -- '${OLD}'`);
  }, {
    sql: true, focus: ["A", "redis", "row", "sql"],
    voice: "Разберём, как это работает. Под A сначала спрашивает у Redis, нет ли там адреса нашей ссылки. Промах, cache miss: там пусто, поэтому под идёт за адресом в базу.",
  });
  d.shot("", (w) => {
    set(w, "A");
    sql(w, "A", SQL.set(OLD, TTL));
    reply(w, "A");
  }, {
    sql: true, focus: ["A", "redis", "sql", "browsers"],
    voice: "Получив адрес, под A кладёт его копию в Redis под кодом нашей ссылки на один час. Это срок жизни, TTL. И только потом под отвечает посетителю.",
  });
  d.term("Cache-aside");
  d.shot("", (w) => {
    w.flow = 20_000;
    visit(w, "B");
    visit(w, "C");
    w.events.push({ kind: "calm" });
    w.db = "Можно я посплю?";
  }, {
    focus: ["B", "C", "redis", "browsers", "load"],
    voice: "А вот поды B и C находят адрес в Redis сразу. Это попадание, cache hit, и база за это время ни разу не пошевелилась. Такая схема называется cache-aside: под сам ходит в кэш и сам заполняет его из базы, если там пусто.",
  });
  const norm = structuredClone(d.w);

  // КЕЙС 1 — кэш врёт после правки.
  d.scene(ACT.case1);
  d.chapter(1, ["ответ свежий", "база держит"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nАвтор поменял ссылку. Что увидят люди?";
  }, { hold: 2.5, voice: "В первом кейсе автор поменяет ссылку, а мы проверим две вещи: получат ли посетители свежий адрес и выдержит ли база нагрузку." });

  // 1.1 Кэш на час.
  d.scene(ACT.hour, cached(2400));
  d.attempt("кэш на час");
  d.shot("", (w) => {
    edit(w);
    commitEdit(w);
  }, {
    sql: true, focus: ["A", "row", "redis", "sql"],
    voice: "Магазин переносит распродажу со страницы sale на страницу promo и в ту же минуту закрывает старую, а автор правит ссылку: под A обновляет строку и делает COMMIT. В базе теперь promo, а в Redis по-прежнему sale, и этой записи жить ещё сорок минут.",
  });
  d.term("Stale cache");
  d.shot("", (w) => {
    visit(w, "B");
    visit(w, "C");
  }, {
    focus: ["B", "C", "row", "redis", "browsers"],
    voice: "Посетители приходят к подам B и C, и оба получают из Redis старый адрес sale. Но эта страница уже закрыта, поэтому они видят ошибку 404! Кэш ведь только копия, и сейчас она нам врёт. Это устаревший кэш, stale cache.",
  });
  d.shot("", (w) => {
    setClock(w, w.clock + 39 * 60);
    visit(w, "B");
  }, {
    verdict: ["red", "green"], focus: ["clock", "row", "redis", "browsers", "board"],
    voice: "Проходит десять минут, двадцать, тридцать девять, а посетители всё ещё попадают на закрытую страницу. Получается, что после каждой правки мы врём почти час, и так не пойдёт.",
  });

  // 1.2 Короткий TTL: свежее, но база снова под нагрузкой.
  const short = cached(2);
  short.missRate = 0.4;
  d.scene(ACT.short, short);
  d.attempt("короткий TTL, 10 с");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: срок 10 секунд";
    edit(w);
    commitEdit(w);
    visit(w, "B", 10);
    setClock(w, w.clock + 2);
    w.events.push({ kind: "expire" });
    visit(w, "B", 10);
  }, {
    focus: ["B", "row", "redis", "browsers", "clock"],
    voice: "Тогда сократим срок жизни записи, TTL, до десяти секунд. Правка та же. Пару секунд посетители ещё видят 404, но потом срок выходит, у пода B случается промах, он идёт в базу, и вот уже promo!",
  });
  d.shot("", (w) => {
    w.db = "Опять все ко мне?";
  }, {
    verdict: ["yellow", "yellow"], focus: ["load", "table", "board"],
    voice: "Только расплачиваться за это придётся базой. Для нашей горячей ссылки это сущие копейки: горстка походов в базу раз в десять секунд. Но таких ссылок у нас миллионы, и почти все открывают реже, чем раз в десять секунд. Поэтому кэш для них снова пуст, и каждый клик идёт в базу. Ответ стал свежее, а база опять под нагрузкой.",
  });

  // 1.3 Удалить ключ, потом база: читатель в щели кладёт старое.
  d.scene(ACT.delFirst, cached(2400));
  d.attempt("удалить ключ, потом база");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: сначала удалим ключ";
    delKey(w);
    edit(w);
  }, {
    sql: true, focus: ["A", "redis", "row", "sql"],
    voice: "Значит, срок трогать не будем, а станем убирать устаревшую запись сами. Казалось бы, всё просто: под A сначала удаляет ключ из Redis командой DEL, а уже потом начинает обновлять базу, и следующий клик возьмёт из базы свежий адрес.",
  });
  // Одна мысль — один кадр (learning-designer, фаза 2): промах и чтение, потом SET.
  d.shot("", (w) => {
    get(w, "B");
    const old = select(w, "B");
    sql(w, "B", `${SQL.get}  -- (nil)`);
    sql(w, "B", `${SQL.select}  -- '${old}'`);
  }, {
    sql: true, focus: ["B", "row", "sql"],
    voice: "И между этими двумя шагами заходит под B. В Redis пусто, поэтому он идёт в базу, а транзакция A ещё не закоммичена.",
  });
  d.shot("", (w) => {
    set(w, "B");
    reply(w, "B");
    sql(w, "B", SQL.set(w.actors.B.hand!, TTL));
    w.db = "Я отдал то, что закоммичено.";
  }, {
    sql: true, focus: ["B", "redis", "sql"],
    voice: "База честно отдаёт последнее закоммиченное, то есть старый адрес sale, и под B кладёт его в Redis на целый час.",
  });
  d.shot("", (w) => {
    commitEdit(w);
    visit(w, "C");
  }, {
    verdict: ["red", "green"], focus: ["A", "C", "row", "redis", "browsers", "board"],
    voice: "Под A делает COMMIT, но поздно: в Redis уже прочно засела старая копия, и под C снова получает 404! Так будет весь час.",
  });
  d.term("Race condition");
  d.shot("", (w) => {
    // Окно гонки — порядок шагов разных подов одной панелью: зритель видит, куда вклинился B.
    // Беда в чтении до COMMIT, а не в SET: без SELECT в панели зритель решил бы, что виноват SET (tech-expert).
    sql(w, "A", `${SQL.del}  -- 1`);
    sql(w, "B", `${SQL.select}  -- '${OLD}'`);
    sql(w, "B", SQL.set(OLD, TTL));
    sql(w, "A", "COMMIT");
  }, {
    sql: true, focus: ["sql", "redis", "board"],
    voice: "Это классический race condition, ведь сосед вклинился между удалением ключа и COMMIT. А на горячей ссылке в это окно гонки кто-то попадает почти наверняка.",
  });

  // 1.4 База, потом удалить ключ.
  d.scene(ACT.dbFirst, cached(2400));
  d.attempt("база, потом удалить ключ");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: сначала база";
    edit(w);
    visit(w, "B");
  }, {
    sql: true, focus: ["A", "B", "row", "browsers"],
    voice: "Раз беда в окне между удалением и COMMIT, поменяем порядок: сначала база, потом удаление. Под A начинает обновление, и пока оно не закоммичено, под B спокойно получает из Redis старый адрес. Это ещё не враньё, ведь правка не закоммичена и для остальных её пока нет.",
  });
  const beforeCommit = structuredClone(d.w);
  d.shot("", (w) => {
    commitEdit(w);
    delKey(w);
  }, {
    sql: true, focus: ["A", "row", "redis", "sql"],
    voice: "Под A делает COMMIT и сразу удаляет ключ. В миллисекунды между этими шагами старый адрес ещё может кому-то достаться, но каждый промах после удаления прочитает из базы уже promo.",
  });
  const deleted = structuredClone(d.w);
  d.term("Cache invalidation");
  d.shot("", (w) => {
    visit(w, "B");
    visit(w, "C");
    w.db = "Вот теперь другое дело.";
  }, {
    verdict: ["green", "green"], focus: ["B", "C", "redis", "browsers", "board"],
    voice: "После этого под B получает промах, идёт в базу, видит promo и кладёт его в Redis, а под C уже берёт свежий адрес из кэша. Удалить ключ сразу после записи в базу — это и есть инвалидация кэша, cache invalidation: все снова получают свежий адрес, а база нагрузку держит.",
  });

  // 1.5 DEL не дошёл: TTL ограничивает враньё.
  d.scene(ACT.lost, structuredClone(beforeCommit), { replay: true });
  d.attempt("…а если DEL не дошёл");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: COMMIT прошёл";
    commitEdit(w);
    crash(w, "A");
  }, {
    focus: ["A", "row", "redis"],
    voice: "Но что, если под A успеет сделать COMMIT, а потом упадёт, не удалив ключ? Вернёмся к моменту, когда COMMIT уже прошёл. Правка в базе есть, а старая копия в Redis осталась.",
  });
  d.shot("", (w) => {
    visit(w, "B");
    visit(w, "C");
  }, {
    focus: ["B", "C", "row", "redis", "browsers"],
    voice: "И вот поды B и C снова отдают старый адрес, а посетители получают 404. Но у этой копии, как у любой в нашем кэше, есть срок жизни, и он уже идёт.",
  });
  d.term("TTL · bounded staleness");
  d.shot("", (w) => {
    setClock(w, w.redis!.entries[0].expiresAt + 1);
    w.events.push({ kind: "expire" });
    visit(w, "B");
  }, {
    verdict: ["yellow", "green"], focus: ["B", "redis", "clock", "browsers", "board"],
    voice: "Когда срок выходит, Redis перестаёт отдавать запись и сам её убирает. Первый же клик получает промах, идёт в базу за promo и кладёт свежую копию, так что всё чинится без нас. Вот зачем на самом деле нужен TTL: он не просто освобождает память, а ограничивает, как долго мы готовы врать в худшем случае, если удаление ключа почему-то не сработало. Это ограниченная устарелость, bounded staleness.",
  });
  const bounded = structuredClone(d.w);

  // КЕЙС 2 — горячий ключ.
  d.scene(ACT.case2);
  d.chapter(2, ["ответ свежий", "узел не тонет"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nСсылку подхватили все. Кэш выдержит?";
    w.db = "Ну хоть не я.";
  }, { hold: 2.5, voice: "Во втором кейсе ссылку подхватывают все сразу. Проверим, останется ли ответ свежим и выдержит ли кэш такой поток." });

  // 2.1 Кэш как есть: узел 3 тонет.
  const hot = cached(2400, 200_000, 4000);
  addRedis(hot, 4, 3);
  d.scene(ACT.hot, hot);
  d.attempt("кэш как есть");
  d.shot("", undefined, {
    focus: ["redis", "browsers"],
    voice: "Теперь ссылку подхватили ещё каналы, и кликов стало двести тысяч в секунду. Кэш к этому времени вырос в кластер: ключи поделены между четырьмя узлами, и каждый ключ живёт ровно на одном из них.",
  });
  d.shot("", (w) => {
    for (const who of ["A", "B", "C"] as const) visit(w, who);
    w.events.push({ kind: "flood" }, { kind: "overload" });
  }, {
    focus: ["redis", "browsers"],
    voice: "Ключ нашей ссылки попал на третий узел, и этот узел тонет, пока остальные скучают! Та же беда, что с базой в самом начале, только теперь тонет узел Redis.",
  });
  d.term("Hot key");
  d.shot("", undefined, {
    verdict: ["green", "red"], focus: ["redis", "board"],
    voice: "Выходит, кэш на месте, а вся нагрузка всё равно собралась в одной точке. Такую беду называют горячим ключом, hot key.",
  });

  // 2.2 Больше узлов: слот переехал, тонет другой узел.
  const more = structuredClone(d.w);
  more.clicks = [];
  d.scene(ACT.nodes, more);
  d.attempt("больше узлов");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: шесть узлов";
    addRedis(w, 6, 5);
    w.events.push({ kind: "reshard" }, { kind: "overload" });
    visit(w, "A");
    visit(w, "B");
  }, {
    verdict: ["green", "red"], focus: ["redis", "board"],
    voice: "Казалось бы, нужно просто добавить узлов, пусть будет шесть. Ключи перераспределились, но наш ключ попал на пятый узел, и теперь тонет уже он.",
  });
  d.shot("", undefined, {
    focus: ["redis", "board"],
    voice: "Узлы делят между собой разные ключи, а один горячий ключ всё равно живёт в одном месте. Читать его можно ещё и с реплик этого узла, но их всего несколько, и каждая может отставать от мастера.",
  });

  // 2.3 Локальный кэш L1 в каждом поде.
  const local = structuredClone(d.w);
  local.clicks = [];
  local.l1 = true;
  ([["A", 1], ["B", 2], ["C", 4]] as const).forEach(([who, left]) => (local.actors[who].l1 = { value: OLD, expiresAt: local.clock + left }));
  d.scene(ACT.local, local);
  d.attempt("локальный кэш L1");
  d.term("Local cache · L1");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: копия в каждом поде";
    visit(w, "B");
    visit(w, "C");
    w.events.push({ kind: "calm" });
  }, {
    verdict: [null, "green"], focus: ["A", "B", "C", "redis", "board"],
    voice: "Тогда поставим копию прямо в каждый под: локальный кэш, L1, на пять секунд. Теперь каждый под заходит в Redis лишь раз в пять секунд, и узел наконец может выдохнуть.",
  });
  const beforeEdit = structuredClone(d.w);
  d.shot("", (w) => {
    edit(w);
    commitEdit(w);
    delKey(w);
    w.actors.A.l1 = null;
  }, {
    sql: true, focus: ["A", "redis", "sql"],
    voice: "Но тут автор опять правит ссылку. Под A делает COMMIT, удаляет ключ в Redis и сбрасывает свой локальный кэш.",
  });
  d.shot("", (w) => {
    visit(w, "B");
    visit(w, "C");
  }, {
    focus: ["B", "C", "row", "browsers"],
    voice: "А вот у подов B и C в L1 всё ещё лежит sale, и посетители снова получают 404! Это опять stale cache: копии в подах разошлись с базой, а сообщить им о правке некому.",
  });
  d.shot("", (w) => {
    setClock(w, w.clock + L1_TTL - 1);
    visit(w, "B");
    visit(w, "C");
  }, {
    verdict: ["yellow", null], focus: ["B", "C", "clock", "browsers", "board"],
    voice: "Через несколько секунд срок L1 у пода B выходит, он идёт в Redis, потом в базу и находит promo, а чуть позже и под C берёт promo из Redis. Враньё хотя бы ограничено, но несколько секунд мы всё же врали, а хочется обойтись без этого.",
  });

  // 2.4 L1 + рассылка «сбрось»: COMMIT → DEL → PUBLISH.
  d.scene(ACT.pubsub, structuredClone(beforeEdit), { replay: true });
  d.attempt("L1 + рассылка «сбрось»");
  d.shot("", (w) => {
    w.stamp = "⟲ Вернёмся: до правки";
  }, {
    focus: ["A", "B", "C", "redis"],
    voice: "Тогда пусть просьбу сбросить копию разносит Redis: у него есть рассылка по каналам, Pub Sub, и все поды заранее подписаны на канал «сбрось». Вернёмся к моменту до правки.",
  });
  d.shot("", (w) => {
    edit(w);
    commitEdit(w);
    delKey(w);
    w.actors.A.l1 = null;
    sql(w, "A", SQL.publish);
  }, {
    sql: true, focus: ["A", "sql"],
    voice: "Автор снова меняет ссылку, под A делает COMMIT, удаляет ключ и только потом публикует в канал эту просьбу. Опубликуй он её раньше, поды B и C сбросили бы L1 и тут же снова взяли бы из Redis старый адрес, ещё на пять секунд!",
  });
  d.shot("", (w) => {
    publish(w, "A");
  }, {
    sql: true, focus: ["A", "B", "C", "redis"],
    voice: "А так Redis рассылает просьбу всем подписчикам, и поды B и C очищают свой L1 за миллисекунды.",
  });
  const published = structuredClone(d.w);
  d.term("Pub/Sub invalidation");
  d.shot("", (w) => {
    visit(w, "B");
    visit(w, "C");
    w.db = "Мне даже скучно.";
  }, {
    verdict: ["green", "green"], focus: ["B", "C", "browsers", "board"],
    voice: "На следующий клик в L1 пусто, поэтому под B идёт в Redis, затем в базу, а под C уже берёт promo из Redis. Так устроен известный приём: двухуровневый кэш с инвалидацией через Pub Sub. Но доставку Pub Sub не гарантирует: сообщение может пропасть, например, пока под переподключается к Redis. Поэтому короткий срок жизни L1 остаётся страховкой.",
  });

  // Итог — повтором уже виденных образов: узнаваемый момент акта (стрелки, команды, события), а не его конец.
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ["A", "B", "C"] as const) x.actors[id].acts = structuredClone(saved.actors[id].acts);
      x.sql = [...saved.sql];
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
    }, { voice, sql: saved.sql.length > 0 });
  };
  recap(norm, "Вспомним, что случилось с нашей ссылкой. Её выложил Telegram-канал, и двадцать тысяч кликов в секунду ложились прямо на Postgres, пока мы не поставили перед ним Redis. Теперь Redis отвечает на повторные чтения, а база наконец отдыхает.");
  recap(deleted, "Но кэш остался копией, и после правки адреса она врала нам целый час. Выручил порядок действий: сначала COMMIT в базе, а уже потом удаление ключа, и окно вранья сжалось до миллисекунд.");
  recap(bounded, "А если под A упадёт между COMMIT и удалением, нас выручит срок жизни. Старая копия всё равно протухнет, и враньё закончится самое позднее тогда, когда выйдет срок.");
  recap(published, "Ну а когда ссылку подхватили все и один горячий ключ утопил узел, мы раздали копию каждому поду. Рассылка в Pub Sub сбрасывает её за миллисекунды, а короткий срок подстраховывает на случай, если сообщение потеряется.");

  return d.steps;
}
