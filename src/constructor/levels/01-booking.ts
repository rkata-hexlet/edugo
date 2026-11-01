import { unit, type Level } from "../model/sim";

/** Уровень 1 «Бронь через медленного поставщика» (docs/constructor/level-01.md). Тик = 100 мс. */
const params: Level["params"] = {
  tickMs: 100,
  pool: 6,
  search: { every: 5, hold: 2, maxWait: 10 },
  guestWait: 100,
  budget: 95,
  timeout: 30,
  attempts: 3,
  backoff: 10,
  breaker: { window: 20, trip: 16, open: 100 },
  storm: { window: 3, cap: 3 },
  slowRefusal: { after: 10, max: 30 },
};

const FAST = 5;
const SLOW = 300;
/** Беда A нарастает: первые волны малы, пул занимается на глазах (показ 01.11: «беды A не понять»). */
const RAMP = [1, 2, 3, 4, 6];

const phases: Level["phases"] = [
  {
    id: "D1",
    ticks: 400,
    waves: { every: 20, size: 8, until: 300, ramp: RAMP },
    // первая попытка: ровно половина волны застревает в очереди поставщика; повторы — как повезёт
    latency: (g, attempt) =>
      (attempt === 1 ? (g.seat + g.wave) % 2 === 0 : unit(g.id, attempt) < 0.5) ? SLOW : FAST,
  },
  {
    id: "D2",
    ticks: 1000,
    waves: { every: 20, size: 8, until: 900 },
    down: { from: 40, to: 640 },
    latency: () => FAST,
  },
];

/** Стоп-кадр: поломка, а не кирпич (решение не подсказываем), и кадр ролика 10 с этим кейсом. */
const failures: Level["failures"] = {
  P1: { text: "Поиск встал: все соединения заняты бронями", frame: 12 },
  P2: { text: "Гость ждал ответа и увидел ошибку", frame: 16 },
  P3: { text: "У гостя две брони: заплатит дважды", frame: 27 },
  P4: { text: "Повторы пришли к поставщику разом", frame: 28 },
  P5: { text: "Гость ждёт 10 с ради ошибки, повторы добивают поставщика", frame: 37 },
  P6: { text: "Выключатель не щёлкает: вызовы висят без ответа", frame: 39 },
  P7: { text: "Поставщик лежит, а гость всё равно ждёт ради ошибки", frame: 37 },
};

export const level: Level = { id: "01-booking", title: "Бронь через медленного поставщика", params, phases, failures };
