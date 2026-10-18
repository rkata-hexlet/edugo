import { type Scene, type Step } from "./contract";
import { WebAudioSound } from "./audio";
import { Narrator, POST_VOICE_MS, VOICE_DELAY_MS } from "./narrator";
import { SvgPen } from "./pen";
import { Shell } from "./shell";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./player.css";

/** Сколько показывать кадр при автопроигрывании: заданное сценой или база + время на чтение подписи. */
const frameMs = (step: Step<unknown>, speed: number) =>
  (step.hold !== undefined ? step.hold * 1000 : 1500 + step.caption.length * 35) / speed;

const SPEEDS = [1, 1.5, 2, 0.5];

/** Шрифты грузятся по первому использованию; ждём их до первого кадра (`measure`), но не дольше. */
const FONTS_MS = 1500;
const fontsLoaded = () =>
  Promise.race([
    Promise.all(["16px Inter", "600 16px Inter", "16px 'JetBrains Mono'"].map((f) => document.fonts.load(f, "Аa1"))),
    new Promise((resolve) => setTimeout(resolve, FONTS_MS)),
  ]).catch(() => {});

/**
 * Плеер: кадры сцены, звук, диктор, автопроигрывание; DOM и панель — в `Shell`. Номер кадра в
 * #hash — чтобы при обсуждении можно было сослаться на «кадр 14». Звучит только шаг вперёд;
 * автопроигрывание листает, когда прошло время кадра и диктор договорил.
 */
export function mountPlayer<S>(host: HTMLElement, scene: Scene<S>): void {
  const steps = scene.steps();
  const acts = steps
    .map((s, i) => ({ act: s.act, first: i, count: 0 }))
    .filter((a) => a.first === 0 || steps[a.first - 1].act !== a.act);
  acts.forEach((a, i) => (a.count = (acts[i + 1]?.first ?? steps.length) - a.first));
  const last = steps.length - 1;

  const shell = new Shell(host, scene.meta, acts, steps.length, {
    toggle: () => toggle(),
    seek: (i) => (stop(), shell.cover(false), show(i)),
    speed: () => {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      shell.setSpeed(speed());
      if (timer !== undefined) (narrator.cut(), holdThenNext()); // новая скорость — с текущего кадра
    },
    mute: () => toggleMute(),
    subs: () => shell.toggleSubs(),
    restart: () => (stop(), show(0), toggle()),
  });
  const pen = new SvgPen(shell.stage);
  const sound = new WebAudioSound();
  const narrator = new Narrator();
  narrator.pronounce = scene.pronounce ?? {};
  sound.muted = narrator.muted = loadMuted();
  shell.setMuted(sound.muted);

  const fromHash = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
  const linked = Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= steps.length;
  let index = linked ? fromHash - 1 : 0;
  // Обложка — для зрителя с чистой ссылкой; ссылка на кадр и dev-режим открывают кадр сразу.
  shell.cover(!linked && !new URLSearchParams(location.search).has("dev"));
  let timer: number | undefined;
  let turn = 0; // поколение автопроигрывания: старые таймеры и концы фраз игнорируются
  let voiceDelay: number | undefined;
  let speedIndex = 0;
  const speed = () => SPEEDS[speedIndex];
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
    index = Math.max(0, Math.min(last, i));
    const step = steps[index];
    sound.cut();
    narrator.cut();
    clearTimeout(voiceDelay);
    shell.outro(false);
    sound.babbleGain = step.narration ? 0.35 : 1;
    if (index === prev + 1) scene.sound?.(sound, step.state);
    // Уход элементов гаснет только при шаге вперёд; перемотка и прыжок показывают кадр сразу.
    pen.frame(() => scene.render(pen, step.state), { instant: index !== prev + 1 });
    shell.frame(index, step.caption, step.narration ?? "");
    history.replaceState(null, "", `${location.search}#step=${index + 1}`);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    turn++;
    narrator.cut();
    shell.setPlaying(false);
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
    if (index >= last) return (stop(), shell.outro(true));
    show(index + 1);
    holdThenNext();
  };
  const toggle = () => {
    sound.unlock();
    if (timer !== undefined) return stop();
    shell.cover(false);
    if (shell.outroShown || index >= last) show(0);
    sound.cut();
    scene.sound?.(sound, steps[index].state);
    shell.setPlaying(true);
    holdThenNext();
  };
  const step = (i: number) => {
    stop();
    shell.cover(false);
    if (i > last) return shell.outro(true);
    const forward = i === index + 1;
    show(i);
    if (forward) narrate();
  };

  const toggleMute = () => {
    sound.muted = narrator.muted = !sound.muted;
    if (sound.muted) sound.cut();
    // Оборванная фраза не сообщит о конце — перезапускаем ожидание кадра, иначе автопроигрывание встанет.
    if (timer !== undefined) (narrator.cut(), holdThenNext());
    saveMuted(sound.muted);
    shell.setMuted(sound.muted);
  };

  host.addEventListener("pointerdown", () => sound.unlock());
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
    sound.unlock();
    shell.wake();
    const key = e.key.toLowerCase();
    if (key === "arrowleft") step(index - 1);
    else if (key === "arrowright") step(index + 1);
    else if (key === " ") (e.preventDefault(), toggle());
    else if (key === "m" || key === "ь") toggleMute();
    else if (key === "c" || key === "с") shell.toggleSubs();
    else if (key === "f" || key === "а") shell.fullscreen();
    else if (key === "d" || key === "в") shell.dev();
  });

  void fontsLoaded().then(() => show(index));
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
