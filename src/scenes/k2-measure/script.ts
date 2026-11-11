import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { CLASSES, LINKS, world, type ClassNo, type Editable, type Focus, type Lamp, type Picture, type World } from "./sim";

// Два наброска хода нового формата кухни (решение пользователя 11.11, `docs/episodes/kitchen-01-state.md`):
// почему верная починка не проходит проверку с первого раза — врёт не решение, а измерение.
// Общее начало: схема стенда по звеньям, норма, хук «верная починка — красное», подозреваемые.
//   `kc` — один настоящий путь задачи failing-orders («Часть заказов падает», 09.11) по кругу;
//   `kk` — пять причин по очереди, по 1–2 примера, каждый подсвечивает своё звено.
// Оба: шум из другой задачи, кадр ложного зелёного (late-emails, «без FOR UPDATE»), итог со счётом правок.
// Серые фигуры фазы 0. Факты — `incident-lab/docs/state.md`, `CLAUDE.md`, разборы сюжетов; сверка —
// `docs/reviews/kitchen-01-tech-expert-sketches.md`.

export const OUTRO = "Решение — малая часть работы. Основная — сделать так, чтобы измерение не врало";
const MORAL = "Решение — малая часть работы.\nОсновная — сделать так,\nчтобы измерение не врало";

export const PRONOUNCE: Record<string, string> = {
  CI: "си-ай",
  p95: "пэ девяносто пять",
  GET: "гет",
  DNS: "ди-эн-эс",
  PostgreSQL: "постгрес",
  createOrder: "криэйт-ордер",
  "FOR UPDATE": "фор апдейт",
};

class Board extends Director<Focus, World> {
  constructor() {
    super(world);
  }
  protected hold(): number {
    return 2.5;
  }
  protected clear(w: World): void {
    w.title = null;
    w.moral = null;
  }
  protected carded(w: World): boolean {
    return !!w.plate || !!w.title;
  }

  v(voice: string, action?: (w: World) => void, focus?: Focus[]): void {
    this.shot("", action, { voice, ...(focus ? { focus } : {}) });
  }

  // Глаголы.
  /** Примерить починку из набора к сервису; вердикта ещё нет. */
  apply(w: World, right: boolean, name: string): void {
    w.card = { right, name };
    w.verdict = { lamp: null, expect: right ? "green" : "red" };
    w.events.push({ kind: "card" });
  }
  judge(w: World, lamp: Exclude<Lamp, null>): void {
    w.verdict.lamp = lamp;
    w.events.push({ kind: lamp });
  }
  /** Правка звена: отметка копится, вердикт сброшен. */
  edit(w: World, link: Editable): void {
    w.edits[link]++;
    w.verdict.lamp = null;
    w.events.push({ kind: "edit" });
  }
  meet(w: World, n: ClassNo): void {
    if (!w.shelf.met.includes(n)) w.shelf.met.push(n);
    w.shelf.active = n;
    w.events.push({ kind: "met" });
  }
}

