import type { Pen, Span } from "../engine/contract";
import { highlightSql } from "./sql";
import { COLOR, FONT, SAFE_BOTTOM, SIZE, SQL_COLOR } from "./theme";
import { panel, pill } from "./widgets";

// Окно кода пода на Go поверх сцены (вынесено из эпизода 05): SQL внутри `…` подсвечен как SQL, подсвеченные строки —
// где беда (жёлтым) или что поправили (зелёным). Окно одного размера во всех кадрах кода эпизода: меняются только
// подсвеченные строки.

/** Код на экране: строки и подсвеченные места. */
export interface Code {
  title: string;
  lines: string[];
  mark: { line: number; tone: "warn" | "ok"; note?: string }[];
}

const MONO = { "font-family": FONT.mono, "font-size": SIZE.say };
const SANS = { "font-family": FONT.sans, "font-size": SIZE.body };

const GO_KEYWORDS = /^(if|var|for|func|return|break|range|else|switch|case|default|defer|go)$/;

/** Строки Go: SQL внутри `…` — подсветкой SQL, снаружи — ключевые слова Go. Строка-литерал может тянуться на несколько строк. */
export function highlightGo(lines: string[]): Span[][] {
  let inside = false;
  return lines.map((line) => {
    const spans: Span[] = [];
    line.split("`").forEach((part, i) => {
      if (i > 0) {
        spans.push({ text: "`", attrs: { fill: SQL_COLOR.string } });
        inside = !inside;
      }
      if (!part) return;
      if (inside) spans.push(...highlightSql(part));
      else for (const m of part.matchAll(/([A-Za-z_]\w*)|(\d+)|([^A-Za-z_\d]+)/g)) {
        const fill = m[1] && GO_KEYWORDS.test(m[1]) ? SQL_COLOR.keyword : m[2] ? SQL_COLOR.number : COLOR.ink;
        spans.push({ text: m[0], attrs: { fill } });
      }
    });
    return spans;
  });
}

/**
 * Окно кода. `rows` — строк в самом длинном коде эпизода: по нему высота окна. Длинный код теснит строки, чтобы окно
 * не заходило ниже SAFE_BOTTOM.
 */
export function codeWindow(pen: Pen, c: Code | null, o: { rows: number; x?: number; y?: number; w?: number }): void {
  if (!c) return;
  const { rows, x = 200, y = 124, w = 880 } = o;
  const lineH = Math.min(34, Math.floor((SAFE_BOTTOM - 8 - y - 84) / rows));
  const h = 76 + rows * lineH + 8;
  pen.group("code", 0, 0, () => {
    panel(pen, "code:box", { x, y, w, h, fill: "#11172e", stroke: COLOR.muted });
    pen.text("code:title", { x: x + 28, y: y + 40, ...SANS, "font-size": SIZE.accent, "font-weight": 700, fill: COLOR.muted }, c.title);
    highlightGo(c.lines).forEach((spans, i) => {
      const ly = y + 86 + i * lineH;
      const mark = c.mark.find((m) => m.line === i);
      if (mark) {
        const tone = mark.tone === "warn" ? COLOR.warn : COLOR.ok;
        pen.rect(`code:m${i}`, { x: x + 16, y: ly - 24, width: w - 32, height: lineH - 2, rx: 4, fill: mark.tone === "warn" ? COLOR.draftBg : COLOR.doneBg, class: "fx-fade" });
        pen.rect(`code:b${i}`, { x: x + 16, y: ly - 24, width: 4, height: lineH - 2, fill: tone });
        if (mark.note) pill(pen, `code:n${i}`, mark.note, { x: x + w - 24 - pen.measure(mark.note, SANS).width - 28, y: ly - 22, fill: COLOR.bg, color: tone, stroke: tone, attrs: { class: "fx-pop" } });
      }
      pen.text(`code:l${i}`, { x: x + 32, y: ly, ...MONO }, spans);
    });
  }, { class: "fx-fade" });
}
