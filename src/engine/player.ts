import { STAGE, type Scene } from "./contract";
import { SvgPen } from "./pen";
import "./player.css";

/** Сколько показывать кадр при автопроигрывании: база + время на чтение подписи. */
const frameMs = (caption: string, speed: number) => (1500 + caption.length * 35) / speed;

/**
 * Плеер: кадры сцены, подпись, управление (кнопки, ←/→, пробел), номер кадра в #hash —
 * чтобы при обсуждении можно было сослаться на «кадр 14».
 */
export function mountPlayer<S>(host: HTMLElement, scene: Scene<S>): void {
  const steps = scene.steps();
  const acts = steps
    .map((s, i) => ({ act: s.act, first: i }))
    .filter((a) => a.first === 0 || steps[a.first - 1].act !== a.act);

  host.innerHTML = `
    <div class="player">
      <header><h1></h1><select class="acts"></select></header>
      <svg class="stage" viewBox="0 0 ${STAGE.w} ${STAGE.h}"></svg>
      <p class="caption"></p>
      <nav>
        <button class="prev" title="← назад">◀</button>
        <button class="play" title="пробел">▶</button>
        <button class="next" title="→ вперёд">▶▶</button>
        <select class="speed">
          <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option>
        </select>
        <span class="counter"></span>
      </nav>
    </div>`;
  const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T;
  $<HTMLElement>("h1").textContent = scene.title;
  const actSelect = $<HTMLSelectElement>(".acts");
  actSelect.innerHTML = acts.map((a) => `<option value="${a.first}">${a.act}</option>`).join("");
  const caption = $<HTMLElement>(".caption");
  const counter = $<HTMLElement>(".counter");
  const playBtn = $<HTMLButtonElement>(".play");
  const speedSelect = $<HTMLSelectElement>(".speed");
  const pen = new SvgPen($<SVGSVGElement>(".stage"));

  const fromHash = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
  let index = Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= steps.length ? fromHash - 1 : 0;
  let timer: number | undefined;

  const show = (i: number) => {
    index = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[index];
    pen.frame(() => scene.render(pen, step.state));
    caption.textContent = step.caption;
    counter.textContent = `кадр ${index + 1} / ${steps.length}`;
    actSelect.value = String(acts.filter((a) => a.first <= index).at(-1)!.first);
    history.replaceState(null, "", `#step=${index + 1}`);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    playBtn.textContent = "▶";
  };
  const tick = () => {
    if (index >= steps.length - 1) return stop();
    show(index + 1);
    timer = setTimeout(tick, frameMs(steps[index].caption, Number(speedSelect.value)));
  };
  const toggle = () => {
    if (timer !== undefined) return stop();
    if (index >= steps.length - 1) show(0);
    playBtn.textContent = "❚❚";
    timer = setTimeout(tick, frameMs(steps[index].caption, Number(speedSelect.value)));
  };

  $(".prev").addEventListener("click", () => (stop(), show(index - 1)));
  $(".next").addEventListener("click", () => (stop(), show(index + 1)));
  playBtn.addEventListener("click", toggle);
  actSelect.addEventListener("change", () => (stop(), show(Number(actSelect.value))));
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === "ArrowLeft") (stop(), show(index - 1));
    else if (e.key === "ArrowRight") (stop(), show(index + 1));
    else if (e.key === " ") (e.preventDefault(), toggle());
  });

  show(index);
}