const flat = (n: number, v = 0) => Array.from({ length: n }, () => v);
const PIC = {
  cliff: { kind: "chart", title: "Ошибки при ровной нагрузке", points: [...flat(7), 0.9, 1, 1, 1], mark: { at: 6, label: "чуть больше нагрузки" }, note: null, bad: true },
  waves: { kind: "chart", title: "Ошибки при нагрузке залпами", points: [0, 0.55, 0, 0, 0.6, 0, 0, 0.5, 0, 0, 0.6], mark: null, note: "16 повторов разом\nраз в 10 секунд", bad: true },
  rollbacks: { kind: "bars", title: "Проверка считает откаты транзакций", bars: [
    { label: "поломка", value: 0.9, text: "много", bad: true },
    { label: "верная, чтение закрыто откатом", value: 0.4, text: "тоже есть", bad: true },
  ] },
  holes: { kind: "vs", title: "Признак лишней работы", left: { head: "было", text: "откаты\nтранзакций" }, right: { head: "стало", text: "дыры в номерах заказов,\nлишние обновления строк", bad: false } },
  ownOrders: { kind: "vs", title: "Залп проверки повторял заказы", left: { head: "проверка повторяла", text: "свои заказы —\nуже отсортированные" }, right: { head: "поломку дают", text: "старые заказы\nсо встречным порядком", bad: true } },
  stats: { kind: "vs", title: "Счётчики базы после залпа", left: { head: "читали", text: "через 2 с после залпа" }, right: { head: "база отдаёт их", text: "с задержкой до 10 с:\nсчитаем не тот залп", bad: true } },
  reads: { kind: "bars", title: "Ответы 503 в волне: снимок со стенда", bars: [
    { label: "повтор заказа", value: 0.8, text: "есть", bad: true },
    { label: "чтения GET", value: 0, text: "ни одного", bad: false },
  ] },
  noise: { kind: "bars", title: "p95 одной и той же починки", bars: [
    { label: "одна виртуалка", value: 0.12, text: "63 мс", bad: false },
    { label: "рядом другие виртуалки", value: 0.9, text: "485 мс", bad: true },
  ] },
  falseGreen: { kind: "bars", title: "Ложная: убрали FOR UPDATE", bars: [
    { label: "писем за проверку", value: 0.9, text: "616, порог 200", bad: false },
    { label: "заказов с повторным письмом", value: 0.35, text: "79", bad: true },
  ] },
  restart: { kind: "chart", title: "Ошибки по секундам на верной починке", points: [...flat(5), 1, ...flat(5)], mark: { at: 5, label: "рестарт" }, note: "за проверку: 0,7%\nпорог: 0,5%", bad: true },
  substring: { kind: "vs", title: "Тест подсказки ищет слово", left: { head: "ищем", text: "«перезапускался»" }, right: { head: "нашлось внутри", text: "«не перезапускался»", bad: true } },
  pool: { kind: "vs", title: "Почему тормозят заказы", left: { head: "думали", text: "кончился пул\nсоединений" }, right: { head: "снимок со стенда", text: "пул занят не весь,\nпроцессор базы — 100%", bad: true } },
  pgStart: { kind: "vs", title: "Запуск базы на стенде", left: { head: "записали по логу", text: "PostgreSQL\nстартует 5 с" }, right: { head: "на деле", text: "таймаут DNS\nи падение", bad: true } },
} satisfies Record<string, Picture>;

/** Общее начало: схема по звеньям, норма, хук, подозреваемые. */
function intro(d: Board): void {
  d.scene("Титул");
  d.v("Мы делаем тренажёр для бэкендеров. Сегодня — о том, почему ни одна наша задача не сошлась с первого раза " +
    "и почему виновато в этом почти никогда не решение.", (w) => {
    w.title = { head: "кухня тренажёра", text: "Почему верная починка\nне проходит с первого раза" };
  });

  d.scene("Стенд");
  d.v("Каждая задача тренажёра — живой сервис с базой, в своей виртуалке. В сервис мы нарочно заложили поломку.", (w) => {
    w.on.vm = true;
  }, ["vm"]);
  d.v("На сервис идёт нагрузка — запросы, как от настоящих покупателей.", (w) => {
    w.on.load = true;
  }, ["load"]);
  d.v("Ученик видит графики: ошибки, время ответа, очередь. Поломка проявилась — срабатывает алерт.", (w) => {
    w.on.graphs = true;
    w.alert = true;
    w.events.push({ kind: "red" });
  }, ["graphs"]);
  d.v("Ученик ищет причину и чинит. А мы заранее собираем набор починок: верные — и ложные, которые выглядят разумно, но не лечат.", (w) => {
    w.on.deck = true;
  }, ["deck"]);
  d.v("Проверка гоняет починенный сервис и выносит вердикт. Ложная починка — красное. Здесь красное — это хорошо: обман пойман.", (w) => {
    w.on.check = true;
    w.on.verdict = true;
    d.apply(w, false, "рестарт сервиса");
    d.judge(w, "red");
  }, ["deck", "vm", "check", "verdict"]);
  d.v("Верная — зелёное, графики успокоились. Так и должно быть.", (w) => {
    d.apply(w, true, "верная починка");
    d.judge(w, "green");
    w.alert = false;
  }, ["deck", "vm", "graphs", "check", "verdict"]);
  d.v("Весь набор прогоняет CI: каждую починку — через проверку, и вердикт сверяет с тем, что мы ждали. Совпало — CI зелёный.", undefined,
    ["deck", "verdict"]);

  d.scene("Хук", d.w, { replay: true });
  d.v("А теперь честно: вы видели красный CI на верном коде? У нас так бывало не раз. Починка верная — а вердикт красный. Ученик решил правильно, а тренажёр его отругал.", (w) => {
    w.verdict.lamp = null;
    d.judge(w, "red");
  }, ["deck", "verdict"]);
  d.v("Решение тут ни при чём. Врёт что-то из того, что вокруг него. Подозреваемых четверо. Первый — площадка: всё это " +
    "крутится на ноутбуке или на машине CI.", (w) => {
    w.on.site = true;
  }, ["site"]);
  d.v("Второй — нагрузка. Третий — сама проверка: что она считает и когда.", undefined, ["load", "check"]);
  d.v("И четвёртый — мы. Наши представления о том, как устроена система.", (w) => {
    w.author.on = true;
    w.on.model = true;
    w.author.mood = "lost";
  }, ["author", "model"]);
}

