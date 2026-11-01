// Контроллер уровня (MVP): кирпич — переключатель в «Сервисе отеля», «Запуск» проигрывает срезы модели, стоп-кадр провала, табло победы.
// Время прогона — кадры браузера, модель уже просчитана целиком (`play`); здесь только показ.
import type { Pen } from "../../engine/contract";
import { BRICKS, play, type Brick, type Level, type Snapshot } from "../model/sim";
import { render, VIEW, type ViewState } from "./view";

type Frame = { phase: "D1" | "D2"; snap: Snapshot };
type Outcome = ReturnType<typeof play>;

const PHASE: Record<"D1" | "D2", string> = { D1: "Беда A: часть ответов идёт 30 с", D2: "Беда B: поставщик молчит минуту" };
/** Скорость показа, тиков модели в секунду (тик = 100 мс): начало беды почти вживую — видно, как копится беда;
 *  последние секунды перед провалом — медленно; спокойная середина проматывается. */
const SPEED = { start: 10, startTicks: 80, nearFail: 8, nearFailTicks: 50, cruise: 120 };
/** Пауза на заголовке беды перед её прогоном. */
const INTRO_MS = 1200;

const HOWTO = "Включай защиты и жми «Запуск»: две беды подряд, стоп на первой поломке";
const clock = (tick: number) => `${(tick / 10).toFixed(1).replace(".", ",")} с`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

