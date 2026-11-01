// Серая схема уровня 1 (MVP, без полировки): Гости → Сервис отеля [пул, переключатели кирпичей] → Поставщик.
// Рисует только через Pen; переключатели помечены data-slot — касание ловит контроллер.
import type { Pen } from "../../engine/contract";
import { COLOR, FONT } from "../../kit/theme";
import type { Brick, Rule, Snapshot } from "../model/sim";

export const VIEW = { w: 400, h: 752 } as const;

/** Что красить красным на стоп-кадре: поломку, а не кирпич. */
type Culprit = "guest" | "pool" | "wire" | "supplier";
const CULPRIT: Record<Rule, Culprit> = {
  P1: "pool", P2: "guest", P3: "guest", P4: "wire", P5: "guest", P6: "wire", P7: "guest",
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
}

/** Переключатели внутри «Сервиса отеля» — все шесть кирпичей живут в его коде вызова поставщика. Порядок — по ходу вызова. */
export const SWITCHES: { brick: Brick; name: string; hint: string }[] = [
  { brick: "O", name: "Вызов вне транзакции", hint: "пока ждём ответа, соединение свободно" },
  { brick: "T", name: "Таймаут 3 с", hint: "не ждать поставщика дольше 3 с" },
  { brick: "B", name: "Circuit breaker", hint: "много ошибок — перестать звать на 10 с" },
  { brick: "R", name: "Ретрай ×3", hint: "при неудаче повторить, до 3 попыток" },
  { brick: "J", name: "Backoff + jitter", hint: "паузы между повторами растут, вразброс" },
  { brick: "K", name: "Ключ идемпотентности", hint: "повтор несёт тот же номер брони" },
];
const SW_Y = 300; // первый переключатель
const SW_H = 50;
const SVC_Y = 164;
const SVC_H = SW_Y + SWITCHES.length * SW_H + 4 - SVC_Y;
const SUP_Y = SVC_Y + SVC_H + 56;

