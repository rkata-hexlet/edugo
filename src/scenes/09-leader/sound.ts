import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { ACTORS, type EventKind, type SimEvent, type World } from "./sim";

// Карта звука — docs/reviews/09-sound-design.md. Словарь серии из 08 дословно: касса — списание; та же касса со
// сломанной нотой и «бзз» — дубль (рифма хука, 2.2, 2.3); штамп со звонком — банк узнал ключ; удар и пила — OOM Killer.
// Новое в 09: будильник cron лесенкой по подам, «клак» замка и лёгкий «клик» его отпускания, вежливое «тук-тук» — занято,
// падение с вопросом — узел пропал, треск помех — пропала связь с базой, «тик» срока и подъём — роль перешла.
// Кадр собирается по ролям: смена сцены → причина → следствие → герой → табло; герой глушит фон.
// Старты звуков — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

export const EVENT_WINDOW = 0.45;
export const BABBLE_AT = 0.5;
export const MAX_SOUNDS = 6;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.07 };
const BANK_VOICE: Voice = { wave: "triangle", pitch: 180, rate: 7, spread: 0.6, gain: 0.05 };

/** Как звучит событие в этом кадре: `compact` — дубль рядом с красной лампой (стон играет лампа), `pending` — запрос ещё в банке. */
interface Cue {
  e: SimEvent;
  compact?: boolean;
  pending?: boolean;
}

type Recipe = (s: Sound, at: number, c: Cue) => void;

const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

