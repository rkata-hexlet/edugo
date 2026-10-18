import { STAGE, type SceneMeta } from "./contract";

/** Значки панели: 24×24, цвет — currentColor. Эмодзи и редкие глифы шрифт рисует по-разному. */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="1.4em" height="1.4em" fill="currentColor" aria-hidden="true">${body}</svg>`;
const ICON = {
  play: svg(`<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>`),
  pause: svg(`<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>`),
  sound: svg(
    `<path d="M4 9h3l5-4v14l-5-4H4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  ),
  muted: svg(`<path d="M4 9h3l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  replay: svg(
    `<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  fullscreen: svg(
    `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
};

/** Через сколько без движения мыши панель прячется во время проигрывания. */
const IDLE_MS = 2500;

export interface Act {
  act: string;
  first: number;
  count: number;
}

/** Что оболочка сообщает плееру: действия зрителя. */
export interface ShellEvents {
  toggle(): void;
  seek(index: number): void;
  speed(): void;
  mute(): void;
  subs(): void;
  restart(): void;
}

/**
 * Оболочка плеера: кадр 16:9 по размеру окна, подпись и субтитры оверлеем внутри кадра (попадают
 * в запись), панель с прогрессом по актам (прячется при проигрывании), обложка, финальная карточка,
 * dev-полоса (`?dev` / D) со списком актов и номером кадра. Состояние держит плеер — здесь только DOM.
 */
export class Shell {
  readonly stage: SVGSVGElement;
  private $: <T extends Element>(sel: string) => T;
  private segs: HTMLElement[] = [];
  private idle: number | undefined;
  private playing = false;
  /** Касание по спрятанной панели только показывает её, а не ставит на паузу. */
  private swallowTap = false;

  constructor(
    host: HTMLElement,
    meta: SceneMeta,
    private acts: Act[],
    private total: number,
    on: ShellEvents,
  ) {
    const ep = String(meta.episode).padStart(2, "0");
    host.innerHTML = `
      <div class="player">
        <div class="dev" hidden><select class="acts" aria-label="акт"></select><span class="counter"></span></div>
        <div class="frame">
          <svg class="stage" viewBox="0 0 ${STAGE.w} ${STAGE.h}"></svg>
          <div class="subs"><p class="caption"></p><p class="narration" hidden></p></div>
          <div class="card cover">
            <p class="ep">эпизод ${ep}</p><h1></h1><p class="line"></p>
            <button class="big" aria-label="смотреть">${ICON.play}</button>
          </div>
          <div class="card outro" hidden>
            <p class="ep">эпизод ${ep} · </p><p class="line"></p>
            <button class="again">${ICON.replay} Смотреть снова</button>
          </div>
          <div class="panel">
            <button class="play" title="пробел" aria-label="смотреть">${ICON.play}</button>
            <span class="act"></span>
            <div class="progress"></div>
            <button class="speed" title="скорость">1×</button>
            <button class="cc" title="C — субтитры">CC</button>
            <button class="mute" title="M — звук" aria-label="звук"></button>
            <button class="fs" title="F — во весь экран" aria-label="во весь экран">${ICON.fullscreen}</button>
          </div>
        </div>
      </div>`;
    this.$ = <T extends Element>(sel: string) => host.querySelector(sel) as T;
    this.stage = this.$<SVGSVGElement>(".stage");
    document.title = `${ep} · ${meta.title} — edugo`;
    // На финале главное — итог; название — мелкой строкой над ним, чтобы не выглядело возвратом к обложке.
    this.$<HTMLElement>(".cover h1").textContent = meta.title;
    this.$<HTMLElement>(".cover .line").textContent = meta.tagline;
    this.$<HTMLElement>(".outro .ep").append(meta.title);
    this.$<HTMLElement>(".outro .line").textContent = meta.outro;

    const progress = this.$<HTMLElement>(".progress");
    for (const a of acts) {
      const seg = document.createElement("div");
      seg.className = "seg";
      seg.style.flexGrow = String(a.count);
      seg.title = a.act;
      seg.setAttribute("aria-label", a.act);
      seg.innerHTML = `<i></i>`;
      progress.appendChild(seg);
      this.segs.push(seg);
    }
    // Сегменты по числу кадров, поэтому x на полосе линейно переводится в номер кадра.
    progress.addEventListener("click", (e) => {
      const box = progress.getBoundingClientRect();
      on.seek(Math.min(total - 1, Math.floor(((e.clientX - box.left) / box.width) * total)));
    });
    const select = this.$<HTMLSelectElement>(".acts");
    select.innerHTML = acts.map((a) => `<option value="${a.first}">${a.act}</option>`).join("");
    select.addEventListener("change", () => on.seek(Number(select.value)));

    // Фокус с кнопки снимаем: иначе пробел «нажмёт» её ещё раз поверх своего play/pause.
    const click = (sel: string, fn: () => void) =>
      this.$(sel).addEventListener("click", (e) => ((e.currentTarget as HTMLElement).blur?.(), fn()));
    click(".play", on.toggle);
    click(".big", on.toggle);
    click(".stage", () => (this.swallowTap ? (this.swallowTap = false) : on.toggle()));
    click(".again", on.restart);
    click(".speed", on.speed);
    click(".cc", on.subs);
    click(".mute", on.mute);
    click(".fs", () => this.fullscreen());
    const frame = this.$<HTMLElement>(".frame");
    frame.addEventListener("pointermove", () => this.wake());
    frame.addEventListener("pointerdown", (e) => {
      this.swallowTap = e.pointerType !== "mouse" && frame.classList.contains("idle");
      this.wake();
    });
    this.dev(new URLSearchParams(location.search).has("dev"));
  }

  /** Показать кадр index: прогресс, акт, подпись, субтитр, dev-счётчик. */
  frame(index: number, caption: string, narration: string): void {
    this.acts.forEach((a, i) => {
      const done = Math.max(0, Math.min(a.count, index - a.first + 1));
      this.segs[i].style.setProperty("--done", String(done / a.count));
    });
    const act = this.acts.filter((a) => a.first <= index).at(-1)!;
    this.$<HTMLElement>(".act").textContent = act.act;
    this.$<HTMLElement>(".caption").textContent = caption;
    this.$<HTMLElement>(".narration").textContent = narration;
    this.$<HTMLElement>(".counter").textContent = `кадр ${index + 1} / ${this.total}`;
    this.$<HTMLSelectElement>(".acts").value = String(act.first);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    const play = this.$<HTMLElement>(".play");
    play.innerHTML = playing ? ICON.pause : ICON.play;
    play.setAttribute("aria-label", playing ? "пауза" : "смотреть");
    this.wake();
  }

  setSpeed(speed: number): void {
    this.$<HTMLElement>(".speed").textContent = `${speed}×`;
  }

  setMuted(muted: boolean): void {
    this.$<HTMLElement>(".mute").innerHTML = muted ? ICON.muted : ICON.sound;
  }

  /** Субтитры диктора; возвращает новое состояние. */
  toggleSubs(): boolean {
    const line = this.$<HTMLElement>(".narration");
    line.hidden = !line.hidden;
    this.$<HTMLElement>(".cc").classList.toggle("on", !line.hidden);
    return !line.hidden;
  }

  get coverShown(): boolean {
    return !this.$<HTMLElement>(".cover").hidden;
  }

  cover(shown: boolean): void {
    this.$<HTMLElement>(".cover").hidden = !shown;
    this.$<HTMLElement>(".frame").classList.toggle("carded", shown || this.outroShown);
  }

  get outroShown(): boolean {
    return !this.$<HTMLElement>(".outro").hidden;
  }

  outro(shown: boolean): void {
    this.$<HTMLElement>(".outro").hidden = !shown;
    this.$<HTMLElement>(".frame").classList.toggle("carded", shown || this.coverShown);
  }

  /** Dev-полоса; без аргумента — переключить. */
  dev(on?: boolean): void {
    const bar = this.$<HTMLElement>(".dev");
    bar.hidden = !(on ?? bar.hidden === true);
  }

  fullscreen(): void {
    const player = this.$<HTMLElement>(".player");
    if (document.fullscreenElement) void document.exitFullscreen();
    else void player.requestFullscreen?.();
  }

  /** Показать панель; во время проигрывания — спрятать снова, если зритель не двигает мышью. */
  wake(): void {
    const frame = this.$<HTMLElement>(".frame");
    frame.classList.remove("idle");
    clearTimeout(this.idle);
    if (this.playing) this.idle = setTimeout(() => frame.classList.add("idle"), IDLE_MS);
  }
}
