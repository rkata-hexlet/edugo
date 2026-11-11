import type { Step } from "../../engine/contract";
import { Director } from "../../kit/director";
import { CLASSES, world, type ClassNo, type Focus, type Picture, type Who, type World } from "./sim";

// Два наброска хода нового формата кухни (решение пользователя 11.11, `docs/episodes/kitchen-01-state.md`):
// тема — почему верное решение не проходит проверку с первого раза: врёт не решение, а прибор.
//   `kc` — один цикл «красное → почему → правка → снова», классы встречаются по ходу;
//   `kk` — пять классов по очереди, по два-три примера.
// Серые фигуры фазы 0: сравнить ход, а не отделку. Примеры — из сюжетов incident-lab (`docs/state.md`, CLAUDE.md).

export const OUTRO = "Решение — малая часть работы. Основная — сделать так, чтобы измерение не врало";
const MORAL = "Решение — малая часть работы.\nОсновная — сделать так,\nчтобы измерение не врало";

export const PRONOUNCE: Record<string, string> = {
  "incident-lab": "инсидент лаб",
  "keep-alive": "кип-элайв",
  busybox: "бизибокс",
  cgroup: "си-группа",
  sed: "сед",
  CPU: "си-пи-ю",
  OOM: "о-о-эм",
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
    for (const k of ["agent", "author"] as Who[]) w.crew[k].say = null;
  }
  protected carded(w: World): boolean {
    return !!w.plate || !!w.title;
  }

  v(voice: string, action?: (w: World) => void, focus?: Focus[]): void {
    this.shot("", action, { voice, ...(focus ? { focus } : {}) });
  }

  // Глаголы.
  red(w: World): void {
    w.chain.verdict = "red";
    w.loop.at = 0;
    w.events.push({ kind: "red" });
  }
  why(w: World): void {
    w.loop.at = 1;
  }
  edit(w: World, gauge: string): void {
    w.chain.gauge = gauge;
    w.chain.gaugeEdits++;
    w.chain.verdict = null;
    w.loop.at = 2;
    w.events.push({ kind: "edit" });
  }
  green(w: World): void {
    w.chain.verdict = "green";
    w.loop.at = 3;
    w.events.push({ kind: "green" });
  }
  meet(w: World, n: ClassNo): void {
    if (!w.shelf.met.includes(n)) w.shelf.met.push(n);
    w.shelf.active = n;
    w.events.push({ kind: "met" });
  }
  say(w: World, who: Who, text: string, mood: World["crew"][Who]["mood"] = "talk"): void {
    w.crew[who].say = text;
    w.crew[who].mood = mood;
  }
}

// Картинки примеров — общие для обоих ходов.
const flat = (n: number, v = 0.04) => Array.from({ length: n }, () => v);
const PIC = {
  pool: { kind: "vs", title: "Сервис заказов тормозит", left: { head: "на бумаге", text: "кончился пул\nсоединений" }, right: { head: "замер на стенде", text: "пул свободен,\nупёрся CPU", bad: true } },
  cliff: { kind: "chart", title: "Ошибки при ровной нагрузке", points: [...flat(7), 0.9, 1, 1, 1], limit: null, mark: { at: 6, label: "чуть больше нагрузки" }, bad: true },
  waves: { kind: "chart", title: "Ошибки при нагрузке залпами", points: [0.05, 0.6, 0.1, 0.05, 0.65, 0.1, 0.05, 0.6, 0.1, 0.05, 0.62], limit: null, mark: null, bad: true },
  rollbacks: { kind: "bars", title: "Проверка считает откаты транзакций", bars: [
    { label: "поломка", value: 0.9, text: "много", bad: true },
    { label: "верная починка", value: 0.55, text: "тоже много", bad: true },
  ] },
  holes: { kind: "vs", title: "Что выдаёт лишнюю работу", left: { head: "считали", text: "все откаты,\nи чтение тоже" }, right: { head: "меряем", text: "дыры в номерах\nзаказов", bad: false } },
  noise: { kind: "bars", title: "Время ответа, тот же код, два прогона", bars: [
    { label: "прогон один", value: 0.12, text: "63 мс", bad: false },
    { label: "рядом второй прогон", value: 0.9, text: "485 мс", bad: true },
  ] },
  restart: { kind: "chart", title: "Ошибки на верной починке, %", points: [...flat(5), 0.7, ...flat(5)], limit: 0.5, mark: null, bad: true },
  restartMarked: { kind: "chart", title: "Ошибки на верной починке, %", points: [...flat(5), 0.7, ...flat(5)], limit: 0.5, mark: { at: 5, label: "рестарт" }, bad: true },
  zero: { kind: "chart", title: "Ошибки на верной починке после рестарта, %", points: flat(11, 0), limit: 0.5, mark: null, bad: false },
  cgroup: { kind: "vs", title: "Каждый процесс сервиса — в своей cgroup?", left: { head: "в системе", text: "процесс ещё виден" }, right: { head: "в cgroup", text: "его уже нет:\n2 из 150 чтений", bad: true } },
  goroutines: { kind: "bars", title: "Горутин прибавилось после нагрузки", bars: [
    { label: "все горутины", value: 0.5, text: "шумит", bad: true },
    { label: "только сервиса", value: 0, text: "ровно 0", bad: false },
  ] },
  memory: { kind: "vs", title: "Память сервиса упёрлась в лимит", left: { head: "ждали", text: "ядро убьёт:\nOOM" }, right: { head: "на стенде", text: "пробуксовка:\nзапрос 8–12 с,\nубийств 0", bad: true } },
  tail: { kind: "vs", title: "Проверка задержки писем", left: { head: "мерили", text: "как быстро дойдут\nписьма проверки" }, right: { head: "на стенде", text: "впереди хвост\nв 30 000 задач", bad: true } },
  substring: { kind: "vs", title: "Проверка подсказки в e2e", left: { head: "ищем строку", text: "«перезапускался»" }, right: { head: "нашли в", text: "«не перезапускался»", bad: true } },
  zeroRows: { kind: "vs", title: "Что получит ждущий обработчик", left: { head: "на бумаге", text: "ноль строк" }, right: { head: "замер", text: "следующую строку", bad: false } },
  sed: { kind: "vs", title: "Проверка отказала верной починке", left: { head: "мы решили", text: "ошибка проверки" }, right: { head: "на стенде", text: "busybox sed\nмолча не применил", bad: true } },
} satisfies Record<string, Picture>;