/** Шум — из другой задачи: в пути failing-orders его не было. */
function noise(d: Board, lead: string): void {
  d.v(lead + "Одна и та же починка: в одиночку p95 — шестьдесят три миллисекунды, а рядом с другими виртуалками — " +
    "четыреста восемьдесят пять. Вердикт по такой цифре — монетка.", (w) => {
    w.pic = PIC.noise;
    w.loop.on = false;
    d.meet(w, 1);
  }, ["site", "pic", "shelf"]);
  d.v("Правим площадку: гоняем по одной виртуалке. Честно скажем, шум машины CI мы не победили до сих пор.", (w) => {
    w.site = "одна виртуалка за раз";
    d.edit(w, "site");
  }, ["site"]);
}

/** Контрапункт: ложное зелёное. Проверка врёт и в другую сторону — поэтому их несколько. */
function falseGreen(d: Board): void {
  d.scene("Ложное зелёное", d.w, { replay: true });
  d.v("Врать проверка может и в другую сторону. Задача про очередь писем, как в первом эпизоде. Ложная починка: " +
    "убрали FOR UPDATE.", (w) => {
    w.pic = null;
    w.shelf.active = null;
    w.loop.on = false;
    w.ciOn = true;
    d.apply(w, false, "без FOR UPDATE");
    w.check = "писем в секунду";
  }, ["deck", "vm", "check"]);
  d.v("Будь у нас только проверка скорости, она бы её пропустила: шестьсот шестнадцать писем при пороге двести.", (w) => {
    w.pic = { ...PIC.falseGreen, bars: [PIC.falseGreen.bars[0]] };
  }, ["check", "verdict", "pic"]);
  d.v("Поэтому рядом с самого начала стоит вторая: о семидесяти девяти заказах ушло больше одного письма. Без блокировки два обработчика брали одну задачу.", (w) => {
    w.check = "скорость\nи повторные письма";
    d.judge(w, "red");
    w.pic = PIC.falseGreen;
  }, ["check", "verdict", "pic"]);
}

function finale(d: Board): void {
  d.scene("Итог", d.w, { replay: true });
  d.v("Посмотрите на счёт. У верной починки — ни одной правки. Все правки — вокруг неё: площадка, нагрузка, проверка и наши представления.", (w) => {
    d.apply(w, true, "верная починка");
    d.judge(w, "green");
    w.pic = null;
    w.shelf.active = null;
    w.loop.on = false;
    w.author.mood = "won";
    w.tally = true;
  }, [...LINKS, "author"]);
  d.v("Вместе это и есть измерение. Решение — малая часть работы. Основная — сделать так, чтобы измерение не врало.", (w) => {
    w.moral = MORAL;
  });
}

