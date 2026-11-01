// Серая схема уровня 1 (MVP, без полировки): Гости → Сервис отеля [пул, переключатели кирпичей] → Поставщик.
// Рисует только через Pen; переключатели помечены data-slot — касание ловит контроллер.
import type { Pen } from "../../engine/contract";
import { COLOR, FONT } from "../../kit/theme";
import { SHOWN, type Brick, type Rule, type Snapshot } from "../model/sim";

export const VIEW = { w: 400, h: 624 } as const;

/** Что красить красным на стоп-кадре: поломку, а не кирпич. */
type Culprit = "guest" | "pool" | "wire" | "supplier";
const CULPRIT: Record<Rule, Culprit> = {
  P1: "pool", P2: "guest", P3: "guest", P4: "wire", P5: "guest", P6: "wire", P7: "guest", P8: "supplier",
};

export interface ViewState {
  bricks: ReadonlySet<Brick>;
  pool: number;
  /** Нет среза — схема до запуска. */
  snap?: Snapshot;
  phase?: "D1" | "D2";
  failed?: Rule;
  /** Можно ставить кирпичи (не идёт прогон). */
  editable: boolean;
  /** Последний тронутый переключатель — его пояснение под сеткой. */
  focus?: Brick;
}

/** Переключатели внутри «Сервиса отеля» — все шесть кирпичей живут в его коде вызова поставщика. Порядок — по ходу вызова. */
export const SWITCHES: { brick: Brick; name: string; hint: string }[] = [
  { brick: "O", name: "Вне транзакции", hint: "пока ждём ответа, соединение свободно" },
  { brick: "T", name: "Таймаут 3 с", hint: "не ждать поставщика дольше 3 с" },
  { brick: "B", name: "Circuit breaker", hint: "много ошибок — перестать звать на 10 с" },
  { brick: "R", name: "Ретрай", hint: "при неудаче повторить, до 3 попыток" },
  { brick: "J", name: "Backoff + jitter", hint: "паузы между повторами растут, вразброс" },
  { brick: "K", name: "Идемпотентность", hint: "наш номер брони: найдём, дубля не будет" },
];
const GAP = 27; // стрелка между блоками
const G_H = 136; // карточка гостей
const SVC_Y = 12 + G_H + GAP;
const SW_Y = SVC_Y + 104; // сетка переключателей 2×3
const SW_H = 42;
const SW_W = (VIEW.w - 64 - 8) / 2;
const SVC_H = SW_Y + 3 * SW_H + 30 - SVC_Y;
const SUP_Y = SVC_Y + SVC_H + GAP;
const SUP_H = 142;
/** Шкалы столбиков: гость ждёт до страницы ошибки (10 с), поставщик тормозит до 30 с. */
const GUEST_MAX = 100;
const SUP_MAX = 300;

const F = { "font-family": FONT.sans };
const T = (size: number, fill: string = COLOR.ink, weight = 400) => ({ ...F, "font-size": size, fill, "font-weight": weight });
const MID = 120; // ось стрелок
/** Кто держит соединение пула. */
const BOOKING = COLOR.mug;
const SEARCH = COLOR.mail;

/** Столбики ожидания: высота — доля шкалы, черта сверху — предел; полый — запрос, которого никто не ждёт. */
function bars(pen: Pen, key: string, y: number, items: { h: number; fill: string; hollow?: boolean }[], limit: string) {
  const H = 36;
  pen.line(`${key}:limit`, { x1: 32, y1: y, x2: 32 + SHOWN * 14 - 4, y2: y, stroke: COLOR.faint, "stroke-width": 1, "stroke-dasharray": "4 3" });
  pen.text(`${key}:label`, { x: 32 + SHOWN * 14 - 4, y: y - 5, "text-anchor": "end", ...T(13, COLOR.muted) }, limit);
  items.forEach((b, i) => {
    const h = Math.max(2, b.h * H);
    pen.rect(`${key}:${i}`, {
      x: 32 + i * 14, y: y + H - h, width: 10, height: h, rx: 2,
      fill: b.hollow ? "transparent" : b.fill, stroke: b.fill, "stroke-width": b.hollow ? 1.5 : 0,
    });
  });
}

function node(pen: Pen, key: string, y: number, h: number, title: string, red: boolean) {
  pen.rect(`${key}:bg`, {
    x: 16, y, width: VIEW.w - 32, height: h, rx: 12,
    fill: red ? COLOR.alarmBg : COLOR.surface, stroke: red ? COLOR.error : COLOR.line, "stroke-width": red ? 3 : 1.5,
  });
  pen.text(`${key}:title`, { x: 32, y: y + 26, ...T(18, COLOR.ink, 600) }, title);
}

