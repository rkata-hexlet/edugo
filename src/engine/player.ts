import type { Scene } from "./contract";
import { WebAudioSound } from "./audio";
import { Narrator, POST_VOICE_MS, VOICE_DELAY_MS, phraseStarts, phrases } from "./narrator";
import { SvgPen } from "./pen";
import { Shell } from "./shell";
import { COVER_S, frameAt, frameMs, timeline } from "./timeline";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./player.css";

const SPEEDS = [1, 1.5, 2, 0.5];
/** Бормотание персонажей под голосом диктора — тише. Одно значение для плеера и рендера. */
const NARRATION_DUCK = 0.35;

/** Шрифты грузятся по первому использованию; ждём их до первого кадра (`measure`), но не дольше. */
const FONTS_MS = 1500;
const fontsLoaded = () =>
  Promise.race([
    // Все начертания, которые меряет `measure`: размер кэшируется навсегда, запасной шрифт его испортит.
    Promise.all(["16px Inter", "600 16px Inter", "700 16px Inter", "16px 'JetBrains Mono'", "700 16px 'JetBrains Mono'"]
      .map((f) => document.fonts.load(f, "Аa1"))),
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
  const baseTitle = document.title;
  const sound = new WebAudioSound();
  const narrator = new Narrator();
  narrator.pronounce = scene.pronounce ?? {};
  sound.muted = narrator.muted = loadMuted();
  shell.setMuted(sound.muted);

  const fromHash = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
  const linked = Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= steps.length;
  const params = new URLSearchParams(location.search);
  const render = params.has("render");
  let index = render ? -1 : linked ? fromHash - 1 : 0;
  // Обложка — для зрителя с чистой ссылкой (и в записи — как заставка); ссылка на кадр и dev открывают кадр сразу.
  shell.cover(!linked && !params.has("dev"));
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
    const cues = phrases(text);
    voiceDelay = setTimeout(
      () => mine === turn && narrator.speak(text, speed(), onEnd, (i) => shell.subtitle(cues[i])),
      VOICE_DELAY_MS / speed(),
    );
  };

  /** Финальная карточка: главный вывод читает диктор; субтитра нет — фраза уже на карточке. */
  const outro = (onEnd: () => void = () => {}) => {
    shell.outro(true);
    const mine = turn;
    clearTimeout(voiceDelay);
    voiceDelay = setTimeout(
      () => mine === turn && narrator.speak(scene.meta.outro, speed(), onEnd),
      VOICE_DELAY_MS / speed(),
    );
  };

  const show = (i: number) => {
    const prev = index;
    index = Math.max(0, Math.min(last, i));
    const step = steps[index];
    sound.cut();
    narrator.cut();
    clearTimeout(voiceDelay);
    shell.outro(false);
    sound.babbleGain = step.narration ? NARRATION_DUCK : 1;
    document.title = baseTitle;
    if (index === prev + 1) scene.sound?.(sound, step.state);
    // Уход элементов гаснет только при шаге вперёд; перемотка и прыжок показывают кадр сразу.
    pen.frame(() => scene.render(pen, step.state), { instant: index !== prev + 1 });
    shell.frame(index, step.caption, phrases(step.narration ?? "")[0] ?? "");
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
    // Конец — финальная карточка; заголовок вкладки (после вывода голосом) — сигнал записи, что можно останавливать.
    if (index >= last) return (stop(), outro(() => (document.title = `${baseTitle} · конец`)));
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
    if (i > last) return outro();
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

  if (render) return void fontsLoaded().then(() => exposeRender(scene, steps, shell, show));
  void fontsLoaded().then(() => show(index));
}

/** Хуки офлайн-рендера в mp4 (`?capture&render`, scripts/render.mjs): перемотка на момент t и звук в WAV. */
export interface RenderApi {
  ready: true;
  total: number;
  /** Показать момент t, с: обложка, кадр с анимациями, остановленными в нужной точке, или финал. */
  seek(t: number): void;
  /** Отрендерить звук всей записи; возвращает размер WAV в байтах. */
  renderAudio(): Promise<number>;
  /** Кусок WAV в base64. */
  audioChunk(offset: number, length: number): string;
}

function exposeRender<S>(scene: Scene<S>, steps: ReturnType<Scene<S>["steps"]>, shell: Shell, show: (i: number) => void): void {
  const tl = timeline(steps);
  shell.toggleSubs(); // голоса в записи нет — субтитры диктора в кадре
  let current = -1;
  let fresh: Animation[] = [];
  let wav: Uint8Array = new Uint8Array();
  const api: RenderApi = {
    ready: true,
    total: tl.total,
    seek(t) {
      shell.cover(t < COVER_S);
      shell.outro(t >= tl.end);
      if (t < COVER_S || t >= tl.end) return;
      const i = frameAt(tl.starts, t);
      if (i !== current) {
        for (const a of fresh) a.finish(); // эффекты прошлого кадра — в конечное состояние
        show(i);
        getComputedStyle(document.body).opacity; // применить стили: новые анимации и переходы созданы
        fresh = document.getAnimations().filter((a) => a.playState !== "finished");
        for (const a of fresh) a.pause();
        current = i;
      }
      const ms = (t - tl.starts[i]) * 1000;
      for (const a of fresh) a.currentTime = ms;
      // Субтитр — кусок закадра, который звучал бы сейчас (голоса в записи нет — по расчётному темпу).
      const text = steps[i].narration ?? "";
      const cue = phraseStarts(text).filter((at) => at <= ms - VOICE_DELAY_MS).length - 1;
      shell.subtitle(phrases(text)[Math.max(0, cue)] ?? "");
    },
    async renderAudio() {
      const rate = 44100;
      const ctx = new OfflineAudioContext(1, Math.ceil(tl.total * rate), rate);
      const sound = WebAudioSound.offline(ctx);
      steps.forEach((step, i) => {
        // Как в плеере: звук кадра обрывается сменой кадра (там — sound.cut() в show()).
        sound.segment(tl.starts[i], tl.starts[i + 1] ?? tl.end);
        sound.babbleGain = step.narration ? NARRATION_DUCK : 1;
        scene.sound?.(sound, step.state);
      });
      wav = encodeWav(await ctx.startRendering());
      return wav.length;
    },
    audioChunk(offset, length) {
      let bin = "";
      for (const b of wav.subarray(offset, offset + length)) bin += String.fromCharCode(b);
      return btoa(bin);
    },
  };
  (window as unknown as { __edugo: RenderApi }).__edugo = api;
}

/** PCM 16 бит, моно. */
function encodeWav(buf: AudioBuffer): Uint8Array {
  const data = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + data.length * 2, true);
  str(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, data.length * 2, true);
  data.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(out.buffer);
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