const F = { "font-family": FONT.sans };
const T = (size: number, fill: string = COLOR.ink, weight = 400) => ({ ...F, "font-size": size, fill, "font-weight": weight });
const MID = 120; // ось стрелок
/** Кто держит соединение пула. */
const BOOKING = COLOR.mug;
const SEARCH = COLOR.mail;

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
  node(pen, "guest", 12, 92, "Гости", red("guest"));
  if (s.snap && a) {
    pen.text("guest:wait", { x: VIEW.w - 32, y: 38, "text-anchor": "end", ...T(16, COLOR.muted) }, `ждут ответа: ${s.snap.guestsWaiting}`);
    pen.text("guest:ans1", { x: 32, y: 62, ...T(16) }, [
      { text: `бронь ${a.confirmed}`, attrs: { fill: COLOR.ok } },
      { text: ` · проверяем ${a.checking}`, attrs: { fill: COLOR.warn } },
    ]);
    pen.text("guest:ans2", { x: 32, y: 88, ...T(16) }, [
      { text: `отказ ${a.refused}` },
      { text: ` · ошибка ${a.error}`, attrs: { fill: a.error ? COLOR.error : COLOR.ink } },
    ]);
    if (s.snap.dupes) pen.text("guest:dupes", { x: VIEW.w - 32, y: 88, "text-anchor": "end", ...T(18, COLOR.error, 600) },
      `2 брони: ${s.snap.dupes}`);
  } else pen.text("guest:hint", { x: 32, y: 60, ...T(16, COLOR.muted) }, "жмут «Забронировать»");

  // Стрелка гость → сервис
  pen.line("w1", { x1: MID, y1: 104, x2: MID, y2: 160, stroke: COLOR.faint, "stroke-width": 3, marker: "arrow" });

  // Сервис отеля: пул соединений, общий с поиском
  node(pen, "svc", SVC_Y, SVC_H, "Сервис отеля", false);
  const used = s.snap?.poolUsed ?? 0;
  const forBooking = s.snap?.poolBookings ?? 0;
  pen.text("svc:pool", { x: 32, y: 214, ...T(16, red("pool") ? COLOR.error : COLOR.muted, red("pool") ? 600 : 400) },
    `пул соединений ${used}/${s.pool}`);
  // занятые: сначала брони, потом поиск — цвет = кто держит соединение
  for (let i = 0; i < s.pool; i++) {
    const fill = i < forBooking ? BOOKING : i < used ? SEARCH : COLOR.bg2;
    pen.rect(`svc:cell${i}`, {
      x: 32 + i * 33, y: 224, width: 27, height: 30, rx: 6, fill,
      stroke: red("pool") && i < used ? COLOR.error : COLOR.line, "stroke-width": red("pool") && i < used ? 3 : 1.5,
    });
  }
  pen.text("svc:legend", { x: VIEW.w - 32, y: 246, "text-anchor": "end", ...T(14, COLOR.muted) }, [
    { text: "■", attrs: { fill: BOOKING } }, { text: " бронь  " }, { text: "■", attrs: { fill: SEARCH } }, { text: " поиск" },
  ]);
  if (s.snap) {
    const sw = s.snap.searchWaiting;
    pen.text("svc:search", { x: VIEW.w - 32, y: 214, "text-anchor": "end", ...T(16, sw ? COLOR.warn : COLOR.muted) },
      sw ? `поиск ждёт: ${sw}` : "поиск работает");
    if (s.snap.bookingsWaiting) pen.text("svc:q", { x: VIEW.w - 32, y: SVC_Y + 26, "text-anchor": "end", ...T(16, COLOR.muted) },
      `броней в очереди: ${s.snap.bookingsWaiting}`);
  }

  // Переключатели: касание по всей строке
  pen.text("svc:how", { x: 32, y: SW_Y - 12, ...T(15, COLOR.muted) }, "Как сервис вызывает поставщика:");
  pen.line("svc:sep", { x1: 32, y1: SW_Y - 34, x2: VIEW.w - 32, y2: SW_Y - 34, stroke: COLOR.line, "stroke-width": 1 });
  SWITCHES.forEach((sw, i) => {
    const on = s.bricks.has(sw.brick);
    const k = `sw:${sw.brick}`;
    let state = "";
    if (sw.brick === "B" && on && s.snap) state = s.snap.breaker === "open" ? "открыт" : s.snap.breaker === "half" ? "проба" : "";
    pen.group(k, 24, SW_Y + i * SW_H, () => {
      pen.rect(`${k}:hit`, {
        width: VIEW.w - 48, height: SW_H - 4, rx: 8, "data-slot": sw.brick, cursor: s.editable ? "pointer" : "default",
        fill: on ? COLOR.surface2 : "transparent",
      });
      pen.rect(`${k}:track`, { x: 8, y: 11, width: 40, height: 24, rx: 12, "pointer-events": "none",
        fill: on ? COLOR.ok : COLOR.bg2, stroke: on ? COLOR.ok : COLOR.faint, "stroke-width": 1.5 });
      pen.rect(`${k}:knob`, { x: on ? 28 : 12, y: 15, width: 16, height: 16, rx: 8, "pointer-events": "none",
        fill: on ? COLOR.ink : COLOR.faint });
      pen.text(`${k}:name`, { x: 60, y: 20, "pointer-events": "none", ...T(16, on ? COLOR.ink : COLOR.muted, 600) }, sw.name);
      pen.text(`${k}:hint`, { x: 60, y: 39, "pointer-events": "none", ...T(13, COLOR.muted) }, sw.hint);
      if (state) pen.text(`${k}:state`, { x: VIEW.w - 60, y: 20, "text-anchor": "end", "pointer-events": "none",
        ...T(15, COLOR.warn, 600) }, state);
    });
  });

  // Стрелка сервис → поставщик
  const wireColor = red("wire") ? COLOR.error : COLOR.faint;
  pen.line("w2", { x1: MID, y1: SVC_Y + SVC_H, x2: MID, y2: SUP_Y - 4, stroke: wireColor, "stroke-width": red("wire") ? 5 : 3, marker: "arrow" });
  if (s.snap?.retries) pen.text("w2:retries", { x: MID + 14, y: SVC_Y + SVC_H + 34, ...T(16, red("wire") ? COLOR.error : COLOR.warn, 600) },
    `повторы: ${s.snap.retries}`);

  // Поставщик
  node(pen, "sup", SUP_Y, 76, "Поставщик", red("supplier"));
  if (s.snap) {
    const st = s.snap.supplierDown ? "лежит" : s.phase === "D1" ? "тормозит" : "работает";
    pen.text("sup:st", { x: VIEW.w - 32, y: SUP_Y + 26, "text-anchor": "end", ...T(16, s.snap.supplierDown ? COLOR.error : s.phase === "D1" ? COLOR.warn : COLOR.ok, 600) }, st);
    pen.text("sup:n", { x: 32, y: SUP_Y + 60, ...T(16, COLOR.muted) }, `запросов в работе: ${s.snap.atSupplier}`);
  }
}
