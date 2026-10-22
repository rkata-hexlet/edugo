import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import {
  ACTORS, ANYA_TG, HOT, PEOPLE, WINDOW, click, cookie, empty, flood, flush, grow, periodReal, periodsOf, probe, record, reflush, setClock, world, year,
  type ActorId, type Focus, type World,
} from "./sim";

// Акты эпизода — синхронно с docs/episodes/04-unique.md (сценарий v1, покадрово).
// Микрошаг: одна мысль диктора — одно изменение на экране, и фокус на том, о чём фраза.

export const ACT = {
  intro: "Знакомство",
  hook: "0. Хук",
  norm: "Норма",
  case1: "Кейс 1",
  notebook: "1.1 Блокнот у каждого пода",
  list: "1.2 Общий список",
  hll: "1.3 HyperLogLog",
  case2: "Кейс 2",
  daySum: "2.1 Сумма дневных",
  dayUnion: "2.2 Ящики по дням",
  summary: "Итог",
} as const;

const ANYA = PEOPLE.anya.vid;
const BORIS = PEOPLE.boris.vid;
const VIKA = PEOPLE.vika.vid;

const SQL = {
  insert: (vid: string) => `INSERT INTO visitors VALUES ('${HOT}', '${vid}')\n  ON CONFLICT DO NOTHING`,
  count: `SELECT count(*) FROM visitors\n  WHERE code = '${HOT}'`,
  merge: `UPDATE link_uniques SET uniques = uniques || $1\n  WHERE code = '${HOT}' AND day = current_date`,
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
    w.coin = false;
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

/** Мир без героини: у Ани ещё нет номерка (норма). */
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
    voice: "Посмотрим, что получится. Три клика разлетелись по подам A, B и C, и каждый заглядывает в свой блокнот. Ани там нет, и под с гордостью записывает: новая! Три пода, и каждый уверен в своём. В итоге в базе три посетителя там, где была одна Аня!",
  });
  const hook = structuredClone(d.w);

  // Норма: номерок-cookie; повтор на том же поде — не новая; два браузера — два номерка.
  d.scene(ACT.norm, bare());
  d.shot("", (w) => {
    cookie(w, "A", PEOPLE.anya.name, ANYA);
    click(w, "A", ANYA);
  }, {
    focus: ["A", "browsers"],
    voice: "Но как вообще понять, что это та же Аня? Аккаунта у неё нет, имени мы не знаем. Поэтому при первом клике сервис выдаёт браузеру номерок, как в гардеробе: случайную строку в cookie.",
  });
  d.term("Unique visitors");
  d.shot("", (w) => {
    click(w, "A", ANYA);
  }, {
    focus: ["A", "browsers"],
    voice: "Теперь браузер сам предъявляет номерок с каждым кликом. Под находит его в блокноте и понимает: не новая! Число разных номерков и есть уникальные посетители, unique visitors.",
  });
  d.shot("", (w) => {
    w.phone = true;
    w.browsers.splice(1, 0, { name: "Аня · Telegram", vid: ANYA_TG, clicks: 1 });
    w.people.push(ANYA_TG);
    w.db = "Для меня — двое.";
  }, {
    focus: ["browsers", "phone"],
    voice: "Правда, номерок живёт в браузере, а не в человеке. Встроенный браузер Telegram и Chrome на одном телефоне получают разные номерки, и для нас это два посетителя. Так считают все, поэтому честнее говорить об уникальных браузерах, а не о людях.",
  });

  // КЕЙС 1 — подов три, посетитель один.
  d.scene(ACT.case1);
  d.chapter(1, ["не завышаем", "весит мало"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 1 из 2\nТри пода. Сколько разных людей?";
  }, { hold: 2.5, voice: "Первый кейс. Подов у нас три, а Аня должна посчитаться один раз. Следим за двумя вещами: не завышаем ли мы число и много ли весит подсчёт." });

  // 1.1 Блокнот у каждого пода: это и был хук; блокнот пустеет со сбросом — Аня снова новая.
  d.scene(ACT.notebook, structuredClone(hook), { replay: true });
  d.attempt("блокнот у каждого пода");
  d.shot("", (w) => {
    for (const id of ACTORS) w.actors[id].acts = structuredClone(hook.actors[id].acts);
    w.events.push({ kind: "new" });
  }, {
    verdict: ["red", null], focus: ["A", "B", "C", "row", "board"],
    voice: "Самое простое — оставить всё как есть, у каждого пода свой блокнот. Но это ровно то, с чего мы начали: Аня попала на три пода и посчиталась трижды.",
  });
  d.term("Non-additive measure");
  d.shot("", (w) => {
    setClock(w, WINDOW);
    click(w, "A", ANYA);
    flush(w, "A");
  }, {
    verdict: [null, "green"], focus: ["A", "jar", "row", "clock", "board"],
    voice: "Ладно, пусть блокнот очищается при каждом сбросе в базу, тогда он весит совсем мало. Но стоит Ане кликнуть через пять секунд, и она снова новенькая! Клики складываются, а уникальные нет: один плюс один здесь не два, а один.",
  });

  // 1.2 Общий список номерков: точно, но растёт с каждым человеком.
  const listed = world();
  listed.mode = "list";
  d.scene(ACT.list, listed);
  d.attempt("общий список номерков");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: один общий список";
    click(w, "A", ANYA);
    click(w, "C", ANYA);
    flush(w, "A");
    flush(w, "C");
    sql(w, "A", SQL.insert(ANYA));
    sql(w, "C", SQL.insert(ANYA));
  }, {
    sql: true, verdict: ["green", null], focus: ["A", "C", "list", "sql", "board"],
    voice: "Зайдём с другой стороны: пусть номерки собирает не каждый под, а сама база. Заведём одну общую таблицу, и повторный номерок она просто отбросит. Аня с пода A и Аня с пода C теперь одна строка и считается один раз!",
  });
  d.term("Exact distinct count");
  d.shot("", (w) => {
    grow(w, 3_000_000);
    w.db = "Пересчитываю. Опять всех.";
  }, {
    verdict: [null, "red"], focus: ["list", "weight", "board"],
    voice: "Счёт теперь точный, но посмотрите на цену. Таблица растёт с каждым новым человеком: у популярной ссылки это миллионы номерков и сотни мегабайт. А стоит автору открыть статистику, и базе приходится пересчитывать всех заново.",
  });
  const listShot = structuredClone(d.w);

  // 1.3 HyperLogLog: монетка → хэш → ящик и рекорд → повтор → новая, но без рекорда → толпа → оценка → слияние подов.
  const hll = world();
  hll.mode = "hll";
  d.scene(ACT.hll, hll);
  d.attempt("HyperLogLog");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: оцениваем";
    w.coin = true;
  }, {
    focus: ["probe"],
    voice: "Попробуем совсем другой приём. Представьте, что несколько человек бросают монетку, пока не выпадет орёл, и у кого-то вышло пять решек подряд. Такое случается примерно раз из тридцати двух попыток, значит, попыток было много. По рекордной серии можно прикинуть, сколько всего было попыток. Вот на этом и держится HyperLogLog.",
  });
  d.shot("", (w) => {
    record(w, ANYA);
    w.hashOnly = true;
  }, {
    focus: ["probe"],
    voice: "Но номерок не монетка, и выпадать он должен каждый раз одинаково. Поэтому прогоним его через хэш-функцию: она превращает номерок в строку нулей и единиц, как серию бросков, но для одного номерка всегда одну и ту же.",
  });
  const anyaProbe = structuredClone(d.w.probes);
  d.shot("", (w) => {
    w.probes = structuredClone(anyaProbe);
  }, {
    focus: ["probe", "boxes"],
    voice: "Первые четыре цифры выбирают один из шестнадцати ящиков. А нули в начале остатка играют роль наших решек подряд: ящик запоминает, сколько их было.",
  });
  d.shot("", (w) => {
    record(w, BORIS);
  }, {
    focus: ["probe", "boxes"],
    voice: "Приходит Борис. Хэш даёт другие цифры, и он попадает в ящик одиннадцать, где нулей в начале нет. Заметьте: ящик помнит только рекорд, самую длинную серию нулей, а ни номерков, ни имён в нём нет.",
  });
  d.shot("", (w) => {
    record(w, ANYA);
  }, {
    focus: ["probe", "boxes", "browsers"],
    voice: "Теперь Аня кликает снова. Тот же номерок даёт те же цифры, тот же ящик и тот же рекорд, поэтому повтор ничего не меняет.",
  });
  const repeatShot = structuredClone(d.w);
  d.shot("", (w) => {
    record(w, VIKA);
    w.db = "Кто новенький? Не знаю.";
  }, {
    focus: ["probe", "boxes", "browsers"],
    voice: "А вот Вика новая, но её номерок попал в ящик, где рекорд уже побольше, и ничего не сдвинул. Структура не помнит, кто был, она лишь оценивает, сколько людей всего.",
  });
  d.shot("", (w) => {
    flood(w, 10_000);
  }, {
    focus: ["boxes", "browsers"],
    voice: "Пустим в ящики десять тысяч номерков. Рекорды растут! Но вдруг одному ящику просто повезёт и там выпадет длинная серия? Поэтому ящиков много, и оценка берёт их все вместе и усредняет, так что один везунчик картину не портит.",
  });
  d.term("HyperLogLog");
  d.shot("", undefined, {
    verdict: ["yellow", "green"], focus: ["boxes", "estimate", "browsers", "weight", "board"],
    voice: "Сколько же получилось? На шестнадцати ящиках мы промахнулись почти на треть, но для игрушки это терпимо. В настоящем HyperLogLog ящиков шестнадцать тысяч: он весит килобайты, а ошибается примерно на процент! Сравните с сотнями мегабайт в таблице.",
  });
  const pods = world();
  pods.mode = "hll";
  d.scene(ACT.hll, pods);
  let sent: number[] = [];
  d.shot("", (w) => {
    click(w, "A", ANYA);
    click(w, "C", ANYA);
    click(w, "B", BORIS);
    sent = w.actors.A.regs.slice();
    for (const id of ACTORS) flush(w, id);
    sql(w, "A", SQL.merge);
  }, {
    sql: true, focus: ["A", "B", "C", "jar", "boxes", "sql"],
    voice: "Осталось собрать всё вместе. Теперь каждый под копит у себя такие же шестнадцать ящиков, а при сбросе база сливает их с общими, и в каждом ящике остаётся больший рекорд.",
  });
  d.shot("", (w) => {
    w.probes = [{ ...probe(ANYA, empty()), by: "A" }, { ...probe(ANYA, empty()), by: "C" }];
  }, {
    focus: ["A", "C", "probe", "boxes"],
    voice: "Хэш у всех подов один, поэтому Аня и с пода A, и с пода C падает в один и тот же ящик пять и считается один раз!",
  });
  d.shot("", (w) => {
    reflush(w, "A", sent);
    w.db = "Тот же максимум. Ничего.";
  }, {
    focus: ["A", "boxes"],
    voice: "А ещё приятный бонус: если сеть моргнёт и под A отнесёт свои ящики второй раз, ничего не случится, ведь максимум с самим собой остаётся тем же максимумом. Кликам же, как в прошлом ролике, номер батча по-прежнему нужен.",
  });

  // КЕЙС 2 — год.
  d.scene(ACT.case2);
  d.chapter(2, ["не завышаем", "весит мало"]);
  d.shot("", (w) => {
    w.plate = "КЕЙС 2 из 2\nАвтор открыл год. Сколько людей?";
  }, { hold: 2.5, voice: "Второй кейс. Автор ссылки открыл статистику за год и хочет знать, сколько людей к нему заходило. Критерии те же: не завышать и мало весить." });

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
    voice: "Самое простое — сложить числа уникальных за каждый день. Но Аня, которая кликает каждый день, посчитается триста шестьдесят пять раз! И постоянные читатели тоже, поэтому сумма выходит в двадцать раз больше, чем людей на самом деле. Дни складываются так же плохо, как поды.",
  });

  // 2.2 Ящики по дням: слияние за любой период; цена — только сливаются.
  const boxed = structuredClone(days);
  boxed.mode = "hll";
  d.scene(ACT.dayUnion, boxed);
  d.attempt("сливаем дневные ящики");
  d.term("HLL union");
  d.shot("", (w) => {
    w.stamp = "⟲ Иначе: ящики по дням";
    w.period = 365;
    w.real = periodReal(365);
    w.events.push({ kind: "merge" });
    sql(w, "A", SQL.year);
  }, {
    sql: true, verdict: ["yellow", "green"], focus: ["days", "boxes", "estimate", "sql", "board"],
    voice: "Тогда за каждый день будем хранить не число, а ящики. Запрос за год сливает ящики всех трёхсот шестидесяти пяти дней тем же максимумом, и Аня снова остаётся одним рекордом. Это по-прежнему оценка, а не точный счёт, зато один человек считается один раз — даже через весь год!",
  });
  const unionShot = structuredClone(d.w);
  d.shot("", (w) => {
    periodsOf(w, [7, 30, 365]);
    w.events.push({ kind: "merge" });
  }, {
    focus: ["days", "estimate"],
    voice: "А главное, из тех же дневных ящиков складывается любой период: неделя, последние тридцать дней, год. Поэтому мы и храним дни: из готовой годовой оценки один день уже не вынешь.",
  });
  d.shot("", (w) => {
    w.periods = [];
    w.cannot = ["вычесть Аню", "точно: и вчера, и сегодня"];
    w.events.push({ kind: "no" });
    w.db = "Вычесть? Не умею.";
  }, {
    focus: ["days", "boxes"],
    voice: "Но у ящиков есть цена: они умеют только сливаться. Выкинуть из них одного посетителя нельзя, а точно посчитать тех, кто был и вчера, и сегодня, тоже не выйдет.",
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
  recap(hook, "Итак, подведём путь. Сначала каждый под считал Аню новой, и одна Аня превращалась в нескольких.");
  recap(listShot, "Общая таблица считала точно, но у популярной ссылки разрасталась до сотен мегабайт.");
  recap(repeatShot, "Поэтому мы перестали хранить номерки: HyperLogLog помнит только рекорды, и повтор Ани ничего не меняет.");
  recap(unionShot, "А главное, рекорды умеют сливаться: между подами, между днями и за любой период. Поэтому уникальных мы считаем с ошибкой около процента и без гигантской таблицы.");

  return d.steps;
}
