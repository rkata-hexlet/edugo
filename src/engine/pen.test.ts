// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAVE_MS, SvgPen } from "./pen";

let svg: SVGSVGElement;
let pen: SvgPen;

beforeEach(() => {
  vi.useFakeTimers();
  svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.appendChild(svg);
  pen = new SvgPen(svg);
});
afterEach(() => {
  svg.remove();
  vi.useRealTimers();
});

const layer = (name: string) => svg.querySelector(`[data-layer="${name}"]`)!;
const keys = (parent: Element) => [...parent.children].map((n) => n.getAttribute("id"));

describe("SvgPen: порядок наложения", () => {
  it("внутри слоя — порядок рисования, даже если узел создан в позднем кадре", () => {
    pen.frame(() => pen.rect("b", { id: "b" }));
    pen.frame(() => {
      pen.rect("a", { id: "a" }); // новый узел, но нарисован первым — должен быть снизу
      pen.rect("b", { id: "b" });
    });
    expect(keys(layer("main"))).toEqual(["a", "b"]);

    pen.frame(() => {
      pen.rect("b", { id: "b" });
      pen.rect("a", { id: "a" });
    });
    expect(keys(layer("main"))).toEqual(["b", "a"]);
  });

  it("слой top поверх main, где бы его ни вызвали; без вызова — main", () => {
    pen.frame(() => {
      pen.group("g", 10, 20, () => {
        pen.layer("top", () => pen.rect("bubble", { id: "bubble" }));
        pen.rect("body", { id: "body" });
      });
    });
    expect(keys(layer("top"))).toEqual(["bubble"]);
    expect(svg.querySelector("#body")!.parentElement!.parentElement).toBe(layer("main"));
    const order = [...svg.children].map((n) => n.getAttribute("data-layer")).filter(Boolean);
    expect(order).toEqual(["back", "main", "front", "top"]);
  });
});

describe("SvgPen: уход", () => {
  it("исчезнувший узел гаснет и удаляется через LEAVE_MS", () => {
    pen.frame(() => pen.rect("a", { id: "a" }));
    pen.frame(() => {});
    const a = svg.querySelector("#a")!;
    expect(a.classList.contains("leaving")).toBe(true);
    vi.advanceTimersByTime(LEAVE_MS * 4); // запасной таймер: в happy-dom нет CSS-переходов
    expect(a.isConnected).toBe(false);
  });

  it("по концу перехода узел удаляется сразу, не дожидаясь таймера", () => {
    pen.frame(() => pen.rect("a", { id: "a" }));
    pen.frame(() => {});
    const a = svg.querySelector("#a")!;
    a.dispatchEvent(new Event("transitionend"));
    expect(a.isConnected).toBe(false);
  });

  it("instant убирает сразу — и новые ушедшие, и ещё гаснущие", () => {
    pen.frame(() => {
      pen.rect("a", { id: "a" });
      pen.rect("b", { id: "b" });
    });
    pen.frame(() => pen.rect("b", { id: "b" }));
    pen.frame(() => {}, { instant: true });
    expect(svg.querySelector("#a")).toBeNull();
    expect(svg.querySelector("#b")).toBeNull();
  });

  it("ребёнок ушедшей группы гаснет вместе с ней, а не сам по себе", () => {
    pen.frame(() => pen.group("g", 0, 0, () => pen.rect("child", { id: "child" }), { id: "g" }));
    pen.frame(() => {});
    expect(svg.querySelector("#g")!.classList.contains("leaving")).toBe(true);
    expect(svg.querySelector("#child")!.classList.contains("leaving")).toBe(false);
  });

  it("гаснущий узел остаётся на своём месте, а не всплывает над следующими", () => {
    pen.frame(() => ["a", "b", "c"].forEach((k) => pen.rect(k, { id: k })));
    pen.frame(() => ["b", "c"].forEach((k) => pen.rect(k, { id: k })));
    expect(keys(layer("main"))).toEqual(["a", "b", "c"]);
    pen.frame(() => ["c", "b"].forEach((k) => pen.rect(k, { id: k })));
    expect(keys(layer("main"))).toEqual(["a", "c", "b"]);
  });

  it("ключ, нарисованный снова во время угасания, — новый узел", () => {
    pen.frame(() => pen.rect("a", { id: "old" }));
    pen.frame(() => {});
    pen.frame(() => pen.rect("a", { id: "new" }));
    expect(svg.querySelector("#new")!.classList.contains("leaving")).toBe(false);
    expect(svg.querySelector("#old")!.classList.contains("leaving")).toBe(true);
  });
});

