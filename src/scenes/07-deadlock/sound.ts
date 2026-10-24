import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { ACTORS, held, type EventKind, type SimEvent, type World } from "./sim";

// Озвучка эпизода словарём 05–06 (docs/reviews/05-sound-design.md): запись — короткий треугольник, ожидание замка —
// тихие щелчки, громкая беда (40P01) — «бзз» на square, самый громкий звук; отказ покупателю — два тона вниз.
// Новое в 07 (карта sound-designer — docs/reviews/07-sound-design.md): кольцо — тик ожидания, «щёлк-щёлк» двух замков
// и глухой удар; секундомер — деревянный «тик-так» ниже щелчков ожидания; детектор — двойной пинг; 40P01 — два «бзз»
// (стон отдан вежливому отказу); пробуждение после замка — два пинга вверх, не слайд (слайд — у повтора).
// Развязка (fail, refused, ok) — на абсолютных смещениях с конца, одинаковых в кадрах хука и SERIALIZABLE.
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.07 };

/** Обстановка кадра для рецептов: повтор итога; ждущий ничего не держит (очередь, а не кольцо); секунда уже прошла (развязка). */
interface Ctx {
  replay: boolean;
  empty: boolean;
  resolved: boolean;
}

type Recipe = (s: Sound, at: number, e: SimEvent, o: Ctx) => void;

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
  resume: (s, at) => [660, 880].forEach((freq, i) => s.tone({ freq, dur: 0.04, wave: "triangle", gain: 0.05, at: at + 0.05 * i })),
  wait: (s, at, _e, o) => (o.empty ? [0.03, 0.025, 0.02] : [0.035, 0.03, 0.025]).forEach((gain, i) => s.tone({ freq: 2000, dur: 0.015, wave: "square", gain, at: at + 0.14 * i })),
  ring: (s, at) => {
    s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.03, at });
    [0.06, 0.12].forEach((d) => s.noise({ dur: 0.04, freq: 900, q: 4, gain: 0.06, at: at + d }));
    s.tone({ freq: 120, to: 70, dur: 0.1, gain: 0.08, at: at + 0.06 });
  },
  // Кадр секундомера — тик-так-тик; в развязке секунда уже прошла — один «так».
  tick: (s, at, _e, o) => (o.resolved ? [600] : [800, 600, 800]).forEach((freq, i) => {
    s.tone({ freq, dur: o.resolved ? 0.04 : 0.025, wave: "triangle", gain: o.resolved ? 0.07 : 0.06, at: at + 0.15 * i });
    s.noise({ dur: 0.01, freq: 3000, q: 2, gain: 0.03, at: at + 0.15 * i });
  }),
  detect: (s, at) => [0, 0.06].forEach((d) => s.tone({ freq: 1568, dur: 0.04, gain: 0.06, at: at + d })),
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.11, at });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.11, at });
  },
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.09, gain: 0.1, at }),
  refused: (s, at) => {
    s.tone({ freq: 523, dur: 0.06, gain: 0.06, at });
    s.tone({ freq: 392, dur: 0.07, gain: 0.055, at: at + 0.06 });
  },
  fail: (s, at) => [0, 0.08].forEach((d) => s.tone({ freq: 200, dur: 0.07, wave: "square", gain: 0.17, at: at + d })),
  retry: (s, at) => s.tone({ freq: 400, to: 800, dur: 0.12, wave: "triangle", gain: 0.07, at }),
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => {
    if (lamp) lampTone(s, at + 0.08 * i, lamp);
  }),
};

/** Смена сцены первой, табло — последним; остальное — в порядке событий. */
const RANK: Partial<Record<EventKind, number>> = { rewind: 0, page: 0, card: 0, verdict: 3 };

const SPAN: Partial<Record<EventKind, number>> = {
  rewind: 0.2, page: 0.1, card: 0.1, write: 0.08, resume: 0.1, wait: 0.3, ring: 0.18, tick: 0.3,
  commit: 0.1, ok: 0.1, retry: 0.14, verdict: 0.08,
};

/** Сколько рецепт звучит после своего старта — чтобы последний звук целиком начинался в окне событий. */
const TAIL: Partial<Record<EventKind, number>> = { page: 0.21, rewind: 0.15, wait: 0.28, ring: 0.12, tick: 0.3, resume: 0.05, verdict: 0.08 };

