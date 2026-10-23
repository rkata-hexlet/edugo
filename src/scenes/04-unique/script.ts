import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  ACTORS, HOT, PEOPLE, WINDOW, click, cookie, empty, flood, flush, grow, periodReal, periodsOf, probe, record, setClock, world, year,
  type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/04-unique.md (сценарий v1, покадрово).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс 1",
  notebook: "1.1 Set на каждом поде",
  list: "1.2 Общая таблица",
  hll: "1.3 HyperLogLog",
  case2: "Кейс 2",
  daySum: "2.1 Сумма дневных",
  dayUnion: "2.2 HLL по дням",
  summary: "Итог",
} as const;

const ANYA = PEOPLE.anya.vid;
const BORIS = PEOPLE.boris.vid;
const VIKA = PEOPLE.vika.vid;

const SQL = {
  insert: (vid: string) => `INSERT INTO visitors VALUES ('${HOT}', '${vid}')\n  ON CONFLICT DO NOTHING`,
  count: `SELECT count(*) FROM visitors\n  WHERE code = '${HOT}'`,
  merge: `INSERT INTO link_uniques VALUES ('${HOT}', current_date, $1)\n  ON CONFLICT (code, day) DO UPDATE\n  SET uniques = link_uniques.uniques || EXCLUDED.uniques`,
  year: `SELECT #hll_union_agg(uniques) FROM link_uniques\n  WHERE code = '${HOT}'\n    AND day BETWEEN '2026-01-01' AND '2026-12-31'`,
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

/** Сверх общего: акты подов и отсылка к 03 живут один кадр; итог — повтор уже виденного. */
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
    w.odds = false;
    w.hashOnly = false;
    w.probes = [];
  }

  protected override finish(w: World): void {
    w.replay = this.replaying;
  }
}

function sql(w: World, who: ActorId, text: string): void {
  w.sql.push(`Pod ${who} ▸ ${text}`);
}

/** Мир без героини: у Ани ещё нет visitor ID (норма). */
function bare(): World {
  const w = world();
  w.browsers[0].vid = null;
  return w;
}

