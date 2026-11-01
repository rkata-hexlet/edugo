// Серая схема уровня 1 (MVP, без полировки): Гости → Сервис отеля [пул] → Поставщик, гнёзда на стрелках.
// Рисует только через Pen; гнёзда помечены data-slot — касание ловит контроллер.
import type { Pen } from "../../engine/contract";
import { COLOR, FONT } from "../../kit/theme";
import type { Brick, Rule, Snapshot } from "../model/sim";

export const VIEW = { w: 400, h: 600 } as const;

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

/** Гнёзда: где на схеме, что в пустом, что в занятом. Порядок на стрелке — порядок обёрток (ретрай → выключатель → таймаут). */
export const SLOTS: { brick: Brick; empty: string; full: string; y: number }[] = [
  { brick: "K", empty: "запрос гостя", full: "ключ идемпотентности", y: 118 },
  { brick: "O", empty: "вызов: в транзакции", full: "вызов вне транзакции", y: 276 },
  { brick: "R", empty: "при неудаче", full: "ретрай ×3", y: 352 },
  { brick: "J", empty: "пауза между попытками", full: "backoff + jitter", y: 390 },
  { brick: "B", empty: "перед вызовом", full: "circuit breaker", y: 428 },
  { brick: "T", empty: "вызов поставщика", full: "таймаут 3 с", y: 466 },
];

const F = { "font-family": FONT.sans };
const T = (size: number, fill: string = COLOR.ink, weight = 400) => ({ ...F, "font-size": size, fill, "font-weight": weight });
const MID = 120; // ось стрелок

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
  node(pen, "svc", 164, 150, "Сервис отеля", false);
  const used = s.snap?.poolUsed ?? 0;
  pen.text("svc:pool", { x: 32, y: 214, ...T(16, red("pool") ? COLOR.error : COLOR.muted, red("pool") ? 600 : 400) },
    `пул соединений ${used}/${s.pool}`);
  for (let i = 0; i < s.pool; i++) {
    const busy = i < used;
    pen.rect(`svc:cell${i}`, {
      x: 32 + i * 38, y: 224, width: 30, height: 30, rx: 6,
      fill: busy ? (red("pool") ? COLOR.error : COLOR.postgres) : COLOR.bg2, stroke: COLOR.line, "stroke-width": 1.5,
    });
  }
  if (s.snap) {
    const sw = s.snap.searchWaiting;
    pen.text("svc:search", { x: VIEW.w - 32, y: 214, "text-anchor": "end", ...T(16, sw ? COLOR.warn : COLOR.muted) },
      sw ? `поиск ждёт: ${sw}` : "поиск работает");
    if (s.snap.bookingsWaiting) pen.text("svc:q", { x: 32, y: 298, ...T(16, COLOR.muted) },
      `в очереди: ${s.snap.bookingsWaiting}`);
  }

  // Стрелка сервис → поставщик
  const wireColor = red("wire") ? COLOR.error : COLOR.faint;
  pen.line("w2", { x1: MID, y1: 314, x2: MID, y2: 508, stroke: wireColor, "stroke-width": red("wire") ? 5 : 3, marker: "arrow" });
  if (s.snap?.retries) pen.text("w2:retries", { x: MID - 10, y: 344, "text-anchor": "end", ...T(16, red("wire") ? COLOR.error : COLOR.warn, 600) },
    `повторы: ${s.snap.retries}`);

  // Гнёзда
  for (const slot of SLOTS) {
    const on = s.bricks.has(slot.brick);
    const x = 140;
    const w = VIEW.w - 32 - x;
    let label = on ? slot.full : slot.empty;
    if (slot.brick === "B" && on && s.snap) label += s.snap.breaker === "open" ? " · открыт" : s.snap.breaker === "half" ? " · проба" : "";
    pen.group(`slot:${slot.brick}`, x, slot.y, () => {
      pen.rect(`slot:${slot.brick}:bg`, {
        width: w, height: 32, rx: 8, "data-slot": slot.brick, cursor: s.editable ? "pointer" : "default",
        fill: on ? COLOR.surface2 : "transparent", stroke: on ? COLOR.muted : COLOR.faint,
        "stroke-width": 1.5, "stroke-dasharray": on ? "none" : "5 4",
      });
      pen.text(`slot:${slot.brick}:t`, { x: 12, y: 22, "pointer-events": "none", ...T(16, on ? COLOR.ink : COLOR.faint, on ? 600 : 400) }, label);
    });
  }

  // Поставщик
  node(pen, "sup", 512, 76, "Поставщик", red("supplier"));
  if (s.snap) {
    const st = s.snap.supplierDown ? "лежит" : s.phase === "D1" ? "тормозит" : "работает";
    pen.text("sup:st", { x: VIEW.w - 32, y: 538, "text-anchor": "end", ...T(16, s.snap.supplierDown ? COLOR.error : s.phase === "D1" ? COLOR.warn : COLOR.ok, 600) }, st);
    pen.text("sup:n", { x: 32, y: 572, ...T(16, COLOR.muted) }, `запросов в работе: ${s.snap.atSupplier}`);
  }
}