/** Ход «цикл»: настоящий путь одной задачи по кругу. */
export function buildCycle(): Step<World>[] {
  const d = new Board();
  intro(d);
  d.scene("Путь задачи", d.w, { replay: true });
  d.v("Вот как это было на одной задаче — «Часть заказов падает». Покупатели жмут «Повторить заказ», и два заказа " +
    "с общими товарами, взятыми во встречном порядке, блокируют друг друга: дедлок. Путь всегда один: не сходится, ищем почему, правим, гоняем снова.", (w) => {
    w.loop.on = true;
    w.shelf.on = true;
    w.author.mood = "idle";
    w.verdict = { lamp: null, expect: null };
    w.ciOn = false;
    w.card = null;
  }, ["vm", "loop", "shelf"]);

  // Круг 1 — нагрузка не воспроизводит поломку.
  d.v("Круг первый. Подаём ровную нагрузку — а нужной картины нет. Чуть меньше запросов — ноль ошибок, чуть больше — лавина за десять секунд, и через минуту падает почти всё.", (w) => {
    w.loop.lap = 1;
    w.loop.at = 0;
    w.pic = PIC.cliff;
  }, ["load", "graphs", "pic", "loop"]);
  d.v("Почему? Дедлок рождает не средний поток, а одновременность. В жизни это пуш «Повторите заказ» — и все жмут разом.", (w) => {
    w.loop.at = 1;
    d.meet(w, 2);
  }, ["load", "pic", "shelf", "loop"]);
  d.v("Правим нагрузку: залпы, шестнадцать повторов разом раз в десять секунд.", (w) => {
    w.loop.at = 2;
    d.edit(w, "load");
    w.load = "bursts";
    w.pic = null;
  }, ["load", "loop"]);
  d.v("Гоняем снова — ошибки пошли волнами, часть заказов падает, как в жизни. Алерт сработал.", (w) => {
    w.loop.at = 3;
    w.alert = true;
    w.pic = PIC.waves;
  }, ["load", "graphs", "pic", "loop"]);

  // Круг 2 — проверка меряет не то: верную отвергли.
  d.v("Круг второй. Проверка отвергает верную починку.", (w) => {
    w.loop.lap = 2;
    w.loop.at = 0;
    w.check = "откаты транзакций";
    d.apply(w, true, "закрыть чтение откатом");
    d.judge(w, "red");
    w.pic = null;
  }, ["deck", "check", "verdict", "loop"]);
  d.v("Почему? Лишнюю работу проверка искала по откатам транзакций. А эта верная починка закрывает откатом безобидное чтение.", (w) => {
    w.loop.at = 1;
    w.pic = PIC.rollbacks;
    d.meet(w, 3);
  }, ["check", "pic", "shelf", "loop"]);
  d.v("Меняем, что считаем: дыры в номерах заказов и лишние обновления строк. Номер, выданный откаченной попытке, назад не возвращается.", (w) => {
    w.loop.at = 2;
    d.edit(w, "check");
    w.check = "дыры в номерах";
    w.pic = PIC.holes;
  }, ["check", "pic", "loop"]);
  d.v("Гоняем снова — верная проходит.", (w) => {
    w.loop.at = 3;
    d.judge(w, "green");
    w.pic = null;
  }, ["check", "verdict", "loop"]);

  // Круг 3 — ложная прошла: нагрузка самой проверки не та.
  d.v("Круг третий. Теперь наоборот: ложная починка проходит. Сортировка товаров только при создании заказа — и проверка довольна.", (w) => {
    w.loop.lap = 3;
    w.loop.at = 0;
    d.apply(w, false, "сортировка\nв createOrder");
    d.judge(w, "green");
    w.pic = null;
  }, ["deck", "verdict", "loop"]);
  d.v("Почему? Залп проверки повторял заказы, которые проверка сама только что создала, — а они уже отсортированы. Поломку дают старые заказы.", (w) => {
    w.loop.at = 1;
    w.pic = PIC.ownOrders;
    d.meet(w, 2);
  }, ["check", "pic", "shelf", "loop"]);
  d.v("Правим проверку: кладём в базу пару старых заказов со встречным порядком, и залп повторяет их.", (w) => {
    w.loop.at = 2;
    d.edit(w, "check");
    w.verdict.lamp = null;
  }, ["check", "vm", "loop"]);
  d.v("Гоняем снова — ложная ловится: красное.", (w) => {
    w.loop.at = 3;
    d.judge(w, "red");
  }, ["check", "verdict", "loop"]);

  // Круг 4 — модель против стенда.
  d.v("Круг четвёртый — ошиблись мы сами. В разборе для ученика мы написали: в волне падают и чтения. Так было на прошлом замере, при лавине.", (w) => {
    w.loop.lap = 4;
    w.loop.at = 0;
    w.card = null;
    w.verdict = { lamp: null, expect: null };
    w.model = "в волне падают\nи чтения";
    w.pic = null;
  }, ["author", "model", "loop"]);
  d.v("Сняли со стенда: все ответы 503 — на повторах заказа, у чтений ни одного. Залпы — не лавина.", (w) => {
    w.loop.at = 1;
    w.pic = PIC.reads;
    d.meet(w, 4);
  }, ["model", "pic", "shelf", "loop"]);
  d.v("Правим себя: разбор пишем по снимкам со стенда, а не по памяти.", (w) => {
    w.loop.at = 2;
    d.edit(w, "model");
    w.model = "падают только\nповторы заказа";
  }, ["model", "loop"]);
  d.v("А весь набор к этому времени зелёный в CI: верные проходят, ложные ловятся.", (w) => {
    w.loop.at = 3;
    w.ciOn = true;
    d.apply(w, true, "сортировка\nво всех местах");
    d.judge(w, "green");
    w.pic = null;
    w.author.mood = "won";
  }, ["deck", "verdict", "loop"]);

  d.scene("Ещё две причины", d.w, { replay: true });
  noise(d, "Ещё две причины в этой задаче не встретились — зато в других их хватало. Первая — шум. ");
  d.v("Вторая — окно перехода. Верная починка, а ошибок семь десятых процента при пороге пол-процента. Все — в момент " +
    "рестарта сервиса; до и после — ровный ноль. Правим проверку: она начинается, когда сервис уже ответил.", (w) => {
    w.pic = PIC.restart;
    d.meet(w, 0);
    d.edit(w, "check");
  }, ["check", "pic", "shelf"]);
  falseGreen(d);
  finale(d);
  return d.steps;
}

