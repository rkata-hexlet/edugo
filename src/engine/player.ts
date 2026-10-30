import type { Scene } from "./contract";
import { WebAudioSound } from "./audio";
import { Narrator, POST_VOICE_MS, VOICE_DELAY_MS, estimateMs, phrases } from "./narrator";
import { SvgPen } from "./pen";
import { Shell } from "./shell";
import type { Takes } from "./takes";
import { COVER_S, frameAt, frameMs, lastPhrase, phraseAt, timeline } from "./timeline";
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
export function mountPlayer<S>(host: HTMLElement, scene: Scene<S>, takes: Takes): void {
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
  narrator.takes = takes;
  sound.muted = narrator.muted = loadMuted();
  shell.setMuted(sound.muted);

  const fromHash = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
  const linked = Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= steps.length;
  const params = new URLSearchParams(location.search);
  const render = params.has("render");
  let index = render ? -1 : linked ? fromHash - 1 : 0;
  let shown = 0; // кусок закадра, по которому нарисован кадр
  // Снимок куска закадра (`npm run shots -- --phrases`): `?capture&phrase=K`, K с нуля.
  const pinned = params.has("phrase") ? Number(params.get("phrase")) : undefined;
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
      () => mine === turn && narrator.speak(text, speed(), onEnd, (i) => (shell.subtitle(cues[i]), i !== shown && draw(i))),
      VOICE_DELAY_MS / speed(),
    );
  };

  /** Финальная карточка: главный вывод читает диктор; субтитра нет — фраза уже на карточке. */
  const outro = () => {
    shell.outro(true);
    const mine = turn;
    clearTimeout(voiceDelay);
    voiceDelay = setTimeout(
      () => mine === turn && narrator.speak(scene.meta.outro, speed(), () => {}),
      VOICE_DELAY_MS / speed(),
    );
  };

  /** Перерисовать текущий кадр по куску закадра: тот же ключ — тот же узел, новое появляется, лишнее гаснет. */
  const draw = (phrase: number, instant = false) => {
    shown = phrase;
    pen.frame(() => scene.render(pen, steps[index].state, phrase), { instant });
  };
  /** Показать кадр i: шаг вперёд — с начала (голос поведёт по кускам), иначе — полная картинка. */
  const show = (i: number, phrase?: number) => {
    const prev = index;
    index = Math.max(0, Math.min(last, i));
    const step = steps[index];
    sound.cut();
    narrator.cut();
    clearTimeout(voiceDelay);
    shell.outro(false);
    sound.babbleGain = step.narration ? NARRATION_DUCK : 1;
    if (index === prev + 1) scene.sound?.(sound, step.state);
    // Уход элементов гаснет только при шаге вперёд; перемотка и прыжок показывают кадр сразу.
    draw(phrase ?? pinned ?? (index === prev + 1 ? 0 : lastPhrase(step)), index !== prev + 1);
    shell.frame(index, step.caption, phrases(step.narration ?? "")[0] ?? "");
    history.replaceState(null, "", `${location.search}#step=${index + 1}`);
    host.dataset.phrases = String(lastPhrase(step) + 1); // для снимков по кускам (scripts/shots.mjs)
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
    // Конец — финальная карточка, вывод читает диктор.
    if (index >= last) return (stop(), outro());
    show(index + 1);
    holdThenNext();
  };
  const toggle = () => {
    sound.unlock();
    if (timer !== undefined) return stop();
    shell.cover(false);
    if (shell.outroShown || index >= last) show(0);
    else if (shown !== 0) draw(0, true); // голос начнёт кадр сначала
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
    // Выключили звук — глушим и голос, в том числе при ручном листании (дубль доиграл бы до конца).
    if (sound.muted || timer !== undefined) narrator.cut();
    // Оборванная фраза не сообщит о конце — перезапускаем ожидание кадра, иначе автопроигрывание встанет.
    if (timer !== undefined) holdThenNext();
    saveMuted(sound.muted);
    shell.setMuted(sound.muted);
  };

  // Номер кадра, набранный в адресе: страница не перезагружается — переходим сами.
  window.addEventListener("hashchange", () => {
    const n = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
    if (Number.isInteger(n) && n >= 1 && n <= steps.length && n !== index + 1) (stop(), shell.cover(false), show(n - 1));
  });
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

  if (render) return void fontsLoaded().then(() => exposeRender(scene, steps, takes, shell, show, draw));
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

function exposeRender<S>(
  scene: Scene<S>,
  steps: ReturnType<Scene<S>["steps"]>,
  takes: Takes,
  shell: Shell,
  show: (i: number, phrase: number) => void,
  draw: (phrase: number) => void,
): void {
  const voiceMs = (text: string) => takes.duration(text) ?? estimateMs(text);
  const tl = timeline(steps, voiceMs, scene.meta.outro);
  let current = -1;
  let phrase = 0;
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
      const at = phraseAt(steps[i], (t - tl.starts[i]) * 1000, voiceMs); // в ролике субтитров нет (решение пользователя 21.10)
      if (i !== current || at.phrase !== phrase) {
        // Эффекты прошлого кадра или куска — в конечное состояние; у цикла («ждёт») конца нет — его просто снимаем.
        for (const a of fresh) {
          if (a.effect?.getComputedTiming().endTime === Infinity) a.cancel();
          else a.finish();
        }
        if (i !== current) show(i, at.phrase);
        else draw(at.phrase);
        getComputedStyle(document.body).opacity; // применить стили: новые анимации и переходы созданы
        fresh = document.getAnimations().filter((a) => a.playState !== "finished");
        for (const a of fresh) a.pause();
        current = i;
        phrase = at.phrase;
      }
      for (const a of fresh) a.currentTime = at.since;
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
      // Голос диктора — дубли поверх звуков, с той же паузой после смены кадра, что в плеере.
      const lines = steps.map((s, i) => ({ text: s.narration, at: tl.starts[i] }));
      lines.push({ text: scene.meta.outro, at: tl.end });
      await Promise.all(lines.map(async ({ text, at }) => {
        if (!text || takes.duration(text) === undefined) return;
        const res = await fetch(takes.url(text));
        if (!res.ok) throw new Error(`нет файла дубля: ${takes.url(text)}`);
        const src = ctx.createBufferSource();
        src.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        src.connect(ctx.destination);
        src.start(at + VOICE_DELAY_MS / 1000);
      }));
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
