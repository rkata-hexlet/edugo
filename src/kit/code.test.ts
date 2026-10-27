import { describe, expect, it } from "vitest";
import { highlightGo } from "./code";
import { SQL_COLOR } from "./theme";

describe("highlightGo", () => {
  const lines = ["res, err := tx.Exec(ctx, `UPDATE products", "  WHERE id = $1`, id)", "if err != nil { return err }"];
  const out = highlightGo(lines);

  it("текст строк не теряется", () => {
    expect(out.map((l) => l.map((s) => s.text).join(""))).toEqual(lines);
  });

  it("SQL внутри `…` — подсветкой SQL через перенос строки, Go снаружи — ключевые слова", () => {
    const fill = (l: number, part: string) => out[l].find((s) => s.text.includes(part))?.attrs?.fill;
    expect(fill(0, "UPDATE")).toBe(SQL_COLOR.keyword);
    expect(fill(1, "WHERE")).toBe(SQL_COLOR.keyword);
    expect(fill(2, "if")).toBe(SQL_COLOR.keyword);
    expect(fill(2, "err")).not.toBe(SQL_COLOR.keyword);
  });
});