function intro(d: Board): void {
  d.scene("Титул");
  d.v("Это incident-lab — тренажёр для бэкендеров: живой сервис с настоящей поломкой и проверка, которая отличает " +
    "верную починку от ложной. Сегодня — что мы поняли, пока делали для него сюжеты.", (w) => {
    w.title = { head: "incident-lab", text: "Врёт не решение,\nа прибор" };
  });
  d.scene("Завязка");
  d.v("Каждый сюжет устроен одинаково. Слева — решение: верную починку мы знаем заранее. Справа — вердикт проверки. " +
    "А между ними прибор — то, чем проверка меряет сервис.", (w) => {
    w.chain.on = true;
    w.chain.gauge = "ошибки и задержка";
  }, ["chain"]);
  d.v("Решение верное — значит, вердикт сразу зелёный? Ни разу. Ни один сюжет не позеленел с первого прогона.", (w) => {
    d.red(w);
    w.loop.at = null;
    w.crew.agent.on = true;
    w.crew.agent.mood = "lost";
  }, ["chain", "agent"]);
}

function finale(d: Board): void {
  d.scene("Итог", d.w, { replay: true });
  d.v("Посмотрите на счётчики. У решения — ни одной правки. Все правки достались прибору.", (w) => {
    w.shelf.active = null;
    w.pic = null;
  }, ["fix", "gauge"]);
  d.v("Решение — малая часть работы. Основная — сделать так, чтобы измерение не врало.", (w) => {
    w.moral = MORAL;
  });
}

