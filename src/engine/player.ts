import { STAGE, type Scene, type Step } from "./contract";
import { WebAudioSound } from "./audio";
import { Narrator, POST_VOICE_MS, VOICE_DELAY_MS } from "./narrator";
import { SvgPen } from "./pen";
import "./player.css";

/** Сколько показывать кадр при автопроигрывании: заданное сценой или база + время на чтение подписи. */
const frameMs = (step: Step<unknown>, speed: number) =>
  (step.hold !== undefined ? step.hold * 1000 : 1500 + step.caption.length * 35) / speed;

/**
 * Плеер: кадры сцены, подпись, звук, диктор, управление (кнопки, ←/→, пробел, M), номер кадра в
 * #hash — чтобы при обсуждении можно было сослаться на «кадр 14». Звучит только шаг вперёд;
 * автопроигрывание листает, когда прошло время кадра и диктор договорил.
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
      <p class="narration" hidden></p>
      <nav>
        <button class="prev" title="← назад">◀</button>
        <button class="play" title="пробел">▶</button>
        <button class="next" title="→ вперёд">▶▶</button>
        <select class="speed">
          <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option>
        </select>
        <button class="mute" title="M — звук"></button>
        <button class="subs" title="C — субтитры диктора">CC</button>
        <span class="counter"></span>
      </nav>
    </div>`;
  const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T;
  $<HTMLElement>("h1").textContent = scene.title;
  const actSelect = $<HTMLSelectElement>(".acts");
  actSelect.innerHTML = acts.map((a) => `<option value="${a.first}">${a.act}</option>`).join("");
  const caption = $<HTMLElement>(".caption");
  const narrationLine = $<HTMLElement>(".narration");
  const counter = $<HTMLElement>(".counter");
  const playBtn = $<HTMLButtonElement>(".play");
  const speedSelect = $<HTMLSelectElement>(".speed");
  const muteBtn = $<HTMLButtonElement>(".mute");
  const pen = new SvgPen($<SVGSVGElement>(".stage"));
  const sound = new WebAudioSound();
  const narrator = new Narrator();
  narrator.pronounce = scene.pronounce ?? {};
  sound.muted = narrator.muted = loadMuted();
  const paintMute = () => (muteBtn.textContent = sound.muted ? "🔇" : "🔊");
  paintMute();

  const fromHash = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
  let index = Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= steps.length ? fromHash - 1 : 0;
  let timer: number | undefined;
  let turn = 0; // поколение автопроигрывания: старые таймеры и концы фраз игнорируются
  let voiceDelay: number | undefined;
  const speed = () => Number(speedSelect.value);
  // Голос — после короткой тишины: взгляд успевает увидеть новое состояние кадра.
  const narrate = (onEnd: () => void = () => {}) => {
    const text = steps[index].narration;
    if (!text) return onEnd();
    const mine = turn;
    clearTimeout(voiceDelay);
    voiceDelay = setTimeout(() => mine === turn && narrator.speak(text, speed(), onEnd), VOICE_DELAY_MS / speed());
  };

  const show = (i: number) => {
    const prev = index;
    index = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[index];
    sound.cut();
    narrator.cut();
    clearTimeout(voiceDelay);
    sound.babbleGain = step.narration ? 0.35 : 1;
    if (index === prev + 1) scene.sound?.(sound, step.state);
    pen.frame(() => scene.render(pen, step.state));
    caption.textContent = step.caption;
    narrationLine.textContent = step.narration ?? "";
    counter.textContent = `кадр ${index + 1} / ${steps.length}`;
    actSelect.value = String(acts.filter((a) => a.first <= index).at(-1)!.first);
    history.replaceState(null, "", `#step=${index + 1}`);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    turn++;
    narrator.cut();
    playBtn.textContent = "▶";
  };
  /** Дальше — когда истекло время кадра и диктор договорил, что бы ни случилось раньше. */
  const holdThenNext = () => {
    const mine = ++turn;
    let timeUp = false;
    let spoken = false;
    const next = () => {
      if (mine === turn && timeUp && spoken) tick();
    };
    timer = setTimeout(() => ((timeUp = true), next()), frameMs(steps[index], speed()));
    const afterVoice = steps[index].narration ? POST_VOICE_MS / speed() : 0;
    narrate(() => setTimeout(() => ((spoken = true), next()), afterVoice));
  };
  const tick = () => {
    if (index >= steps.length - 1) return stop();
    show(index + 1);
    holdThenNext();
  };
  const toggle = () => {
    if (timer !== undefined) return stop();
    if (index >= steps.length - 1) show(0);
    sound.cut();
    scene.sound?.(sound, steps[index].state);
    playBtn.textContent = "❚❚";
    holdThenNext();
  };
  const step = (i: number) => {
    stop();
    const forward = i === index + 1;
    show(i);
    if (forward) narrate();
  };
  const subsBtn = $<HTMLButtonElement>(".subs");
  const toggleSubs = () => {
    narrationLine.hidden = !narrationLine.hidden;
    subsBtn.classList.toggle("on", !narrationLine.hidden);
  };

  const toggleMute = () => {
    sound.muted = narrator.muted = !sound.muted;
    if (sound.muted) sound.cut();
    // Оборванная фраза не сообщит о конце — перезапускаем ожидание кадра, иначе автопроигрывание встанет.
    if (timer !== undefined) (narrator.cut(), holdThenNext());
    saveMuted(sound.muted);
    paintMute();
  };

  host.addEventListener("pointerdown", () => sound.unlock());
  $(".prev").addEventListener("click", () => step(index - 1));
  $(".next").addEventListener("click", () => step(index + 1));
  playBtn.addEventListener("click", toggle);
  muteBtn.addEventListener("click", toggleMute);
  subsBtn.addEventListener("click", toggleSubs);
  actSelect.addEventListener("change", () => (stop(), show(Number(actSelect.value))));
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
    sound.unlock();
    if (e.key === "ArrowLeft") step(index - 1);
    else if (e.key === "ArrowRight") step(index + 1);
    else if (e.key === " ") (e.preventDefault(), toggle());
    else if (e.key === "m" || e.key === "ь") toggleMute();
    else if (e.key === "c" || e.key === "с") toggleSubs();
  });

  show(index);
}

const MUTE_KEY = "edugo:muted";

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // без localStorage просто не запоминаем
  }
}
