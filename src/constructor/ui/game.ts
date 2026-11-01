// Контроллер уровня (MVP): кирпич касанием в гнездо, «Запуск» проигрывает срезы модели, стоп-кадр провала, табло победы.
// Время прогона — кадры браузера, модель уже просчитана целиком (`play`); здесь только показ.
import type { Pen } from "../../engine/contract";
import { BRICKS, play, type Brick, type Level, type Snapshot } from "../model/sim";
import { render, VIEW, type ViewState } from "./view";

type Frame = { phase: "D1" | "D2"; snap: Snapshot };
type Outcome = ReturnType<typeof play>;

const NAME: Record<Brick, string> = {
  T: "Таймаут 3 с", O: "Вызов вне транзакции", R: "Ретрай ×3", K: "Ключ идемпотентности", J: "Backoff + jitter", B: "Circuit breaker",
};
const PHASE: Record<"D1" | "D2", string> = { D1: "Беда A: поставщик тормозит", D2: "Беда B: поставщик лёг на минуту" };
/** Скорость показа: тиков модели в секунду (тик = 100 мс → ×12). */
const TICKS_PER_S = 120;
/** Пауза на заголовке беды перед её прогоном. */
const INTRO_MS = 1200;

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
  let view: Omit<ViewState, "bricks" | "pool" | "editable"> = {};

  root.className = "cx";
  const head = el("header", "cx-head");
  head.append(el("h1", "cx-title", level.title), el("p", "cx-goal",
    "У каждого гостя — одна бронь или честный отказ за 10 с, поиск по сайту работает. Поставщик то тормозит, то падает."));
  const status = el("div", "cx-status", "Собери схему и жми «Запуск»");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW.w} ${VIEW.h}`);
  svg.classList.add("cx-scheme");
  const card = el("section", "cx-card");
  card.hidden = true;
  const palette = el("div", "cx-palette");
  const buttons = new Map<Brick, HTMLButtonElement>();
  for (const b of BRICKS) {
    const btn = el("button", "cx-brick", NAME[b]);
    btn.onclick = () => toggle(b);
    buttons.set(b, btn);
    palette.append(btn);
  }
  const start = el("button", "cx-run", "Запуск");
  start.onclick = () => launch(query.has("end"));
  root.append(head, status, svg, card, palette, start);

  const pen = makePen(svg);
  const draw = () => {
    pen.frame(() => render(pen, { ...view, bricks, pool: level.params.pool, editable: !running }), { instant: true });
    for (const [b, btn] of buttons) {
      btn.classList.toggle("on", bricks.has(b));
      btn.disabled = running;
    }
    start.disabled = running;
  };

  function toggle(b: Brick) {
    if (running) return;
    bricks.has(b) ? bricks.delete(b) : bricks.add(b);
    view = {};
    card.hidden = true;
    status.textContent = "Собери схему и жми «Запуск»";
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
    const step = (now: number) => {
      if (frames[i].phase !== phase) {
        phase = frames[i].phase;
        first = i;
        t0 = now + INTRO_MS;
        view = { phase };
        status.textContent = PHASE[phase];
      }
      if (now >= t0) {
        const end = lastOf(first);
        i = Math.min(end, first + Math.floor(((now - t0) * TICKS_PER_S) / 1000));
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
      status.textContent = `${PHASE[f.phase]} · ${clock(f.tick)} · провал`;
      card.className = "cx-card fail";
      card.append(el("p", "cx-fail", f.text), el("span", "cx-ref", `Это кейс из ролика 10 · кадр ${f.frame}`),
        el("p", "cx-note", "Поменяй схему и запусти снова — прогон начнётся с беды A."));
    } else if (out.score) {
      const s = out.score;
      view = { phase: last.phase, snap: last.snap };
      status.textContent = "Обе беды пройдены";
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
      card.append(el("p", "cx-win", "Победа"), board,
        el("p", "cx-note", "Больше броней, меньше запросов и кирпичей — лучше. Попробуй другое решение."));
    }
    card.hidden = false;
    draw();
  }

  draw();
  if (query.has("end")) launch(true);
}
