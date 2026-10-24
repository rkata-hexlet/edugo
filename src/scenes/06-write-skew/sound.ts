import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import type { EventKind, SimEvent, World } from "./sim";

// Озвучка эпизода словарём 05 (docs/reviews/05-sound-design.md): громкая беда (40001) — «бзз» на square, самый
// громкий звук; тихая беда (у курьера коробок больше, чем мест) — неверный аккорд, как «продано больше» в 05; отказы
// без беды («слот занят», 0 строк) — глухо и вежливо. Новое в 06: метка чтения SERIALIZABLE — тихий стеклянный
// «пинг» выше зоны «успеха» (никого не держит — без стука замка); чужая вставка под метку — тот же пинг с расстроенной
// парой (биение: «задело»); цикл замкнулся — обе метки звенят вместе и глухой щелчок. Пустой коммит не звучит.
// Карта — docs/reviews/06-sound-design.md.
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.07 };

type Recipe = (s: Sound, at: number, e: SimEvent, o: { replay: boolean }) => void;

/** Неверный аккорд «коробок больше, чем мест» (как oversold в 05) и просадка курьера вниз. */
const wrongChord = (s: Sound, at: number, k = 1) => {
  s.tone({ freq: 233, dur: 0.22, gain: 0.05 * k, at });
  s.tone({ freq: 247, dur: 0.22, gain: 0.05 * k, at });
  s.tone({ freq: 130, to: 96, dur: 0.28, gain: 0.04 * k, at });
  s.tone({ freq: 466, dur: 0.22, wave: "triangle", gain: 0.02 * k, at });
  s.tone({ freq: 494, dur: 0.22, wave: "triangle", gain: 0.02 * k, at });
};

// Красная лампа в 06 бывает только при перегрузе — тот же аккорд тише; «бзз» на square — только у 40001.
const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else wrongChord(s, at, 0.6);
};

/** Стекло метки: тон пода и обертон. */
const GLASS: Record<string, [number, number]> = { A: [1760, 2637], B: [2093, 3136] };

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.07, at: at + 0.15 });
    s.tone({ freq: 90, to: 50, dur: 0.08, gain: 0.07, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  // Подсчёт заказов — тот же мягкий щелчок, что чтение в 05; у B чуть выше.
  count: (s, at, e) => {
    const f = e.by === "B" ? 190 : 160;
    s.tone({ freq: f, to: f * 0.56, dur: 0.08, gain: 0.08, at });
    s.noise({ dur: 0.04, freq: 300, q: 1, gain: 0.05, at });
  },
  // Вставка своей строки — короткий треугольник, как запись в 05.
  insert: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  write: (s, at, e) => s.tone({ freq: e.by === "B" ? 520 : 440, dur: 0.06, wave: "triangle", gain: 0.07, at }),
  wait: (s, at) => [0.035, 0.03, 0.025].forEach((gain, i) => s.tone({ freq: 2000, dur: 0.015, wave: "square", gain, at: at + 0.14 * i })),
  mark: (s, at, e) => {
    const [f, h] = GLASS[e.by ?? "A"];
    s.tone({ freq: f, dur: 0.12, gain: 0.04, at });
    s.tone({ freq: h, dur: 0.07, gain: 0.012, at });
  },
  // Вставка задела метку соседа: его стекло и полутон выше — биение.
  dep: (s, at, e) => {
    const f = GLASS[e.by === "A" ? "B" : "A"][0];
    s.tone({ freq: f, dur: 0.15, gain: 0.035, at });
    s.tone({ freq: f * 1.0595, dur: 0.15, gain: 0.035, at });
  },
  ring: (s, at) => {
    s.tone({ freq: 1760, dur: 0.3, gain: 0.035, at });
    s.tone({ freq: 2093, dur: 0.3, gain: 0.035, at });
    s.tone({ freq: 1865, dur: 0.3, gain: 0.02, at });
    s.tone({ freq: 220, dur: 0.09, gain: 0.04, at: at + 0.12 });
  },
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.11, at });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.11, at });
  },
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.09, gain: 0.1, at }),
  busy: (s, at) => {
    s.tone({ freq: 523, dur: 0.09, gain: 0.06, at });
    s.tone({ freq: 392, dur: 0.11, gain: 0.055, at: at + 0.09 });
  },
  zero: (s, at) => {
    s.noise({ dur: 0.08, freq: 1200, q: 1, gain: 0.035, at });
    s.tone({ freq: 400, dur: 0.03, gain: 0.03, at: at + 0.1 });
  },
  overload: (s, at) => wrongChord(s, at),
  // «Бзз-бзз-стон» — три разных момента, все в окне событий.
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