/**
 * Развязка (40P01): абсолютные смещения — «так» секундомера, двойной пинг детектора, «бзз-бзз» звучат одинаково в хуке
 * и в попытке SERIALIZABLE. В SERIALIZABLE следом в том же кадре «ну вот» и «динь»; в хуке они — в следующем кадре.
 */
export const RESOLUTION: Partial<Record<EventKind, number>> = { tick: 0, fail: 0.17, refused: 0.31, ok: 0.41 };
const DETECT_AT = 0.06;

/** Две записи и два «динь» — да; остальное — по разу. */
const REPEAT: Partial<Record<EventKind, number>> = { write: 2, ok: 2 };

const RECAP = new Set<EventKind>(["ring", "tick", "detect", "resume", "fail", "commit", "ok", "refused"]);

const has = (w: World, k: EventKind) => w.events.some((e) => e.kind === k);

export function score(w: World, replay = false): SimEvent[] {
  // Развязка: только цепочка — «так», детектор, «бзз», отказ, «динь». Записи победителя, перелистывание и
  // красная лампа тонут: кадр и так плотный, лампу видно.
  if (has(w, "fail")) {
    const keep = new Set<EventKind>(["tick", "detect", "fail", "refused", "ok"]);
    const seen = new Set<EventKind>();
    return w.events.filter((e) => keep.has(e.kind) && !seen.has(e.kind) && seen.add(e.kind));
  }
  const drop = new Set<EventKind>(["press", "zero"]);
  if (has(w, "card")) drop.add("page");
  if (has(w, "ring")) drop.add("wait"); // тик ожидания — внутри рецепта кольца
  if (has(w, "retry")) for (const k of ["write", "commit"] as const) drop.add(k);
  const n = new Map<EventKind, number>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || drop.has(e.kind) || (replay && !RECAP.has(e.kind))) return false;
    const c = (n.get(e.kind) ?? 0) + 1;
    n.set(e.kind, c);
    return c <= (replay ? 1 : (REPEAT[e.kind] ?? 1));
  });
  const ordered = picked.map((e, i) => ({ e, i })).sort((a, b) => ((RANK[a.e.kind] ?? 1) - (RANK[b.e.kind] ?? 1)) || a.i - b.i).map((x) => x.e);
  while (ordered.length > MAX_SOUNDS) {
    const k = (["write", "commit", "page", "card", "verdict", "resume"] as const).find((x) => ordered.some((e) => e.kind === x));
    ordered.splice(k ? ordered.findIndex((e) => e.kind === k) : ordered.length - 1, 1);
  }
  return ordered;
}

/** Когда звучит каждое событие кадра: развязка — по таблице, остальное — подряд, сжатое в окно событий. */
export function schedule(w: World, events: SimEvent[]): number[] {
  if (has(w, "fail")) {
    return events.map((e) => (e.kind === "detect" ? DETECT_AT : RESOLUTION[e.kind] ?? 0));
  }
  const starts: number[] = [];
  let t = 0;
  for (const e of events) {
    starts.push(t);
    t += SPAN[e.kind] ?? 0.1;
  }
  // Старты сжимаются так, чтобы и хвост каждого рецепта уложился в окно (хвост не сжимается).
  const k = Math.min(1, ...events.map((e, i) => (starts[i] > 0 ? (EVENT_WINDOW - (TAIL[e.kind] ?? 0)) / starts[i] : 1)));
  return starts.map((x) => x * k);
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
  const starts = schedule(w, events);
  const waiter = ACTORS.find((id) => w.actors[id].tx?.waiting != null);
  const ctx: Ctx = { replay, empty: !!waiter && held(w, waiter).length === 0, resolved: has(w, "detect") };
  events.forEach((e, i) => RECIPES[e.kind]!(s, starts[i], e, ctx));
  // Кольцо замкнулось — после лязга тишина до голоса; в кадрах секунды и развязки слон тише.
  if (!speakable(w.db) || (has(w, "ring") && !has(w, "fail"))) return;
  s.babble({ ...DB_VOICE, gain: has(w, "tick") || has(w, "fail") ? 0.05 : DB_VOICE.gain }, w.db, BABBLE_AT);
}
