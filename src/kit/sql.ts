import type { Span } from "../engine/contract";
import { SQL_COLOR } from "./theme";

const KEYWORDS = new Set(
  ("select from where and or not in is null update set insert into values delete returning begin commit rollback " +
    "order by limit offset for skip locked nowait as on join with " +
    // Команды Redis — в той же панели, что и SQL.
    "get del ex publish").split(" "),
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
  const re = /('(?:[^']|'')*')|(\b\d+\b)|([A-Za-z_][A-Za-z_0-9]*)(?=\s*\()|([A-Za-z_0-9]+)|(\s+|[^\sA-Za-z_0-9']+)/g;
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

/** Часть SQL, о которой говорит голос: ярко (и своим цветом, если задан), остальное окно приглушено. */
export interface SqlMark {
  text: string;
  color?: string;
}

/** Приглушённая часть SQL-окна. */
export const SQL_DIM = 0.4;

/**
 * Подсветить в раскрашенных строках части `marks` (первое вхождение в строке, каждая часть — в своей строке);
 * остальной текст — `fill-opacity` SQL_DIM. Без marks строки не меняются.
 */
export function markSql(lines: Span[][], marks: SqlMark[]): Span[][] {
  if (!marks.length) return lines;
  return lines.map((line) => {
    const text = line.map((s) => s.text).join("");
    const hits = marks.flatMap((m) => {
      const at = text.indexOf(m.text);
      return at >= 0 && m.text ? [{ from: at, to: at + m.text.length, color: m.color }] : [];
    });
    const out: Span[] = [];
    let pos = 0;
    for (const s of line) {
      // Режем кусок по границам подсвеченных частей.
      const cuts = new Set([0, s.text.length]);
      for (const h of hits) [h.from - pos, h.to - pos].forEach((c) => c > 0 && c < s.text.length && cuts.add(c));
      const sorted = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const piece = s.text.slice(sorted[i], sorted[i + 1]);
        const hit = hits.find((h) => pos + sorted[i] >= h.from && pos + sorted[i] < h.to);
        const attrs = hit
          ? { ...s.attrs, ...(hit.color ? { fill: hit.color, "font-weight": 700 } : {}) }
          : { ...s.attrs, "fill-opacity": SQL_DIM };
        out.push({ text: piece, attrs });
      }
      pos += s.text.length;
    }
    return out;
  });
}
