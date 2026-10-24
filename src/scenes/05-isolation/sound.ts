import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Озвучка эпизода по карте sound-designer (docs/reviews/05-sound-design.md): громкая беда (40001) — «бзз»
// на square, самый громкий звук; тихая беда (перезапись чужого числа) — вялое «ап-ап» вниз и неверный аккорд;
// отказы без беды («нет в наличии», 0 строк) — глухо и вежливо. Хук и 1.1 звучат одинаково — рифма.
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинает бормотать Postgres — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;
/** Больше звуков в кадре — каша: лишнее отбрасываем. */
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

type Recipe = (s: Sound, at: number, e: SimEvent, o: { replay: boolean; quietGreen: boolean }) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp, k = 1) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09 * k, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08 * k, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08 * k, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.14, at: at + 0.15 });
    s.tone({ freq: 110, to: 60, dur: 0.1, gain: 0.14, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  // Лесенка уровней — один мягкий подъём, не ступеньки по нотам.
  ladder: (s, at) => {
    s.tone({ freq: 330, to: 523, dur: 0.3, wave: "triangle", gain: 0.035, at });
    s.noise({ dur: 0.15, freq: 1500, q: 0.6, gain: 0.02, at });
  },
  // Чтение: низкий мягкий щелчок; у B чуть выше — поды различимы на слух.
  read: (s, at, e) => {
    const f = e.by === "B" ? 190 : 160;
    s.tone({ freq: f, to: f * 0.56, dur: 0.08, gain: 0.08, at });
    s.noise({ dur: 0.04, freq: 300, q: 1, gain: 0.05, at });
  },
  write: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  wait: (s, at) => {
    s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.03, at });
    s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.03, at: at + 0.1 });
  },
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.14, at });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.14, at });
  },
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.08, at }),
  // «Нет в наличии» — вежливое «ну вот…», без тревоги: это нормальный ответ.
  none: (s, at) => {
    s.tone({ freq: 523, dur: 0.09, gain: 0.06, at });
    s.tone({ freq: 392, dur: 0.11, gain: 0.055, at: at + 0.09 });
  },
  // 0 строк — сухой «тук»: условие не прошло, ничего не записано.
  zero: (s, at) => {
    s.noise({ dur: 0.08, freq: 1200, q: 1, gain: 0.035, at });
    s.tone({ freq: 400, dur: 0.03, gain: 0.03, at: at + 0.1 });
  },
  // Перезапись чужого числа — тихая беда: вялое «ап-ап» вниз, без square и шума.
  clobber: (s, at) => {
    s.tone({ freq: 440, to: 330, dur: 0.07, wave: "triangle", gain: 0.05, at });
    s.tone({ freq: 330, to: 247, dur: 0.09, wave: "triangle", gain: 0.05, at: at + 0.11 });
  },
  // Продано больше, чем было, — неверный аккорд: два тона в полтона «бьются».
  oversold: (s, at) => {
    s.tone({ freq: 233, dur: 0.22, gain: 0.05, at });
    s.tone({ freq: 247, dur: 0.22, gain: 0.05, at });
    s.tone({ freq: 117, dur: 0.22, gain: 0.04, at });
  },
  // 40001 — громкая беда, один раз за ролик: пауза, «бзз-бзз» и стон вниз; в итоге — один «бзз».
  fail: (s, at, _e, o) => {
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.12 });
    if (o.replay) return;
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.25 });
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.09, at: at + 0.37 });
  },
  retry: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  // Лампы табло; при «продано больше» красную уже сказал неверный аккорд, зелёная — тише.
  verdict: (s, at, e, o) => e.lamps?.forEach((lamp, i) => {
    if (!lamp || (o.quietGreen && lamp === "red")) return;
    lampTone(s, at + 0.08 * i, lamp, o.quietGreen ? 0.6 : 1);
  }),
};

/**
 * Смена сцены звучит первой; «продано больше» — после «динь» лишнему заказу, табло — последним;
 * остальное — в порядке событий (рифма хука и 1.1).
 */
const RANK: Partial<Record<EventKind, number>> = { rewind: 0, page: 0, card: 0, ladder: 0, oversold: 2, verdict: 3 };

