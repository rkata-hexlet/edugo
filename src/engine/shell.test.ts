// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shell, type ShellEvents } from "./shell";

const meta = { episode: 1, title: "Три пода", tagline: "подзаголовок", outro: "итог" };
const acts = [
  { act: "Хук", first: 0, count: 2 },
  { act: "Кейс 1", first: 2, count: 6 },
];
let host: HTMLElement;
let on: ShellEvents;
let shell: Shell;
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  on = { toggle: vi.fn(), seek: vi.fn(), speed: vi.fn(), mute: vi.fn(), subs: vi.fn(), restart: vi.fn() };
  shell = new Shell(host, meta, acts, 8, on);
});

describe("Shell", () => {
  it("прогресс: заливка сегмента — пройденная доля акта, подпись — текущий акт", () => {
    shell.frame(3, "", "");
    const fills = [...host.querySelectorAll<HTMLElement>(".seg")].map((s) => s.style.getPropertyValue("--done"));
    expect(fills).toEqual(["1", String(2 / 6)]);
    expect($(".act").textContent).toBe("Кейс 1");
    expect($(".counter").textContent).toBe("кадр 4 / 8");
  });

  it("клик по полосе → кадр по доле ширины (сегменты пропорциональны числу кадров)", () => {
    const bar = $(".progress");
    bar.getBoundingClientRect = () => ({ left: 100, width: 800 }) as DOMRect;
    bar.dispatchEvent(new MouseEvent("click", { clientX: 100 + 800 * 0.35 }));
    bar.dispatchEvent(new MouseEvent("click", { clientX: 900 }));
    expect(on.seek).toHaveBeenNthCalledWith(1, 2);
    expect(on.seek).toHaveBeenNthCalledWith(2, 7);
  });

  it("обложка и финальная карточка — тексты из meta; пока карточка видна, панель спрятана", () => {
    expect($(".cover h1").textContent).toBe("Три пода");
    expect($(".cover .line").textContent).toBe("подзаголовок");
    expect($(".outro .line").textContent).toBe("итог");
    expect($(".outro .ep").textContent).toBe("эпизод 01 · Три пода");
    expect($(".cover .ep").textContent).toBe("эпизод 01");
    shell.cover(false);
    expect($(".frame").classList.contains("carded")).toBe(false);
    shell.outro(true);
    expect(shell.outroShown).toBe(true);
    expect($(".frame").classList.contains("carded")).toBe(true);
  });

  it("во время проигрывания панель прячется без движения мыши, на паузе — всегда видна", () => {
    shell.setPlaying(true);
    vi.advanceTimersByTime(3000);
    expect($(".frame").classList.contains("idle")).toBe(true);
    $(".frame").dispatchEvent(new Event("pointermove"));
    expect($(".frame").classList.contains("idle")).toBe(false);
    shell.setPlaying(false);
    vi.advanceTimersByTime(3000);
    expect($(".frame").classList.contains("idle")).toBe(false);
  });

  it("касание по спрятанной панели показывает её, а не ставит на паузу; клик мышью — пауза", () => {
    shell.setPlaying(true);
    vi.advanceTimersByTime(3000);
    const tap = (pointerType: string) => {
      $(".frame").dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType }));
      $(".stage").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    tap("touch");
    expect(on.toggle).not.toHaveBeenCalled();
    expect($(".frame").classList.contains("idle")).toBe(false);
    tap("touch");
    expect(on.toggle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    tap("mouse");
    expect(on.toggle).toHaveBeenCalledTimes(2);
  });

  it("dev-полоса: по умолчанию скрыта, D переключает", () => {
    expect($(".dev").hidden).toBe(true);
    shell.dev();
    expect($(".dev").hidden).toBe(false);
    shell.dev();
    expect($(".dev").hidden).toBe(true);
  });
});