const CRON_FREQ = [1568, 1760, 1976];

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 }),
  rewind: (s, at) => s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at }),
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  cron: (s, at, { e }) => {
    const f = CRON_FREQ[ACTORS.indexOf(e.by ?? "A")];
    [0, 0.06].forEach((d) => s.tone({ freq: f, dur: 0.04, wave: "square", gain: 0.04, at: at + d }));
  },
  charge: (s, at, { pending }) => {
    if (pending) {
      s.tone({ freq: 440, dur: 0.06, wave: "triangle", gain: 0.05, at });
      return;
    }
    s.tone({ freq: 880, dur: 0.05, wave: "triangle", gain: 0.07, at });
    s.tone({ freq: 1320, dur: 0.07, wave: "triangle", gain: 0.07, at: at + 0.05 });
    s.noise({ dur: 0.03, freq: 2500, q: 1, gain: 0.04, at: at + 0.1 });
  },
  double: (s, at, { compact }) => {
    s.tone({ freq: 880, dur: 0.05, wave: "triangle", gain: 0.07, at });
    s.tone({ freq: 1320, to: 700, dur: 0.07, wave: "triangle", gain: 0.07, at: at + 0.05 });
    if (compact) {
      [0.12, 0.22].forEach((d) => s.tone({ freq: 200, dur: 0.08, wave: "square", gain: 0.14, at: at + d }));
      return;
    }
    [0.15, 0.28].forEach((d) => s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.14, at: at + d }));
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.09, at: at + 0.4 });
  },
  replayed: (s, at) => {
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.12, at: at + 0.02 });
    s.tone({ freq: 150, to: 90, dur: 0.08, gain: 0.12, at: at + 0.02 });
    s.tone({ freq: 1568, dur: 0.14, gain: 0.06, at: at + 0.12 });
    s.tone({ freq: 2093, dur: 0.14, gain: 0.04, at: at + 0.2 });
  },
  insert: (s, at) => s.noise({ dur: 0.05, freq: 300, q: 1, gain: 0.07, at }),
  note: (s, at) => {
    s.tone({ freq: 1319, dur: 0.06, gain: 0.07, at });
    s.tone({ freq: 1047, dur: 0.08, gain: 0.07, at: at + 0.05 });
  },
  lock: (s, at) => {
    s.noise({ dur: 0.025, freq: 2200, q: 2, gain: 0.09, at });
    s.tone({ freq: 880, dur: 0.06, gain: 0.05, at: at + 0.025 });
    s.tone({ freq: 180, dur: 0.06, gain: 0.08, at: at + 0.03 });
  },
  unlock: (s, at) => {
    s.noise({ dur: 0.02, freq: 1800, q: 2, gain: 0.05, at });
    s.tone({ freq: 700, to: 500, dur: 0.08, gain: 0.05, at: at + 0.02 });
  },
  busy: (s, at, { e }) => {
    const f = e.by === "C" ? 230 : 260;
    [0, 0.1].forEach((d) => {
      s.tone({ freq: f, to: f * 0.7, dur: 0.05, gain: 0.09, at: at + d });
      s.noise({ dur: 0.02, freq: 600, q: 1, gain: 0.04, at: at + d });
    });
  },
  silent: (s, at) => {
    s.tone({ freq: 740, to: 370, dur: 0.18, gain: 0.06, at });
    s.tone({ freq: 440, to: 587, dur: 0.1, gain: 0.04, at: at + 0.22 });
  },
  cut: (s, at) => {
    s.noise({ dur: 0.12, freq: 3000, q: 0.5, gain: 0.06, at });
    s.noise({ dur: 0.02, freq: 5000, q: 2, gain: 0.05, at: at + 0.14 });
  },
  crash: (s, at) => {
    s.noise({ dur: 0.2, freq: 150, q: 0.7, gain: 0.2, at: at + 0.02 });
    s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.08, at: at + 0.05 });
  },
  restart: (s, at) => [523, 659, 784].forEach((f, i) => s.tone({ freq: f, dur: 0.04, gain: 0.05, at: at + 0.05 * i })),
  takeover: (s, at) => {
    s.noise({ dur: 0.02, freq: 2500, q: 3, gain: 0.05, at });
    s.tone({ freq: 440, to: 880, dur: 0.12, wave: "triangle", gain: 0.07, at: at + 0.03 });
  },
  renew: (s, at) => [587, 784].forEach((f, i) => s.tone({ freq: f, dur: 0.05, gain: 0.05, at: at + 0.06 * i })),
  lost: (s, at) => s.tone({ freq: 587, to: 330, dur: 0.14, wave: "triangle", gain: 0.06, at }),
  // Часы БД, как в серии: секунды — тик-тик, десятки — четыре тика, полминуты — трель, часы — перемотка из 01.
  tick: (s, at, { e }) => {
    const n = e.n ?? 0;
    if (n >= 60) {
      s.noise({ dur: 0.15, freq: 2000, q: 0.5, gain: 0.05, at });
      s.noise({ dur: 0.15, freq: 3500, q: 0.5, gain: 0.05, at: at + 0.15 });
    }
    const [count, gap, gain] = n >= 60 ? [8, 0.04, 0.035] : n >= 20 ? [6, 0.04, 0.035] : n >= 6 ? [4, 0.07, 0.04] : [2, 0.1, 0.04];
    for (let i = 0; i < count; i++) s.tone({ freq: 2000, dur: 0.015, wave: "square", gain, at: at + 0.04 + gap * i });
  },
  verdict: (s, at, { e }) => e.lamps?.forEach((lamp, i) => {
    if (lamp) lampTone(s, at + 0.08 * i, lamp);
  }),
};

/** Самое позднее смещение старта внутри рецепта, с: рецепт стартует не позже окна минус это смещение. */
const LATEST: Partial<Record<EventKind, number>> = {
  page: 0.05, cron: 0.06, charge: 0.1, double: 0.4, replayed: 0.2, note: 0.05, lock: 0.03, unlock: 0.02, busy: 0.1,
  silent: 0.22, cut: 0.14, crash: 0.05, restart: 0.1, takeover: 0.03, renew: 0.06, tick: 0.32, verdict: 0.08,
};
/** Длина рецепта, с: по ней курсор ставит следующий звук, чтобы звуки не наезжали. */
const SPAN: Partial<Record<EventKind, number>> = {
  page: 0.17, rewind: 0.15, card: 0.25, cron: 0.1, charge: 0.13, double: 0.52, replayed: 0.34, insert: 0.05, note: 0.13,
  lock: 0.09, unlock: 0.1, busy: 0.15, silent: 0.32, cut: 0.16, crash: 0.35, restart: 0.14, takeover: 0.15, renew: 0.11,
  lost: 0.14, tick: 0.24, verdict: 0.2,
};