/** Ход «пять причин»: по очереди, по одному-два примера, каждый подсвечивает своё звено. */
export function buildClasses(): Step<World>[] {
  const d = new Board();
  intro(d);
  d.v("Из всех наших задач случаи сложились в пять причин. Разберём по одной.", (w) => {
    w.shelf.on = true;
    w.author.mood = "idle";
    w.verdict = { lamp: null, expect: null };
    w.card = null;
  }, ["shelf"]);

  const chapter = (n: ClassNo, voice: string, focus: Focus[]) => {
    d.scene(`${n + 1}. ${CLASSES[n]}`, d.w, { replay: true });
    d.v(voice, (w) => {
      w.plate = CLASSES[n][0].toUpperCase() + CLASSES[n].slice(1);
      d.meet(w, n);
      w.pic = null;
      w.card = null;
      w.verdict = { lamp: null, expect: null };
    }, focus);
  };
  const example = (voice: string, pic: Picture, focus: Focus[], then?: (w: World) => void) =>
    d.v(voice, (w) => {
      w.pic = pic;
      then?.(w);
    }, ["pic", ...focus]);
  const rule = (voice: string, link: Editable, then?: (w: World) => void) =>
    d.v(voice, (w) => {
      d.edit(w, link);
      then?.(w);
    }, [link, "shelf"]);

  chapter(0, "Первая — окно перехода. Сервис перезапускается, а проверка меряет как раз в этот момент.", ["check", "shelf"]);
  example("Верная починка — и семь десятых процента ошибок при пороге пол-процента. Все ошибки — в момент рестарта; " +
    "до и после — ровный ноль.", PIC.restart, ["deck", "verdict"], (w) => {
    d.apply(w, true, "верная починка");
    d.judge(w, "red");
  });
  example("Другая задача: счётчики базы после залпа. Простаивающее соединение отдаёт их с задержкой до десяти секунд — " +
    "прочтёшь раньше — посчитаешь не тот залп.", PIC.stats, ["check"], (w) => {
    w.card = null;
    w.verdict = { lamp: null, expect: null };
  });
  rule("Правило: меряем, когда переход закончился, — проверка начинается после того, как сервис ответил, счётчики читаем через одиннадцать секунд.", "check",
    (w) => (w.check = "после перехода"));

  chapter(1, "Вторая — шум под видом сигнала. Цифра дёргается не от решения, а от того, что творится вокруг.", ["site", "shelf"]);
  noise(d, "");

  chapter(2, "Третья — нагрузка не та. Поломка есть, а стенд её не показывает.", ["load", "shelf"]);
  example("Дедлок при ровной нагрузке: чуть меньше запросов — ноль ошибок, чуть больше — лавина. Алерта не построить. " +
    "В жизни дедлок рождает одновременность — пуш, распродажа.", PIC.cliff, ["load", "graphs"]);
  rule("Правим нагрузку: залпы, шестнадцать запросов разом. Ошибки пошли волнами, как в жизни.", "load", (w) => {
    w.load = "bursts";
    w.alert = true;
    w.pic = PIC.waves;
  });
  example("Та же беда бывает у самой проверки: её залп повторял заказы, которые она сама создала, — уже отсортированные. " +
    "Ложная починка проходила.", PIC.ownOrders, ["check", "verdict"], (w) => {
    d.apply(w, false, "сортировка\nв createOrder");
    d.judge(w, "green");
  });
  rule("Правило: прежде чем проверять починку, смотрим на стенде, как выглядит сама поломка.", "check");

  chapter(3, "Четвёртая — мерим не то. Цифра честная, только она не про причину.", ["check", "shelf"]);
  example("Проверка искала лишнюю работу по откатам транзакций — и отвергала верную починку, которая закрывает откатом безобидное чтение.",
    PIC.rollbacks, ["check", "deck", "verdict"], (w) => {
      d.apply(w, true, "закрыть чтение откатом");
      d.judge(w, "red");
    });
  rule("Стали считать дыры в номерах заказов и лишние обновления строк — номер откаченной попытки назад не возвращается.", "check",
    (w) => (w.check = "дыры в номерах"));
  example("Бывает и смешнее. Тест подсказки искал слово «перезапускался» — и находил его внутри «не перезапускался». " +
    "Тест подсказки прошёл бы и с чужой подсказкой.", PIC.substring, ["check"], (w) => {
    w.card = null;
    w.verdict = { lamp: null, expect: null };
  });
  rule("Правило: через проверку гоняем и верные, и ложные починки — она должна их различать.", "check");

  chapter(4, "Пятая — наша модель расходится со стендом. Мы уверены, как всё устроено, а стенд устроен иначе.", ["model", "author", "shelf"]);
  example("Разбор задачи «тормозят заказы» мы писали уверенно: кончился пул соединений. Сняли со стенда: пул занят не весь, " +
    "процессор базы — на сто процентов.", PIC.pool, ["model", "author"], (w) => {
    w.model = "кончился пул\nсоединений";
  });
  example("Или запись в наших заметках: «PostgreSQL стартует пять секунд». На деле это был таймаут DNS и падение — отметка в логе не доказывает успех.",
    PIC.pgStart, ["model", "author"], (w) => {
      w.model = "PostgreSQL\nстартует 5 с";
    });
  rule("Правило: причину называем только с цифрами со стенда.", "model", (w) => (w.model = "только с цифрами\nсо стенда"));

  falseGreen(d);
  finale(d);
  return d.steps;
}
