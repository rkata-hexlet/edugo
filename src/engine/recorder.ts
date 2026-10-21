import type { Scene } from "./contract";
import { SvgPen } from "./pen";
import { type Line, type Takes, firstLine, script, takeKey } from "./takes";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./player.css";
import "./recorder.css";

/**
 * Суфлёр живого диктора (`?record`, только `npm run dev`): кадр, его текст крупно, одна клавиша.
 * Пробел — сохранить дубль и сразу писать следующий кадр без дубля; если у следующего дубль уже есть
 * (переписываем отдельный кадр) — пауза на сохранённом. Backspace — читать кадр заново, Esc — пауза.
 * Кадр выбирается стрелками или номером в адресе (`#step=N`).
 * Дубль уходит на dev-сервер (`POST /__voice/<сцена>/<ключ>`), тот чистит звук и обновляет справочник.
 */
export function mountRecorder<S>(host: HTMLElement, scene: Scene<S>, takes: Takes): void {
  const steps = scene.steps();
  const lines = script(steps, scene.meta.outro);
  const fromHash = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
  let at = firstLine(lines, takes, Number.isInteger(fromHash) && fromHash >= 1 ? fromHash - 1 : undefined);

  host.innerHTML = `
    <div class="recorder">
      <div class="frame"><svg class="stage" viewBox="0 0 1280 720"></svg><div class="outro-card"></div></div>
      <p class="text"></p>
      <div class="status"><span class="state"></span><span class="meter"><i></i></span><span class="where"></span></div>
      <p class="hint">Пробел — начать / дальше · Backspace — заново · Esc — пауза · ←/→ — кадр · P — прослушать дубль</p>
      <p class="errors"></p>
    </div>`;
  const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  const pen = new SvgPen($<SVGSVGElement>(".stage"));
  const errors = new Map<string, string>(); // кадр → почему дубль не сохранён

  let stream: MediaStream | null = null;
  let take: { recorder: MediaRecorder; chunks: Blob[]; line: Line } | null = null;
  let level = 0;
  let levelOf: MediaStream | null = null; // поток, который слушает индикатор громкости
  let levelCtx: AudioContext | null = null;
  let starting = false; // первый запрос микрофона долгий: второй пробел не должен открыть второй рекордер
  let playing: HTMLAudioElement | null = null;

  const show = () => {
    const line = lines[at];
    const outro = line.index === steps.length;
    pen.frame(() => scene.render(pen, steps[Math.min(line.index, steps.length - 1)].state), { instant: true });
    $(".outro-card").textContent = outro ? scene.meta.outro : "";
    $(".frame").classList.toggle("outro", outro);
    $(".text").textContent = line.text;
    const has = takes.duration(line.text) !== undefined;
    const done = lines.filter((l) => takes.duration(l.text) !== undefined).length;
    $(".where").textContent =
      `${outro ? "финал" : `кадр ${line.index + 1}`} · ${has ? "дубль есть" : "дубля нет"} · записано ${done} из ${lines.length}`;
    history.replaceState(null, "", `${location.search}#step=${line.index + 1}`);
  };
  const state = (text: string, live = false) => {
    $(".state").textContent = text;
    $(".recorder").classList.toggle("live", live);
  };

  const start = async () => {
    if (starting) return;
    starting = true;
    // Микрофон выдернули или отозвали доступ — поток мёртв, просим заново.
    if (stream?.getAudioTracks().every((t) => t.readyState === "ended")) stream = null;
    try {
      stream ??= await navigator.mediaDevices.getUserMedia({
        // Без автоусиления: оно «качает» громкость между фразами. Шумодав браузера оставляем.
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: true, channelCount: 1 },
      });
    } finally {
      starting = false;
    }
    watchLevel(stream);
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    take = { recorder, chunks, line: lines[at] };
    state("● запись", true);
  };
  /** Начать дубль; не вышло — сказать, а не показывать «● запись» над пустотой. */
  const begin = () =>
    void start().catch((err) => state(`Запись не началась: ${err instanceof Error ? err.message : err} — пробел, чтобы попробовать снова`));
  const discard = () => {
    if (!take) return;
    take.recorder.ondataavailable = null;
    take.recorder.stop();
    take = null;
  };
  /** Закончить дубль и отправить; запись следующего начинается сразу, не дожидаясь сервера. */
  const finish = () => {
    if (!take) return;
    const { recorder, chunks, line } = take;
    take = null;
    recorder.onstop = () => void save(line, new Blob(chunks, { type: "audio/webm" }));
    recorder.stop();
  };
  const save = async (line: Line, blob: Blob) => {
    const name = line.index === steps.length ? "финал" : `кадр ${line.index + 1}`;
    try {
      const res = await fetch(`/__voice/${scene.id}/${takeKey(line.text)}`, { method: "POST", body: blob });
      if (!res.ok) throw new Error(await res.text());
      const { ms } = (await res.json()) as { ms: number };
      takes.set(line.text, ms);
      errors.delete(name);
    } catch (e) {
      errors.set(name, `${name}: не сохранён (${e instanceof Error ? e.message : e}) — перезапишите`);
    }
    $(".errors").textContent = [...errors.values()].join("\n");
    show(); // счётчик записанного
  };

  const next = () => {
    finish();
    const following = lines[at + 1];
    if (!following) return state("Готово: всё прочитано, вкладку можно закрыть");
    if (takes.duration(following.text) !== undefined) return state("Сохранено. P — прослушать, пробел — переписать ещё раз, → — дальше");
    at++;
    show();
    begin();
  };
  const move = (d: number) => {
    at = Math.max(0, Math.min(lines.length - 1, at + d));
    show();
  };
  // Номер кадра, набранный в адресе: страница не перезагружается — переходим сами.
  window.addEventListener("hashchange", () => {
    const n = Number(new URLSearchParams(location.hash.slice(1)).get("step"));
    if (!Number.isInteger(n) || n < 1) return;
    discard();
    at = firstLine(lines, takes, n - 1);
    show();
    state("Пробел — записать этот кадр");
  });
  const listen = () => {
    const text = lines[at].text;
    if (takes.duration(text) === undefined) return;
    playing?.pause();
    playing = new Audio(`${takes.url(text)}?v=${Date.now()}`); // свежий дубль, а не из кэша
    void playing.play();
  };

  const watchLevel = (s: MediaStream) => {
    if (levelOf === s) return;
    cancelAnimationFrame(level); // новый поток после переподключения микрофона
    levelOf = s;
    void levelCtx?.close();
    const ctx = (levelCtx = new AudioContext());
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(s).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const bar = $<HTMLElement>(".meter i");
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      bar.style.width = `${Math.min(100, peak * 100)}%`;
      bar.classList.toggle("loud", peak > 0.95);
      level = requestAnimationFrame(tick);
    };
    tick();
  };

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === " ") {
      e.preventDefault();
      playing?.pause();
      if (take) next();
      else begin();
    } else if (key === "backspace" && take) {
      e.preventDefault();
      discard();
      begin();
    } else if (key === "escape" && take) {
      discard();
      state("Пауза — пробел, чтобы продолжить с этого кадра");
    } else if (!take && key === "arrowleft") move(-1);
    else if (!take && key === "arrowright") move(1);
    else if (!take && (key === "p" || key === "з")) listen();
  });

  state("Пробел — начать запись с этого кадра");
  void document.fonts.ready.then(show);
}
