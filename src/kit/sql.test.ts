import { describe, expect, it } from "vitest";
import { highlightSql } from "./sql";
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
  });

  it("цифры, сросшиеся с буквами (код ошибки 40P01), не теряются", () => {
    const q = "ERROR: deadlock detected (40P01)";
    expect(highlightSql(q).map((s) => s.text).join("")).toBe(q);
  });

  it("-- внутри строки — не комментарий", () => {
    expect(color("SELECT '--x' FROM t", "'--x'")).toBe(SQL_COLOR.string);
  });
});