/** Смена сцены первой; перегруз — после «динь» подтверждений, табло — последним; остальное — в порядке событий. */
const RANK: Partial<Record<EventKind, number>> = { rewind: 0, page: 0, card: 0, mark: 1.5, overload: 2, verdict: 3 };

const SPAN: Partial<Record<EventKind, number>> = {
  rewind: 0.25, page: 0.1, card: 0.1, count: 0.1, insert: 0.1, write: 0.1, wait: 0.22, retry: 0.12, mark: 0.08, dep: 0.12, ring: 0.2,
  zero: 0.12, fail: 0.1, commit: 0.1, ok: 0.1, busy: 0.15, overload: 0.14, verdict: 0.1,
};

/** Два подсчёта, две вставки, два «динь», две метки и две зависимости — да; остальное — по разу. */
const REPEAT: Partial<Record<EventKind, number>> = { count: 2, insert: 2, ok: 2, mark: 2, dep: 2 };

const RECAP = new Set<EventKind>(["commit", "overload", "zero", "busy", "ok", "fail"]);

export function score(w: World, replay = false): SimEvent[] {
  const has = (k: EventKind, by?: SimEvent["by"]) => w.events.some((e) => e.kind === k && (by === undefined || e.by === by));
  const drop = new Set<EventKind>(["press", "doom"]);
  if (has("rewind")) for (const k of ["page", "count", "insert"] as const) drop.add(k);
  if (has("card") || has("overload")) drop.add("page");
  if (has("ring")) drop.add("dep");
  // Повтор уже знаком по прошлым кадрам: слышен подскок и исход.
  if (has("retry")) for (const k of ["count", "mark", "commit"] as const) drop.add(k);
  // Вставка, закоммиченная в том же кадре, слышна коммитом; пустой коммит (отказ) — не «пум».
  const silent = (e: SimEvent) =>
    (e.kind === "insert" && has("commit", e.by)) ||
    (e.kind === "commit" && (has("busy", e.by) || has("zero", e.by) || has("fail", e.by)));
  const n = new Map<EventKind, number>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || drop.has(e.kind) || (!replay && silent(e)) || (replay && !RECAP.has(e.kind))) return false;
    const c = (n.get(e.kind) ?? 0) + 1;
    n.set(e.kind, c);
    return c <= (replay ? 1 : (REPEAT[e.kind] ?? 1));
  });
  const ordered = picked.map((e, i) => ({ e, i })).sort((a, b) => ((RANK[a.e.kind] ?? 1) - (RANK[b.e.kind] ?? 1)) || a.i - b.i).map((x) => x.e);
  while (ordered.length > MAX_SOUNDS) {
    const k = (["mark", "count", "insert"] as const).find((x) => ordered.some((e) => e.kind === x));
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
  // Тихая беда: пауза перед коммитом, чтобы аккорд перегруза прозвучал как развязка.
  let t = events.some((e) => e.kind === "overload") ? 0.1 : 0;
  for (const e of events) {
    starts.push(t);
    t += SPAN[e.kind] ?? 0.1;
  }
  const last = starts.at(-1) ?? 0;
  const k = last > EVENT_WINDOW - 0.05 ? (EVENT_WINDOW - 0.05) / last : 1;
  const opts = { replay };
  events.forEach((e, i) => RECIPES[e.kind]!(s, starts[i] * k, e, opts));
  if (speakable(w.db)) s.babble({ ...DB_VOICE, gain: w.events.some((e) => e.kind === "overload") ? 0.06 : DB_VOICE.gain }, w.db, BABBLE_AT);
}