/** Ход «цикл»: один путь по кругу, классы встречаются по ходу. */
export function buildCycle(): Step<World>[] {
  const d = new Board();
  intro(d);
  d.v("Путь соберём из разных наших сюжетов — он почти всегда один и тот же. Красное, ищем почему, правим, " +
    "гоняем снова. На каждом круге нам попадалась одна из пяти причин — они займут места на этой полке.", (w) => {
    w.loop.on = true;
    w.loop.at = 0;
    w.shelf.on = true;
    w.shelf.byMeet = true;
    w.crew.author.on = true;
    w.crew.agent.mood = "idle";
  }, ["loop", "shelf"]);

  // Круг 1 — модель в голове против стенда.
  d.v("Круг первый. Сервис заказов тормозит, и по коду мы уверены: кончается пул соединений с базой. Прибор ставим на пул.", (w) => {
    w.loop.lap = 1;
    w.loop.at = null;
    w.chain.verdict = null;
    w.chain.gauge = "пул соединений";
    d.say(w, "author", "Узкое место — пул");
  }, ["gauge", "author"]);
  d.v("Гоняем верную починку — красное. Пул свободен, а запросы всё равно медленные.", (w) => {
    d.red(w);
    w.crew.author.mood = "idle";
  }, ["chain", "loop"]);
  d.v("Почему? Замеряем стенд, а не читаем код: упирается процессор. Узкое место было не там, где мы его нарисовали.", (w) => {
    d.why(w);
    w.pic = PIC.pool;
  }, ["pic", "loop"]);
  d.v("Первая находка на полку: модель в голове расходится со стендом. Правим прибор — меряем и пул, и процессор, " +
    "а причину называем только с цифрами.", (w) => {
    d.meet(w, 4);
    d.edit(w, "замер CPU и пула");
  }, ["gauge", "shelf", "loop"]);

  // Круг 2 — нагрузка не воспроизводит поломку.
  d.v("Круг второй, сюжет про взаимную блокировку. Подаём ровную нагрузку — и поломка то молчит, то обваливает всё разом. " +
    "Отличить на этом верную починку проверке не с чем: красное.", (w) => {
    w.loop.lap = 2;
    d.red(w);
    w.pic = PIC.cliff;
  }, ["pic", "loop"]);
  d.v("Почему: ровная нагрузка не воспроизводит поломку. Дедлок при ней — либо ноль, либо лавина, а в жизни он идёт волнами.", (w) => {
    d.why(w);
    d.meet(w, 2);
  }, ["pic", "shelf", "loop"]);
  d.v("Правим нагрузку: подаём залпами. Теперь поломка даёт волны ошибок, а верная починка их гасит.", (w) => {
    d.edit(w, "нагрузка залпами");
    w.pic = PIC.waves;
  }, ["gauge", "pic", "loop"]);

  // Круг 3 — проверка меряет не то.
  d.v("Круг третий — и снова красное, хотя починка верная. Проверка считала откаты транзакций: мол, сервис делает лишнюю работу.", (w) => {
    w.loop.lap = 3;
    d.red(w);
    w.pic = PIC.rollbacks;
  }, ["pic", "loop"]);
  d.v("Почему: откатываются и безобидные транзакции, которые только читают. Верная починка их тоже делает — прибор мерил не то.", (w) => {
    d.why(w);
    d.meet(w, 3);
    d.say(w, "agent", "Это же просто чтение");
  }, ["pic", "shelf", "agent"]);
  d.v("Меняем, что мерим: лишнюю работу выдают дыры в номерах заказов. Номер, выданный откаченной попытке, назад не возвращается.", (w) => {
    d.edit(w, "дыры в номерах");
    w.pic = PIC.holes;
    w.crew.agent.mood = "idle";
  }, ["gauge", "pic", "loop"]);

  // Круг 4 — шум под видом сигнала.
  d.v("Круг четвёртый. Время ответа прыгает от прогона к прогону: шестьдесят три миллисекунды, потом четыреста восемьдесят пять. Красное.", (w) => {
    w.loop.lap = 4;
    d.red(w);
    w.pic = PIC.noise;
  }, ["pic", "loop"]);
  d.v("Почему: на той же машине рядом шёл второй прогон и отнимал ресурсы. Шум выдавал себя за сигнал.", (w) => {
    d.why(w);
    d.meet(w, 1);
    d.say(w, "author", "Кто там ещё гоняет?", "lost");
  }, ["pic", "shelf", "author"]);
  d.v("Правка: прогоняем по одному, как работает ученик.", (w) => {
    d.edit(w, "один прогон за раз");
    w.crew.author.mood = "idle";
  }, ["gauge", "loop"]);

  // Круг 5 — окно перехода.
  d.v("Круг пятый. Ошибок семь десятых процента при пороге в половину процента — снова красное.", (w) => {
    w.loop.lap = 5;
    d.red(w);
    w.pic = PIC.restart;
  }, ["pic", "loop"]);
  d.v("Смотрим, когда они случились: все пришлись на перезапуск сервиса после правки. Окно перехода.", (w) => {
    d.why(w);
    d.meet(w, 0);
    w.pic = PIC.restartMarked;
  }, ["pic", "shelf", "loop"]);
  d.v("Меряем после того, как рестарт закончился. На верной починке остаётся ровно ноль — и порог уже не спрячет настоящий сбой.", (w) => {
    d.edit(w, "после рестарта");
    w.pic = PIC.zero;
  }, ["gauge", "pic", "loop"]);
  d.v("Гоняем снова — зелёное.", (w) => {
    d.green(w);
    w.crew.agent.mood = "won";
    w.crew.author.mood = "won";
  }, ["chain", "loop"]);

  finale(d);
  return d.steps;
}