type Role = "scene" | "cause" | "effect" | "hero" | "bg" | "board";
const ROLE: Record<string, Role> = {
  page: "scene", card: "scene", rewind: "scene",
  cron: "cause", silent: "cause", cut: "cause", crash: "cause", lock: "cause", unlock: "cause", restart: "cause", takeover: "cause", busy: "cause",
  charge: "effect", note: "effect",
  double: "hero", replayed: "hero", lost: "hero",
  tick: "bg", insert: "bg", renew: "bg",
  verdict: "board",
};
const ORDER: Role[] = ["scene", "cause", "effect", "hero", "board"];
/** Какая причина остаётся рядом с героем — одна, по важности; при падении пода — вся цепочка передачи замка. */
const CAUSE_RANK: EventKind[] = ["silent", "crash", "cut", "takeover", "lock", "unlock", "restart"];
const CHAIN = new Set<EventKind>(["crash", "unlock", "lock", "restart"]);
/** Сколько раз звучит вид в кадре: три будильника, три уведомления, два стука. */
const REPEAT: Partial<Record<EventKind, number>> = { cron: 3, note: 3, busy: 2 };
const RECAP = new Set<EventKind>(["charge", "double", "replayed", "crash", "silent", "cut", "takeover", "busy", "lost", "note"]);

/** События кадра, которые звучат, в порядке звучания: не больше MAX_SOUNDS; в итоге — только образы. */
export function score(w: World, replay = false): SimEvent[] {
  return cues(w, replay).map((c) => c.e);
}

function cues(w: World, replay: boolean): Cue[] {
  const count = new Map<EventKind, number>();
  const picked = w.events.filter((e) => {
    if (!RECIPES[e.kind] || (replay && !RECAP.has(e.kind))) return false;
    const n = count.get(e.kind) ?? 0;
    if (n >= (REPEAT[e.kind] ?? 1)) return false;
    count.set(e.kind, n + 1);
    return true;
  });
  const has = (k: EventKind) => picked.some((e) => e.kind === k);
  const hero = picked.some((e) => ROLE[e.kind] === "hero") || has("silent") || has("crash");
  let kept = picked;
  if (hero) {
    // Герой глушит фон и лишние причины; обычная касса не перебивает дубль, штамп и падение.
    const chain = has("crash");
    const top = CAUSE_RANK.find((k) => has(k));
    kept = picked.filter((e) => {
      const role = ROLE[e.kind];
      if (role === "bg") return false;
      if (e.kind === "charge") return false;
      if (role === "cause") return chain ? CHAIN.has(e.kind) : e.kind === top;
      return true;
    });
  }
  const board = kept.some((e) => e.kind === "verdict" && e.lamps?.some((l) => l === "red"));
  return kept
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ORDER.indexOf(ROLE[a.e.kind]) - ORDER.indexOf(ROLE[b.e.kind]) || a.i - b.i)
    .slice(0, MAX_SOUNDS)
    .map(({ e }) => ({
      e,
      compact: e.kind === "double" && board,
      pending: e.kind === "charge" && !!e.by && w.actors[e.by].atBank,
    }));
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

export function sound(out: Sound, w: World, replay = false): void {
  const k = replay ? 0.7 : 1;
  const s: Sound = {
    tone: (o) => out.tone({ ...o, gain: (o.gain ?? 0.1) * k }),
    noise: (o) => out.noise({ ...o, gain: (o.gain ?? 0.1) * k }),
    babble: (v, t, a) => out.babble({ ...v, gain: v.gain * k }, t, a),
  };
  // Курсор: каждый звук — после хвоста прошлого; не влезает — стартует не позже окна, хвост идёт дальше.
  let cursor = 0;
  for (const c of cues(w, replay)) {
    const kind = c.e.kind;
    const span = kind === "double" && c.compact ? 0.3 : SPAN[kind] ?? 0.1;
    const latest = kind === "double" && c.compact ? 0.22 : LATEST[kind] ?? 0;
    const start = kind === "verdict" ? Math.max(cursor, 0.3) : cursor;
    // Запас 5 мс: сумма смещений в плавающей точке не должна выйти за окно.
    RECIPES[kind]!(s, Math.min(start, EVENT_WINDOW - latest - 0.005), c);
    cursor += span + 0.02;
  }
  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
  else if (speakable(w.bank)) s.babble(BANK_VOICE, w.bank, BABBLE_AT);
}
