// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "./contract";
import { mountRecorder } from "./recorder";
import { Takes } from "./takes";

/** Рекордер браузера: сколько начато и сколько выброшено без сохранения. */
class FakeRecorder {
  static started = 0;
  static discarded = 0;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    FakeRecorder.started++;
  }
  stop() {
    if (!this.ondataavailable) FakeRecorder.discarded++;
    this.onstop?.();
  }
}
const played: string[] = [];
class FakeAudio {
  constructor(readonly src: string) {}
  play() {
    played.push(this.src);
    return Promise.resolve();
  }
  pause() {}
}

const texts = ["Первый кадр.", "Второй кадр.", "Третий кадр."];
const scene = {
  id: "03",
  meta: { episode: 3, title: "т", tagline: "т", outro: "итог" },
  steps: () => texts.map((narration) => ({ act: "акт", narration, state: {} })),
  render: () => {},
} as unknown as Scene<object>;

let host: HTMLElement;
let keys: EventListenerOrEventListenerObject[] = []; // клавиши суфлёров прошлых тестов не должны ловить нажатия следующих
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!.textContent;
const press = (key: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key }));
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeRecorder.started = FakeRecorder.discarded = 0;
  played.length = 0;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("AudioContext", class {
    createAnalyser = () => ({ fftSize: 32, getFloatTimeDomainData: () => {} });
    createMediaStreamSource = () => ({ connect: () => {} });
    close = () => Promise.resolve();
  });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [] }) },
  });
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ ms: 1500 }))));
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  // happy-dom шлёт hashchange и на replaceState (браузер — нет): суфлёр принял бы это за переход по ссылке
  vi.spyOn(history, "replaceState").mockImplementation(() => {});
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
    if (type === "keydown") keys.push(fn);
    add(type, fn);
  });
  document.body.innerHTML = "";
  host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  for (const fn of keys) document.removeEventListener("keydown", fn);
  keys = [];
  vi.restoreAllMocks();
});

describe("суфлёр: клавиши во время записи", () => {
  it("записал кадр, ← и P — пауза, прошлый кадр, звучит его дубль", async () => {
    mountRecorder(host, scene, new Takes("03"));
    await settle();
    press(" "); // запись кадра 1
    await settle();
    press(" "); // кадр 1 сохранён, сразу пишется кадр 2
    await settle();
    expect($(".where")).toContain("кадр 2");

    press("ArrowLeft");
    expect(FakeRecorder.discarded).toBe(1); // недочитанный кадр 2 выброшен, а не сохранён
    expect($(".where")).toContain("кадр 1 · дубль есть");
    expect($(".state")).toContain("Пауза");

    press("p");
    expect(played).toHaveLength(1);
    expect(played[0]).toContain("/voice/03/");
  });

  it("P во время записи: пауза и дубль текущего кадра; нет дубля — так и сказано", async () => {
    mountRecorder(host, scene, new Takes("03"));
    await settle();
    press(" ");
    await settle();
    press("p");
    expect(FakeRecorder.discarded).toBe(1);
    expect(played).toHaveLength(0);
    expect($(".state")).toContain("дубля нет");
  });

  it("→ во время записи — пауза на следующем кадре, запись сама не начинается", async () => {
    mountRecorder(host, scene, new Takes("03"));
    await settle();
    press(" ");
    await settle();
    press("ArrowRight");
    await settle();
    expect($(".where")).toContain("кадр 2");
    expect(FakeRecorder.started).toBe(1);
    expect($(".state")).toContain("Пауза");
  });
});