export function buildSteps(): Step<World>[] {
  const d = new Shots();

  // Знакомство: мир эпизода 03 его же сценой, затем вопрос автора.
  d.scene(ACT.intro);
  d.shot("", (w) => {
    w.flashback = { voice: "И раз в пять секунд" };
  }, {
    voice: "Клики по короткой ссылке мы считать уже умеем: в прошлом ролике поды научились копить их у себя и раз в пять секунд относить в базу одним батчем.",
  });
  d.shot("", (w) => {
    w.browsers[0].clicks = 3;
    w.clicks += 3;
    w.people = [ANYA];
  }, {
    focus: ["browsers"],
    voice: "Но автору ссылки интересно не только, сколько раз по ней кликнули, а сколько людей это сделали. Допустим, Аня кликнула трижды, но человек-то она одна.",
  });

  // Хук: три клика Ани разлетелись по трём подам, каждый записал её новой.
  d.scene(ACT.hook);
  d.shot("", (w) => {
    for (const id of ACTORS) click(w, id, ANYA);
    for (const id of ACTORS) flush(w, id);
    w.db = "Три новых. Записал.";
  }, {
    focus: ["A", "B", "C", "row", "browsers"],
    voice: "Посмотрим, что получится. Три клика Ани разлетелись по подам A, B и C, и каждый проверяет у себя в памяти, видел ли он её. Никто не видел, поэтому каждый с гордостью отправляет в базу плюс один уникальный. В итоге в базе три посетителя там, где была одна Аня!",
  });
  const hook = structuredClone(d.w);

  // Норма: visitor ID в cookie; повтор на том же поде — не новая.
  d.scene(ACT.norm, bare());
  d.shot("", (w) => {
    cookie(w, "A", PEOPLE.anya.name, ANYA);
    click(w, "A", ANYA);
  }, {
    focus: ["A", "browsers"],
    voice: "Но как сервису вообще понять, что это та же Аня? Аккаунта у неё нет, имени мы не знаем. Поэтому при первом клике под выдаёт браузеру идентификатор посетителя, visitor ID: случайную строку, которую браузер сохранит в cookie.",
  });
  d.term("Unique visitors");
  d.shot("", (w) => {
    click(w, "A", ANYA);
  }, {
    focus: ["A", "browsers"],
    voice: "Дальше браузер присылает этот visitor ID с каждым кликом. Под держит в памяти set уже увиденных идентификаторов, находит там Анин и понимает: не новая! Число разных visitor ID и есть уникальные посетители, unique visitors.",
  });

  // КЕЙС 1 — подов три, посетитель один.
  d.scene(ACT.case1);
  d.chapter(1, ["не завышаем", "весит мало"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nТри пода. Сколько разных людей?";
  }, { hold: 2.5, voice: "Первый кейс. Подов у нас три, а Аня должна посчитаться один раз. Следим за двумя вещами: не завышаем ли мы число и сколько памяти уходит на подсчёт." });

  // 1.1 Set на каждом поде: это и был хук; set очищается со сбросом — Аня снова новая.
  d.scene(ACT.notebook, structuredClone(hook), { replay: true });
  d.attempt("set на каждом поде");
  d.term("Non-additive measure");
  d.shot("", (w) => {
    setClock(w, WINDOW);
    click(w, "A", ANYA);
    flush(w, "A");
  }, {
    verdict: ["red", "green"], focus: ["A", "jar", "row", "clock", "board"],
    voice: "Начнём с самого простого: у каждого пода свой set, а при сбросе батча под отправляет в базу число новых и очищает set, чтобы память не росла. Но мы уже видели, что Аня на трёх подах посчиталась трижды. Хуже того, стоит ей кликнуть через пять секунд, и даже под A считает её новой! Клики складываются, а уникальные нет: Аня плюс та же Аня — это всё ещё одна Аня.",
  });

  // 1.2 Общая таблица visitors: точно, но растёт с каждым посетителем.
  const listed = world();
  listed.mode = "list";
  d.scene(ACT.list, listed);
  d.attempt("общая таблица");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: общая таблица";
    click(w, "A", ANYA);
    click(w, "C", ANYA);
    flush(w, "A");
    flush(w, "C");
    sql(w, "A", SQL.insert(ANYA));
    sql(w, "C", SQL.insert(ANYA));
  }, {
    sql: true, verdict: ["green", null], focus: ["A", "C", "list", "sql", "board"],
    voice: "Ладно, зайдём с другой стороны: пусть идентификаторы собирает сама база. Заведём таблицу visitors с уникальным ключом, и повторный visitor ID она просто отбросит через ON CONFLICT DO NOTHING. Аня с пода A и Аня с пода C теперь одна строка и считается один раз!",
  });
  d.term("Exact distinct count");
  d.shot("", (w) => {
    grow(w, 3_000_000);
    w.db = "Пересчитываю. Опять всех.";
  }, {
    verdict: [null, "red"], focus: ["list", "weight", "board"],
    voice: "Счёт теперь точный, но посмотрите на цену. Таблица растёт с каждым новым посетителем: у популярной ссылки это миллионы строк и сотни мегабайт. А стоит автору открыть статистику, и базе приходится заново делать count по всем этим строкам.",
  });
  const listShot = structuredClone(d.w);

  // 1.3 HyperLogLog: хэш → доля ведущих нулей → регистры → повтор → новая без роста → толпа → оценка → слияние подов.
  const hll = world();
  hll.mode = "hll";
  d.scene(ACT.hll, hll);
  d.attempt("HyperLogLog");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: оцениваем";
    record(w, ANYA);
    w.hashOnly = true;
  }, {
    focus: ["probe"],
    voice: "Значит, хранить сами идентификаторы слишком дорого. Нужно оценить, сколько разных значений прошло, не храня их, и HyperLogLog делает это с помощью хэш-функции. Прогоним через неё Анин visitor ID: получим строку битов, причём для одного и того же ID она всегда будет одинаковой.",
  });
  const anyaProbe = structuredClone(d.w.probes);
  d.shot("", (w) => {
    w.odds = true;
  }, {
    focus: ["probe"],
    voice: "У хорошего хэша каждый бит равен нулю с вероятностью одна вторая. Поэтому хэш, который начинается с нуля, выпадет у каждого второго значения, с двух нулей — у каждого четвёртого, а пять нулей подряд встретятся примерно у одного из тридцати двух. Значит, чем длиннее серия ведущих нулей, тем больше разных значений пришлось перебрать, чтобы её встретить. Отсюда главный трюк: если максимум ведущих нулей среди всех хэшей равен пяти, разных значений было порядка тридцати двух!",
  });
  d.shot("", (w) => {
    w.probes = structuredClone(anyaProbe);
  }, {
    focus: ["probe", "boxes"],
    voice: "Но одному максимуму верить нельзя: одному значению может просто повезти, и оценка улетит в разы. Поэтому значения раскладывают по регистрам. Первые четыре бита хэша выбирают один из шестнадцати регистров, а регистр хранит только максимум ведущих нулей в остальных битах. Анин хэш попал в регистр пять, и там два ведущих нуля.",
  });
  d.shot("", (w) => {
    record(w, BORIS);
  }, {
    focus: ["probe", "boxes"],
    voice: "Следом кликает Борис. Его хэш начинается с других битов, поэтому он попадает в регистр одиннадцать, и ведущих нулей у него нет. Заметьте, в регистре лежит одно маленькое число, а самого visitor ID Бориса там нет.",
  });
  d.shot("", (w) => {
    record(w, ANYA);
  }, {
    focus: ["probe", "boxes", "browsers"],
    voice: "Теперь Аня кликает снова. Тот же visitor ID даёт тот же хэш, тот же регистр и те же два нуля, поэтому максимум не меняется. Повтор просто не оставляет следа, и никакой список для этого не нужен!",
  });
  const repeatShot = structuredClone(d.w);
  d.shot("", (w) => {
    record(w, VIKA);
    w.db = "Кто новенький? Не знаю.";
  }, {
    focus: ["probe", "boxes", "browsers"],
    voice: "А вот Вика действительно новая. Но её хэш попал в тот же регистр пять и дал всего один ведущий нуль, а там уже два. Максимум не вырос, и оценка Вику не заметила. HyperLogLog не помнит, кто приходил, а когда регистров всего шестнадцать, такие совпадения случаются часто.",
  });
  d.shot("", (w) => {
    flood(w, 10_000);
  }, {
    focus: ["boxes", "browsers"],
    voice: "Зато на тысячах ошибки сглаживаются. Пустим через регистры десять тысяч посетителей, и максимумы растут! В каждый регистр попадает примерно по шестьсот значений, и если какому-то повезёт с длинной серией нулей, это не беда: оценка берёт все шестнадцать регистров и усредняет их так, что одиночные выбросы почти не влияют.",
  });
  d.term("HyperLogLog");
  d.shot("", undefined, {
    verdict: ["yellow", "green"], focus: ["boxes", "estimate", "browsers", "weight", "board"],
    voice: "Сколько же получилось? Раз в регистре максимум k нулей, значит, в него попало порядка двух в степени k значений. Каждый регистр даёт свою оценку, мы берём их гармоническое среднее и умножаем на число регистров. На шестнадцати регистрах промахнулись почти на треть, и для такого маленького числа регистров это нормально. Но в настоящем HyperLogLog их шестнадцать тысяч: он весит около десяти килобайт и ошибается примерно на процент! Сравните с сотнями мегабайт в таблице.",
  });
  const pods = world();
  pods.mode = "hll";
  d.scene(ACT.hll, pods);
  d.shot("", (w) => {
    click(w, "A", ANYA);
    click(w, "C", ANYA);
    click(w, "B", BORIS);
    for (const id of ACTORS) flush(w, id);
    sql(w, "A", SQL.merge);
  }, {
    sql: true, focus: ["A", "B", "C", "jar", "boxes", "sql"],
    voice: "Осталось вернуть в картину поды. Теперь каждый под копит в батче не set, а свои шестнадцать регистров, а при сбросе база сливает их с общими. Это union: в каждом регистре остаётся больший из двух максимумов.",
  });
  d.shot("", (w) => {
    w.probes = [{ ...probe(ANYA, empty()), by: "A" }, { ...probe(ANYA, empty()), by: "C" }];
  }, {
    focus: ["A", "C", "probe", "boxes"],
    voice: "Хэш у всех подов один и тот же, поэтому Аня и с пода A, и с пода C попадает в регистр пять с теми же двумя нулями. Больший из двух одинаковых максимумов всё тот же, и Аня считается один раз!",
  });

  // КЕЙС 2 — год.
  d.scene(ACT.case2);
  d.chapter(2, ["не завышаем", "весит мало"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nАвтор открыл год. Сколько людей?";
  }, { hold: 2.5, voice: "Второй кейс. Автор ссылки открыл статистику за год и хочет знать, сколько разных людей к нему заходило. Критерии те же: не завышаем и тратим мало памяти." });

  // 2.1 Сумма дневных: Аня — 365 раз.
  const days = world();
  year(days);
  d.scene(ACT.daySum, days);
  d.attempt("сумма дневных");
  d.shot("", (w) => {
    w.period = 365;
    w.events.push({ kind: "sum" });
    w.db = "365 Ань. Записал.";
  }, {
    verdict: ["red", "green"], focus: ["days", "browsers", "board"],
    voice: "Проще всего сложить уникальных за каждый день. Но Аня, которая заходит каждый день, посчитается триста шестьдесят пять раз! То же случится с каждым постоянным читателем, поэтому дни складываются так же плохо, как поды.",
  });

  // 2.2 HLL по дням: слияние за любой период.
  const boxed = structuredClone(days);
  boxed.mode = "hll";
  d.scene(ACT.dayUnion, boxed);
  d.attempt("слияние дневных HLL");
  d.term("HLL union");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: HLL по дням";
    w.period = 365;
    w.real = periodReal(365);
    w.events.push({ kind: "merge" });
    sql(w, "A", SQL.year);
  }, {
    sql: true, verdict: ["yellow", "green"], focus: ["days", "boxes", "estimate", "sql", "board"],
    voice: "Значит, за каждый день будем хранить не число, а сам HyperLogLog с его регистрами. Запрос за год сливает все триста шестьдесят пять дней тем же union: в каждом регистре остаётся больший максимум, и Аня снова оставляет один след. Это по-прежнему оценка, а не точный счёт, зато каждый человек считается один раз за весь год!",
  });
  const unionShot = structuredClone(d.w);
  d.shot("", (w) => {
    periodsOf(w, [7, 30, 365]);
    w.events.push({ kind: "merge" });
  }, {
    focus: ["days", "estimate"],
    voice: "И это ещё не всё: из тех же дневных HyperLogLog собирается любой период, например неделя, последние тридцать дней или год. Поэтому мы и храним дни: из готовой годовой оценки один день уже не вынешь.",
  });

  // Итог — повтором узнаваемых моментов.
  d.chapter(null);
  const recap = (saved: World, voice: string) => {
    d.scene(ACT.summary, structuredClone(saved), { replay: true });
    d.shot("", (x) => {
      for (const id of ACTORS) x.actors[id].acts = structuredClone(saved.actors[id].acts);
      x.probes = structuredClone(saved.probes);
      x.events.push(...saved.events.filter((e) => !["page", "rewind", "verdict", "card"].includes(e.kind)));
      x.db = null;
      x.stamp = null;
    }, { voice, focus: saved.focus ?? undefined });
  };
  recap(hook, "Давайте вспомним путь. Сначала каждый под держал свой set, и одна Аня превращалась в нескольких посетителей.");
  recap(listShot, "Общая таблица с уникальным ключом считала точно, но у популярной ссылки разрасталась до сотен мегабайт.");
  recap(repeatShot, "Поэтому мы перестали хранить идентификаторы: HyperLogLog хранит только максимумы ведущих нулей, и повтор Ани не оставляет следа.");
  recap(unionShot, "А главное, регистры умеют сливаться: между подами, между днями и за любой период. Поэтому уникальных мы считаем с ошибкой около процента и без гигантской таблицы.");

  return d.steps;
}