/** Сколько длится звук до следующего, с: по этой сумме встают звуки кадра. */
const SPAN: Partial<Record<EventKind, number>> = {
  rewind: 0.3, page: 0.1, card: 0.1, ladder: 0.1, read: 0.1, write: 0.1, wait: 0.22, retry: 0.12,
  clobber: 0.2, zero: 0.12, fail: 0.1, commit: 0.1, ok: 0.1, none: 0.15, oversold: 0.14, verdict: 0.1,
};

/** Сколько раз озвучить одно событие в кадре: два чтения (A и B) и два «динь» — да, остальное — по разу. */
const REPEAT: Partial<Record<EventKind, number>> = { read: 2, ok: 2 };

/** В итоге звучит только характерное — то, что зритель должен узнать. */
const RECAP = new Set<EventKind>(["commit", "clobber", "oversold", "zero", "none", "ok", "fail"]);

/** Какие события кадра озвучить и в каком порядке (≤ MAX_SOUNDS). */
export function score(w: World, replay = false): SimEvent[] {
  const has = (k: EventKind) => w.events.some((e) => e.kind === k);
  const drop = new Set<EventKind>(["press", "insert"]);
  if (has("commit") && has("clobber")) drop.add("write"); // правку с коммитом — одним «пум»
  if (has("rewind")) for (const k of ["page", "read"] as const) drop.add(k);
  if (has("card")) drop.add("page");
  const count = new Map<EventKind, number>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || drop.has(e.kind) || (replay && !RECAP.has(e.kind))) return false;
    const n = (count.get(e.kind) ?? 0) + 1;
    count.set(e.kind, n);
    return n <= (replay ? 1 : (REPEAT[e.kind] ?? 1));
  });
  const ordered = picked.map((e, i) => ({ e, i })).sort((a, b) => ((RANK[a.e.kind] ?? 1) - (RANK[b.e.kind] ?? 1)) || a.i - b.i).map((x) => x.e);
  // Лишнее — сначала фон (чтение, запись, ожидание, COMMIT), беду и ответ зритель должен услышать.
  while (ordered.length > MAX_SOUNDS) {
    const i = ordered.findIndex((e) => ["read", "write", "wait", "commit"].includes(e.kind));
    ordered.splice(i >= 0 ? i : ordered.length - 1, 1);
  }
  return ordered;
}

/** Тот же звук, громкость × k; старт не позже окна событий (хвосты рецептов прижимаются к нему). */
function shaped(s: Sound, k: number): Sound {
  const at = (t?: number) => Math.min(t ?? 0, EVENT_WINDOW);
  return {
    tone: (o) => s.tone({ ...o, gain: (o.gain ?? 0.1) * k, at: at(o.at) }),
    noise: (o) => s.noise({ ...o, gain: (o.gain ?? 0.1) * k, at: at(o.at) }),
    babble: (v, t, a) => s.babble({ ...v, gain: v.gain * k }, t, a),
  };
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

/** Озвучить кадр; replay — повтор в итоге: тише и только характерное. */
export function sound(out: Sound, w: World, replay = false): void {
  const s = shaped(out, replay ? 0.7 : 1);
  const events = score(w, replay);
  // Время — сумма длин предыдущих звуков; не влезает в окно — шаг сжимается.
  const starts: number[] = [];
  let t = 0;
  for (const e of events) {
    starts.push(t);
    t += SPAN[e.kind] ?? 0.1;
  }
  const last = starts.at(-1) ?? 0;
  const k = last > EVENT_WINDOW - 0.05 ? (EVENT_WINDOW - 0.05) / last : 1;
  const opts = { replay, quietGreen: events.some((e) => e.kind === "oversold") };
  events.forEach((e, i) => RECIPES[e.kind]!(s, starts[i] * k, e, opts));
  if (speakable(w.db)) s.babble({ ...DB_VOICE, gain: dbGain(w) }, w.db, BABBLE_AT);
}

/** Бормотание Postgres тише там, где спорит с драмой диктора: после 40001 и на «лишнем» заказе. */
function dbGain(w: World): number {
  if (w.events.some((e) => e.kind === "fail")) return 0.07;
  if (w.orders.filter((o) => o.committed).length > 1 && w.events.some((e) => e.kind === "commit")) return 0.06;
  return DB_VOICE.gain;
}
