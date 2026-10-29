import { describe, expect, it } from "vitest";
import { SQL_DIM, highlightSql, markSql } from "./sql";
import { SQL_COLOR } from "./theme";

const color = (text: string, part: string) => highlightSql(text).find((s) => s.text.includes(part))?.attrs?.fill;

describe("highlightSql", () => {
  it("текст не теряется и не дублируется", () => {
    const q = "UPDATE tasks SET status='in_progress' WHERE id IN (SELECT id FROM tasks LIMIT 1) -- ждёт";
    expect(highlightSql(q).map((s) => s.text).join("")).toBe(q);
  });

  it("ключевые слова, строки, числа, функции, комментарий — своими цветами", () => {
    const q = "SELECT now() FROM tasks WHERE status='new' LIMIT 1  -- ждёт COMMIT";
    expect(color(q, "SELECT")).toBe(SQL_COLOR.keyword);
    expect(color(q, "'new'")).toBe(SQL_COLOR.string);
    expect(color(q, "1")).toBe(SQL_COLOR.number);
    expect(color(q, "now")).toBe(SQL_COLOR.fn);
    expect(color(q, "tasks")).toBe(SQL_COLOR.plain);
    expect(color(q, "-- ждёт COMMIT")).toBe(SQL_COLOR.note);
    expect(color("SELECT * FROM offers LIMIT 5 OFFSET 5", "OFFSET")).toBe(SQL_COLOR.keyword);
  });

  it("цифры, сросшиеся с буквами (код ошибки 40P01), не теряются", () => {
    const q = "ERROR: deadlock detected (40P01)";
    expect(highlightSql(q).map((s) => s.text).join("")).toBe(q);
  });

  it("-- внутри строки — не комментарий", () => {
    expect(color("SELECT '--x' FROM t", "'--x'")).toBe(SQL_COLOR.string);
  });
});

describe("markSql", () => {
  const lines = [highlightSql("SELECT * FROM offers"), highlightSql("LIMIT 5 OFFSET 5")];
  const plain = (ls: ReturnType<typeof markSql>) => ls.map((l) => l.map((s) => s.text).join(""));

  it("без частей — строки как были", () => {
    expect(markSql(lines, [])).toBe(lines);
  });

  it("текст не теряется; часть яркая и своим цветом, остальное приглушено", () => {
    const out = markSql(lines, [{ text: "OFFSET 5", color: "#f00" }]);
    expect(plain(out)).toEqual(["SELECT * FROM offers", "LIMIT 5 OFFSET 5"]);
    const bright = out.flat().filter((s) => s.attrs?.["fill-opacity"] === undefined);
    expect(bright.map((s) => s.text).join("")).toBe("OFFSET 5");
    expect(bright.every((s) => s.attrs?.fill === "#f00")).toBe(true);
    expect(out[0].find((s) => s.text === "SELECT")?.attrs?.["fill-opacity"]).toBe(SQL_DIM);
  });

  it("часть посреди куска режет его; без цвета — исходная раскраска", () => {
    const out = markSql([highlightSql("WHERE price > 4900")], [{ text: "> 49" }]);
    expect(plain(out)).toEqual(["WHERE price > 4900"]);
    const bright = out[0].filter((s) => s.attrs?.["fill-opacity"] === undefined).map((s) => s.text).join("");
    expect(bright).toBe("> 49");
    expect(out[0].find((s) => s.text === "49")?.attrs?.fill).toBe(SQL_COLOR.number);
  });
});