export function mountGame(root: HTMLElement, level: Level, makePen: (svg: SVGSVGElement) => Pen & { frame(d: () => void, o?: { instant?: boolean }): void }, query: URLSearchParams) {
  const bricks = new Set<Brick>([...(query.get("bricks") ?? "")].filter((c): c is Brick => BRICKS.includes(c as Brick)));
  let running = false;
  let focus: Brick | undefined;
  let view: Omit<ViewState, "bricks" | "pool" | "editable"> = {};
  /** Прошлый запуск — повод сравнить: докуда дошёл провал, счёт прошлой победы. */
  let lastReach: number | undefined;
  let lastWin: string | undefined;
  const totalTicks = level.phases.reduce((n, p) => n + p.ticks, 0);

  root.className = "cx";
  const head = el("header", "cx-head");
  head.append(el("h1", "cx-title", level.title), el("p", "cx-goal",
    "За 10 с гость получает бронь, отказ или «проверяем» с номером брони. Поиску нужны те же 6 соединений с БД. Поставщик то тянет часть ответов до 30 с, то молчит."));
  const status = el("div", "cx-status", HOWTO);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW.w} ${VIEW.h}`);
  svg.classList.add("cx-scheme");
  const card = el("section", "cx-card");
  card.hidden = true;
  const start = el("button", "cx-run", "Запуск");
  start.onclick = () => launch(query.has("end"));
  root.append(head, card, status, svg, start);

  const pen = makePen(svg);
  const draw = () => {
    pen.frame(() => render(pen, { ...view, bricks, pool: level.params.pool, editable: !running, focus }), { instant: true });
    start.disabled = running;
  };

  function toggle(b: Brick) {
    if (running) return;
    bricks.has(b) ? bricks.delete(b) : bricks.add(b);
    focus = b;
    view = {};
    card.hidden = true;
    status.hidden = false;
    status.textContent = HOWTO;
    draw();
  }
  svg.addEventListener("click", (e) => {
    const slot = (e.target as Element).getAttribute?.("data-slot");
    if (slot) toggle(slot as Brick);
  });

  function launch(skip: boolean) {
    const out = play(level, bricks);
    const frames: Frame[] = out.runs.flatMap(({ phase, result }) => {
      const last = out.failure?.phase === phase.id ? out.failure.tick : result.snapshots.length - 1;
      return result.snapshots.slice(0, last + 1).map((snap) => ({ phase: phase.id, snap }));
    });
    card.hidden = true;
    status.hidden = false;
    head.hidden = true; // цель прочитана — экран отдаём схеме
    if (skip) return finish(out, frames[frames.length - 1]);
    running = true;
    let i = 0;
    let phase: "D1" | "D2" | undefined;
    let first = 0; // первый срез текущей беды
    let t0 = 0; // когда пошли тики текущей беды
    const lastOf = (k: number) => {
      while (k + 1 < frames.length && frames[k + 1].phase === frames[k].phase) k++;
      return k;
    };
    // at[k] — когда показать срез k, мс от начала его беды
    const at: number[] = [];
    frames.forEach((f, k) => {
      if (k === 0 || frames[k - 1].phase !== f.phase) return void (at[k] = 0);
      const dt = f.snap.tick - frames[k - 1].snap.tick;
      const sinceStart = k - lastStart(k);
      const toFail = out.failure?.phase === f.phase ? out.failure.tick - f.snap.tick : Infinity;
      const tps = toFail <= SPEED.nearFailTicks ? SPEED.nearFail : sinceStart <= SPEED.startTicks ? SPEED.start : SPEED.cruise;
      at[k] = at[k - 1] + (dt * 1000) / tps;
    });
    function lastStart(k: number) {
      while (k > 0 && frames[k - 1].phase === frames[k].phase) k--;
      return k;
    }
    const step = (now: number) => {
      if (frames[i].phase !== phase) {
        phase = frames[i].phase;
        first = i;
        t0 = now + INTRO_MS;
        view = { phase, snap: frames[i].snap }; // пауза на заголовке беды — её первый кадр, а не легенда до запуска
        status.textContent = PHASE[phase];
      }
      if (now >= t0) {
        const end = lastOf(first);
        while (i < end && at[i + 1] <= now - t0) i++;
        const cur = frames[i];
        view = { phase, snap: cur.snap };
        status.textContent = `${PHASE[phase]} · ${clock(cur.snap.tick)}`;
        if (i === frames.length - 1) return finish(out, cur);
        if (i === end) i++; // следующая беда — со своим заголовком
      }
      draw();
      requestAnimationFrame(step);
    };
    draw();
    requestAnimationFrame(step);
  }

  function finish(out: Outcome, last: Frame) {
    running = false;
    card.replaceChildren();
    if (out.failure) {
      const f = out.failure;
      view = { phase: last.phase, snap: last.snap, failed: f.rule };
      card.className = "cx-card fail";
      // докуда дошёл прогон из всего — продвижение между запусками видно числом
      const before = level.phases.slice(0, level.phases.findIndex((p) => p.id === f.phase)).reduce((n, p) => n + p.ticks, 0);
      const reach = before + f.tick;
      const sec = (t: number) => `${Math.round(t / 10)} с`;
      const prev = lastReach === undefined ? "" : ` (было ${Math.round(lastReach / 10)})`;
      lastReach = reach;
      // беда — буквой: её описание игрок видел в прогоне, а экран телефона кончается на 844 px
      card.append(el("p", "cx-phase", `Беда ${f.phase === "D1" ? "A" : "B"} · продержались ${sec(reach)} из ${Math.round(totalTicks / 10)}${prev}`),
        el("p", "cx-fail", f.text), el("p", "cx-why", f.why));
    } else if (out.score) {
      const s = out.score;
      // панель гостей — за обе беды, как табло (иначе «отказ 267» беды B рядом со «112 из 456» читается как поражение)
      view = { phase: last.phase, snap: { ...last.snap, answers: { confirmed: s.confirmed, checking: s.checking, refused: s.refused, error: 0 } } };
      card.className = "cx-card win";
      const board = el("div", "cx-board");
      for (const [n, label] of [
        [`${s.confirmed}`, `подтверждено броней из ${s.guests}`],
        [`${s.requests}`, "запросов к поставщику"],
        [`${s.bricks}`, "кирпичей"],
      ]) {
        const cell = el("div", "cx-score");
        cell.append(el("b", "", n), el("span", "", label));
        board.append(cell);
      }
      const now = `${s.confirmed} · ${s.requests} · ${s.bricks}`;
      const prev = lastWin && lastWin !== now ? ` Прошлая победа: ${lastWin}.` : "";
      lastWin = now;
      lastReach = undefined;
      card.append(el("p", "cx-win", "Победа"), board,
        el("p", "cx-note", `Отказы честные: брони нет, и гость узнавал это сразу, а не через 10 с. Больше броней, меньше запросов и кирпичей — лучше.${prev} Решений несколько.`));
    }
    card.hidden = false;
    status.hidden = true; // беда и время — в карточке провала, победа — в своей
    draw();
  }

  draw();
  if (query.has("end")) launch(true);
}