/** Ход «пять классов»: по очереди, у каждого два-три примера и правило. */
export function buildClasses(): Step<World>[] {
  const d = new Board();
  intro(d);
  d.v("Почему так? Мы собрали все случаи из наших сюжетов, и они легли в пять причин. Разберём по одной.", (w) => {
    w.shelf.on = true;
    w.crew.author.on = true;
    w.crew.agent.mood = "idle";
    w.chain.verdict = null;
  }, ["shelf"]);

  const chapter = (n: ClassNo, voice: string) => {
    d.scene(`${n + 1}. ${CLASSES[n]}`, d.w, { replay: true });
    d.v(voice, (w) => {
      w.plate = CLASSES[n][0].toUpperCase() + CLASSES[n].slice(1);
      d.meet(w, n);
      w.pic = null;
      w.chain.verdict = null;
      w.chain.gauge = "?"; // прибор главы ещё не найден — его даст правило
    });
  };
  const example = (voice: string, pic: Picture, then?: (w: World) => void) =>
    d.v(voice, (w) => {
      w.pic = pic;
      d.red(w);
      w.loop.at = null;
      then?.(w);
    }, ["pic", "chain"]);
  const rule = (voice: string, gauge: string) =>
    d.v(voice, (w) => {
      d.edit(w, gauge);
      w.loop.at = null;
    }, ["gauge", "shelf"]);

  chapter(0, "Первая — окно перехода. Сервис перезапускается или процесс завершается, а проверка меряет как раз в этот момент.");
  example("Верная починка дала семь десятых процента ошибок при пороге в половину. Все они пришлись на рестарт после правки.", PIC.restartMarked);
  example("В другом сюжете проверка сверяла, что каждый процесс сервиса сидит в своей cgroup. Завершающийся процесс из неё " +
    "уже вышел, но в системе ещё виден — и в двух чтениях из ста пятидесяти проверка видела чужака.", PIC.cgroup);
  rule("Правило: измерение должно пережить окно перехода — ждём конца рестарта или повторяем чтение.", "без окна рестарта");

  chapter(1, "Вторая — шум под видом сигнала. Прибор дёргается не от решения, а от того, что творится вокруг.");
  example("Тот же код, два прогона: шестьдесят три миллисекунды и четыреста восемьдесят пять. Рядом на той же машине шёл второй прогон.", PIC.noise);
  example("Счёт горутин до и после нагрузки шумел от keep-alive соединений. Стали считать только горутины самого сервиса — " +
    "на верной починке ровно ноль.", PIC.goroutines, (w) => d.say(w, "agent", "Откуда лишние горутины?", "lost"));
  rule("Правило: шум разбираем до нуля, а не прячем порогом.", "шум — до нуля");

  chapter(2, "Третья — нагрузка не воспроизводит поломку. Поломка есть, а стенд её не показывает или показывает не такой.");
  example("Взаимная блокировка при ровной нагрузке: то ноль ошибок, то лавина. Волн, как в жизни, нет. Помогли залпы.", PIC.cliff);
  example("С памятью ждали, что ядро убьёт сервис. А оно не убивало — пробуксовывало: запросы по восемь–двенадцать секунд, убийств ноль.", PIC.memory);
  rule("Правило: прежде чем проверять починку, смотрим на стенде, как выглядит сама поломка.", "нагрузка как в жизни");

  chapter(3, "Четвёртая — проверка меряет не то. Прибор честно показывает число, только число это не про причину.");
  example("Проверка задержки писем заваливала позднюю верную починку: письма проверки вставали в хвост очереди в тридцать тысяч задач.", PIC.tail);
  example("Откаты транзакций считались лишней работой — а откатывались и безобидные чтения. Верная починка их тоже делает.", PIC.rollbacks);
  example("И даже проверка подсказок в e2e: искали слово «перезапускался» — а оно нашлось внутри «не перезапускался».", PIC.substring,
    (w) => d.say(w, "author", "Ну конечно", "lost"));
  rule("Правило: через прибор прогоняем и верные, и ложные починки — он должен их различать.", "верные и ложные");

  chapter(4, "Пятая — модель в голове расходится со стендом. Мы уверены, как всё устроено, а стенд устроен иначе.");
  example("По коду мы были уверены: кончается пул соединений. Замер показал — упирается процессор.", PIC.pool);
  example("Думали, что обработчик, дождавшийся строки, получит ноль строк. Замер: он берёт следующую.", PIC.zeroRows);
  example("А однажды проверка верно отказала, а мы приняли это за её ошибку: на стенде busybox, и его sed молча не применил правку.", PIC.sed);
  rule("Правило: причину провала называем только с цифрами замера на стенде.", "замер на стенде");

  d.scene("Итог", d.w, { replay: true });
  d.v("Полка заполнена. И везде одно и то же: решение было верным, врал прибор.", (w) => {
    d.green(w);
    w.loop.at = null;
    w.shelf.active = null;
    w.pic = null;
    w.crew.agent.mood = "won";
    w.crew.author.mood = "won";
  }, ["chain", "shelf"]);
  finale(d);
  return d.steps;
}
