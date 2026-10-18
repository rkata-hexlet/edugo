import type { Span } from "../engine/contract";
import { SQL_COLOR } from "./theme";

const KEYWORDS = new Set(
  ("select from where and or not in is null update set insert into values delete returning begin commit rollback " +
    "order by limit for skip locked nowait as on join with").split(" "),
);

/** Раскрасить SQL: ключевые слова, строки, числа, вызовы функций, `-- комментарий`; остальное — обычным цветом. */
export function highlightSql(text: string): Span[] {
  const comment = text.indexOf("--");
  if (comment >= 0 && !inString(text, comment)) {
    return [...highlightSql(text.slice(0, comment)), { text: text.slice(comment), attrs: { fill: SQL_COLOR.note } }];
  }
  const spans: Span[] = [];
  const push = (t: string, fill: string, bold = false) => {
    const last = spans.at(-1);
    if (last && last.attrs?.fill === fill && !bold && last.attrs?.["font-weight"] === undefined) last.text += t;
    else spans.push({ text: t, attrs: bold ? { fill, "font-weight": 700 } : { fill } });
  };
  const re = /('(?:[^']|'')*')|(\b\d+\b)|([A-Za-z_][A-Za-z_0-9]*)(?=\s*\()|([A-Za-z_][A-Za-z_0-9]*)|(\s+|[^\sA-Za-z_0-9']+)/g;
  for (const m of text.matchAll(re)) {
    const [all, str, num, fn, word] = m;
    if (str) push(all, SQL_COLOR.string);
    else if (num) push(all, SQL_COLOR.number);
    else if (fn && !KEYWORDS.has(fn.toLowerCase())) push(all, SQL_COLOR.fn);
    else if ((fn ?? word) && KEYWORDS.has((fn ?? word).toLowerCase())) push(all, SQL_COLOR.keyword, true);
    else push(all, SQL_COLOR.plain);
  }
  return spans;
}

/** Позиция внутри строкового литерала '…'? */
function inString(text: string, at: number): boolean {
  return (text.slice(0, at).match(/'/g)?.length ?? 0) % 2 === 1;
}