describe("SvgPen: перемотка без движения", () => {
  it("instant: новые узлы — без анимации навсегда, класс no-anim снят после кадра", () => {
    pen.frame(() => pen.rect("a", { id: "a" }), { instant: true });
    expect(svg.querySelector<SVGRectElement>("#a")!.style.animation).toBe("none");
    expect(svg.classList.contains("no-anim")).toBe(false);
    pen.frame(() => {
      pen.rect("a", { id: "a" });
      pen.rect("b", { id: "b" });
    });
    expect(svg.querySelector<SVGRectElement>("#b")!.style.animation).toBe("");
  });
});

describe("SvgPen: группа", () => {
  it("transform: поворот и масштаб вокруг origin, один и тот же список функций", () => {
    pen.frame(() => pen.group("g", 10, 20, () => {}, { id: "g" }));
    const g = svg.querySelector<SVGGElement>("#g")!;
    expect(g.style.transform).toBe("translate(10px, 20px) translate(0px, 0px) rotate(0deg) scale(1) translate(0px, 0px)");
    pen.frame(() => pen.group("g", 10, 20, () => {}, { id: "g" }, { rotate: 15, scale: 1.2, origin: [30, 40] }));
    expect(g.style.transform).toBe("translate(10px, 20px) translate(30px, 40px) rotate(15deg) scale(1.2) translate(-30px, -40px)");
  });
});

describe("SvgPen: текст", () => {
  it("Span[] — куски со своими атрибутами, \\n рвёт строку", () => {
    pen.frame(() =>
      pen.text("sql", { id: "sql", x: 5 }, [
        { text: "SELECT", attrs: { fill: "blue" } },
        { text: " id\nFROM " },
        { text: "tasks", attrs: { "font-weight": 700 } },
      ]),
    );
    const rows = [...svg.querySelector("#sql")!.children];
    expect(rows.map((r) => r.textContent)).toEqual(["SELECT id", "FROM tasks"]);
    expect(rows.map((r) => r.getAttribute("x"))).toEqual(["5", "5"]);
    expect(rows[1].getAttribute("dy")).toBe("1.3em");
    expect(rows[0].children[0].getAttribute("fill")).toBe("blue");
    expect(rows[1].children[1].getAttribute("font-weight")).toBe("700");
  });

  it("строка без кусков — как раньше, текст прямо в строке", () => {
    pen.frame(() => pen.text("t", { id: "t" }, "раз\n\nтри"));
    const rows = [...svg.querySelector("#t")!.children];
    expect(rows.map((r) => r.textContent)).toEqual(["раз", " ", "три"]);
    expect(rows[0].children).toHaveLength(0);
  });

  it("смена x перерисовывает строки", () => {
    pen.frame(() => pen.text("t", { id: "t", x: 1 }, "a"));
    pen.frame(() => pen.text("t", { id: "t", x: 9 }, "a"));
    expect(svg.querySelector("#t tspan")!.getAttribute("x")).toBe("9");
  });

  it("measure: высота по строкам, ширина — по самой длинной строке; линейка не мешает кадру", () => {
    const one = pen.measure("abcd", { "font-size": 20 });
    const two = pen.measure([{ text: "abcd\n" }, { text: "abcdefgh", attrs: { fill: "red" } }], { "font-size": 20 });
    expect(one.height).toBe(20);
    expect(two.height).toBe(20 + 26);
    expect(two.width).toBeGreaterThan(one.width);
    pen.frame(() => pen.rect("a", { id: "a" }));
    pen.frame(() => pen.rect("a", { id: "a" }));
    expect(svg.querySelector("#a")!.classList.contains("leaving")).toBe(false);
  });

  it("measure: крупный кусок поднимает высоту строки; линейка остаётся скрытой при любых attrs", () => {
    const big = pen.measure([{ text: "a" }, { text: "B", attrs: { "font-size": 40 } }], { "font-size": 20 });
    expect(big.height).toBe(40);
    pen.measure("x", { "font-size": 20, visibility: "visible" });
    const ruler = [...svg.children].find((n) => n.tagName.toLowerCase() === "text")!;
    expect(ruler.getAttribute("visibility")).toBe("hidden");
    expect(ruler.textContent).toBe("");
  });
});
