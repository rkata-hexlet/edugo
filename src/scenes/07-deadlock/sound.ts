import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import type { EventKind, SimEvent, World } from "./sim";

// Озвучка эпизода словарём 05–06 (docs/reviews/05-sound-design.md): запись — короткий треугольник, ожидание замка —
// тихие щелчки, громкая беда (40P01) — «бзз» на square, самый громкий звук; отказ покупателю — два тона вниз.
// Новое в 07 (черновик до sound-designer): кольцо замкнулось — глухой лязг двух замков; секундомер deadlock_timeout —
// тиканье; детектор нашёл цикл — короткий высокий сигнал перед «бзз».
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.07 };

type Recipe = (s: Sound, at: number, e: SimEvent, o: { replay: boolean }) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else {
    s.tone({ freq: 233, dur: 0.2, gain: 0.04, at });
    s.tone({ freq: 247, dur: 0.2, gain: 0.04, at });
  }
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.07, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  write: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  resume: (s, at) => s.tone({ freq: 600, to: 900, dur: 0.08, wave: "triangle", gain: 0.05, at }),
  wait: (s, at) => [0.035, 0.03, 0.025].forEach((gain, i) => s.tone({ freq: 2000, dur: 0.015, wave: "square", gain, at: at + 0.12 * i })),
  ring: (s, at) => {
    s.noise({ dur: 0.08, freq: 900, q: 4, gain: 0.06, at });
    s.tone({ freq: 180, dur: 0.12, gain: 0.08, at });
    s.tone({ freq: 190, dur: 0.12, gain: 0.08, at });
  },
  tick: (s, at) => [0, 0.14, 0.28].forEach((d, i) => s.tone({ freq: i % 2 ? 1500 : 1200, dur: 0.02, gain: 0.05, at: at + d })),
  detect: (s, at) => s.tone({ freq: 1568, dur: 0.06, gain: 0.06, at }),
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.11, at });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.11, at });
  },
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.09, gain: 0.1, at }),
  refused: (s, at) => {
    s.tone({ freq: 523, dur: 0.09, gain: 0.06, at });
    s.tone({ freq: 392, dur: 0.11, gain: 0.055, at: at + 0.09 });
  },
  fail: (s, at, _e, o) => {
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.17, at: at + 0.02 });
    if (o.replay) return;
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.17, at: at + 0.12 });
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.11, at: at + 0.22 });
  },
  retry: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => {
    if (lamp) lampTone(s, at + 0.08 * i, lamp);
  }),
};

/** Смена сцены первой, табло — последним; остальное — в порядке событий. */
const RANK: Partial<Record<EventKind, number>> = { rewind: 0, page: 0, card: 0, verdict: 3 };

const SPAN: Partial<Record<EventKind, number>> = {
  rewind: 0.2, page: 0.1, card: 0.1, write: 0.08, resume: 0.08, wait: 0.2, ring: 0.14, tick: 0.3, detect: 0.06,
  fail: 0.1, commit: 0.1, ok: 0.1, refused: 0.15, retry: 0.12, verdict: 0.1,
};

/** Сколько рецепт звучит после своего старта — чтобы последний звук целиком начинался в окне событий. */
const TAIL: Partial<Record<EventKind, number>> = { page: 0.21, rewind: 0.15, wait: 0.24, tick: 0.28, refused: 0.09, fail: 0.22, verdict: 0.08 };

/** Две записи и два «динь» — да; остальное — по разу. */
const REPEAT: Partial<Record<EventKind, number>> = { write: 2, ok: 2 };

const RECAP = new Set<EventKind>(["ring", "fail", "commit", "ok", "refused"]);

export function score(w: World, replay = false): SimEvent[] {
  const has = (k: EventKind) => w.events.some((e) => e.kind === k);
  const drop = new Set<EventKind>(["press", "zero"]);
  if (has("card")) drop.add("page");
  if (has("ring")) drop.add("wait");
  // Кадр развязки: слышны секунда, «бзз» и подтверждение — записи победителя тонут.
  if (has("fail")) for (const k of ["write", "resume", "commit"] as const) drop.add(k);
  if (has("retry")) for (const k of ["write", "commit"] as const) drop.add(k);
  const n = new Map<EventKind, number>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || drop.has(e.kind) || (replay && !RECAP.has(e.kind))) return false;
    const c = (n.get(e.kind) ?? 0) + 1;
    n.set(e.kind, c);
    return c <= (replay ? 1 : (REPEAT[e.kind] ?? 1));
  });
  const ordered = picked.map((e, i) => ({ e, i })).sort((a, b) => ((RANK[a.e.kind] ?? 1) - (RANK[b.e.kind] ?? 1)) || a.i - b.i).map((x) => x.e);
  while (ordered.length > MAX_SOUNDS) {
    const k = (["write", "commit", "ok"] as const).find((x) => ordered.some((e) => e.kind === x));
    ordered.splice(k ? ordered.findIndex((e) => e.kind === k) : ordered.length - 1, 1);
  }
  return ordered;
}

function shaped(s: Sound, k: number): Sound {
  return {
    tone: (o) => s.tone({ ...o, gain: (o.gain ?? 0.1) * k }),
    noise: (o) => s.noise({ ...o, gain: (o.gain ?? 0.1) * k }),
    babble: (v, t, a) => s.babble({ ...v, gain: v.gain * k }, t, a),
  };
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

export function sound(out: Sound, w: World, replay = false): void {
  const s = shaped(out, replay ? 0.7 : 1);
  const events = score(w, replay);
  const starts: number[] = [];
  let t = 0;
  for (const e of events) {
    starts.push(t);
    t += SPAN[e.kind] ?? 0.1;
  }
  // Старты сжимаются так, чтобы и хвост каждого рецепта уложился в окно (хвост не сжимается).
  const k = Math.min(1, ...events.map((e, i) => (starts[i] > 0 ? (EVENT_WINDOW - (TAIL[e.kind] ?? 0)) / starts[i] : 1)));
  const opts = { replay };
  events.forEach((e, i) => RECIPES[e.kind]!(s, starts[i] * k, e, opts));
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