export function render(pen: Pen, s: ViewState): void {
  const red = (c: Culprit) => !!s.failed && CULPRIT[s.failed] === c;
  const a = s.snap?.answers;

  // Гости
  node(pen, "guest", 12, G_H, "Гости", red("guest"));
  if (s.snap && a) {
    pen.text("guest:wait", { x: VIEW.w - 32, y: 36, "text-anchor": "end", ...T(16, COLOR.muted) }, `ждут ответа: ${s.snap.guestsWaiting}`);
    pen.text("guest:ans1", { x: 32, y: 58, ...T(16) }, [
      { text: `бронь ${a.confirmed}`, attrs: { fill: COLOR.ok } },
      { text: ` · проверяем ${a.checking}`, attrs: { fill: COLOR.warn } },
    ]);
    pen.text("guest:ans2", { x: 32, y: 82, ...T(16) }, [
      { text: `отказ ${a.refused}` },
      { text: ` · ошибка ${a.error}`, attrs: { fill: a.error ? COLOR.error : COLOR.ink } },
      ...(s.snap.dupes ? [{ text: ` · 2 брони: ${s.snap.dupes}`, attrs: { fill: COLOR.error, "font-weight": 600 } }] : []),
    ]);
    bars(pen, "guest:bars", 104, s.snap.waits.map((age) => ({
      h: Math.min(age / GUEST_MAX, 1),
      fill: age >= GUEST_MAX ? COLOR.error : age >= GUEST_MAX / 2 ? COLOR.warn : BOOKING,
    })), "10 с — страница ошибки");
  } else {
    // до запуска — легенда: образец столбиков на их месте и в их цветах
    pen.text("guest:hint", { x: 32, y: 58, ...T(16, COLOR.muted) }, "жмут «Забронировать» и ждут ответа");
    pen.text("guest:legend", { x: 32, y: 80, ...T(14, COLOR.muted) }, "столбик — гость, высота — сколько он ждёт");
    bars(pen, "guest:bars", 104, [0.15, 0.3, 0.45, 0.6, 0.8, 1].map((h) => ({
      h, fill: h >= 1 ? COLOR.error : h >= 0.5 ? COLOR.warn : BOOKING,
    })), "10 с — страница ошибки");
  }

  // Стрелка гость → сервис
  pen.line("w1", { x1: MID, y1: 12 + G_H, x2: MID, y2: SVC_Y - 4, stroke: COLOR.faint, "stroke-width": 3, marker: "arrow" });

  // Сервис отеля: пул соединений, общий с поиском
  node(pen, "svc", SVC_Y, SVC_H, "Сервис отеля", false);
  const used = s.snap?.poolUsed ?? 0;
  const forBooking = s.snap?.poolBookings ?? 0;
  pen.text("svc:pool", { x: 32, y: SVC_Y + 50, ...T(16, red("pool") ? COLOR.error : COLOR.muted, red("pool") ? 600 : 400) },
    `пул соединений ${used}/${s.pool}`);
  // занятые: сначала брони, потом поиск — цвет = кто держит соединение
  for (let i = 0; i < s.pool; i++) {
    const fill = i < forBooking ? BOOKING : i < used ? SEARCH : COLOR.bg2;
    pen.rect(`svc:cell${i}`, {
      x: 32 + i * 33, y: SVC_Y + 60, width: 27, height: 30, rx: 6, fill,
      stroke: red("pool") && i < used ? COLOR.error : COLOR.line, "stroke-width": red("pool") && i < used ? 3 : 1.5,
    });
  }
  pen.text("svc:legend", { x: VIEW.w - 32, y: SVC_Y + 82, "text-anchor": "end", ...T(14, COLOR.muted) }, [
    { text: "■", attrs: { fill: BOOKING } }, { text: " бронь  " }, { text: "■", attrs: { fill: SEARCH } }, { text: " поиск" },
  ]);
  if (s.snap) {
    const sw = s.snap.searchWaiting;
    pen.text("svc:search", { x: VIEW.w - 32, y: SVC_Y + 50, "text-anchor": "end", ...T(16, sw ? COLOR.warn : COLOR.muted) },
      sw ? `поиск ждёт: ${sw}` : "поиск работает");
    if (s.snap.bookingsWaiting) pen.text("svc:q", { x: VIEW.w - 32, y: SVC_Y + 26, "text-anchor": "end", ...T(16, COLOR.muted) },
      `брони ждут соединения: ${s.snap.bookingsWaiting}`);
  }

  // Переключатели: касание по всей строке
  pen.line("svc:sep", { x1: 32, y1: SW_Y - 10, x2: VIEW.w - 32, y2: SW_Y - 10, stroke: COLOR.line, "stroke-width": 1 });
  SWITCHES.forEach((sw, i) => {
    const on = s.bricks.has(sw.brick);
    const k = `sw:${sw.brick}`;
    pen.group(k, 32 + (i % 2) * (SW_W + 8), SW_Y + Math.floor(i / 2) * SW_H, () => {
      pen.rect(`${k}:hit`, {
        width: SW_W, height: SW_H - 6, rx: 8, "data-slot": sw.brick, cursor: s.editable ? "pointer" : "default",
        fill: on ? COLOR.surface2 : "transparent", stroke: on ? COLOR.ok : COLOR.faint, "stroke-width": 1.5,
      });
      pen.rect(`${k}:dot`, { x: 10, y: 11, width: 14, height: 14, rx: 4, "pointer-events": "none",
        fill: on ? COLOR.ok : "transparent", stroke: on ? COLOR.ok : COLOR.faint, "stroke-width": 1.5 });
      pen.text(`${k}:name`, { x: 32, y: 24, "pointer-events": "none", ...T(14, on ? COLOR.ink : COLOR.muted, 600) }, sw.name);
    });
  });
  // строка под сеткой: в прогоне — состояние выключателя, до него — что делает тронутый переключатель
  const br = s.snap && s.bricks.has("B") && s.snap.breaker !== "closed" ? s.snap.breaker : undefined;
  const focus = SWITCHES.find((w) => w.brick === s.focus);
  const line = br ? [{ text: br === "open" ? "Circuit breaker открыт: вызовы не идут" : "Circuit breaker: пробный вызов", attrs: { fill: COLOR.warn } }]
    : s.snap ? [] : focus ? [{ text: focus.hint, attrs: { fill: s.bricks.has(focus.brick) ? COLOR.ok : COLOR.muted } }]
    : [{ text: "Касание включает и выключает защиту" }];
  if (line.length) pen.text("svc:hint", { x: 32, y: SW_Y + 3 * SW_H + 14, ...T(14, COLOR.muted) }, line);

  // Стрелка сервис → поставщик
  const wireColor = red("wire") ? COLOR.error : COLOR.faint;
  pen.line("w2", { x1: MID, y1: SVC_Y + SVC_H, x2: MID, y2: SUP_Y - 4, stroke: wireColor, "stroke-width": red("wire") ? 5 : 3, marker: "arrow" });
  if (s.snap?.retries) pen.text("w2:retries", { x: MID + 14, y: SVC_Y + SVC_H + 24, ...T(16, red("wire") ? COLOR.error : COLOR.warn, 600) },
    `повторы за 0,3 с: ${s.snap.retries}`);

  // Поставщик
  node(pen, "sup", SUP_Y, SUP_H, "Поставщик", red("supplier"));
  if (s.snap) {
    const st = s.snap.supplierDown ? "молчит" : s.phase === "D1" ? "часть ответов 30 с" : "работает";
    pen.text("sup:st", { x: VIEW.w - 32, y: SUP_Y + 26, "text-anchor": "end", ...T(16, s.snap.supplierDown ? COLOR.error : s.phase === "D1" ? COLOR.warn : COLOR.ok, 600) }, st);
    const orphans = s.snap.calls.filter((c) => c.orphan).length;
    pen.text("sup:n", { x: 32, y: SUP_Y + 50, ...T(16, COLOR.muted) }, [
      { text: `в работе: ${s.snap.atSupplier}` },
      ...(orphans ? [{ text: ` · никто не ждёт: ${orphans}`, attrs: { fill: COLOR.warn } }] : []),
    ]);
    // брошенный запрос поставщик всё равно доделал — бронь у него есть, хотя сервис о ней не знает
    // П8: этих броней без нашего ключа не найти — красным
    const lost = s.failed === "P8";
    if (s.snap.orphanBookings) pen.text("sup:landed", { x: 32, y: SUP_Y + 72, ...T(16, lost ? COLOR.error : COLOR.warn, lost ? 600 : 400) },
      lost ? `брони без нашего ключа: ${s.snap.orphanBookings}` : `бросили ждать, а бронь есть: ${s.snap.orphanBookings}`);
    bars(pen, "sup:bars", SUP_Y + 100, s.snap.calls.map((c) => ({
      h: Math.min(c.age / SUP_MAX, 1), fill: c.dupe || (c.landed && lost) ? COLOR.error : c.landed ? COLOR.warn : BOOKING, hollow: c.orphan && !c.landed,
    })), s.snap.supplierDown ? "молчит — ответа нет" : "30 с — ответ поставщика");
  } else {
    pen.text("sup:legend", { x: 32, y: SUP_Y + 50, ...T(14, COLOR.muted) }, "столбик — запрос, высота — сколько он идёт");
    pen.text("sup:legend2", { x: 32, y: SUP_Y + 72, ...T(14, COLOR.muted) }, [
      { text: "■", attrs: { fill: BOOKING } }, { text: " сервис ждёт ответа · " },
      { text: "□", attrs: { fill: BOOKING } }, { text: " брошен, никто не ждёт" },
    ]);
    bars(pen, "sup:bars", SUP_Y + 100, [0.2, 0.4, 0.6, 0.8].map((h, i) => ({ h, fill: BOOKING, hollow: i % 2 === 1 })),
      "30 с — ответ поставщика");
  }
}
