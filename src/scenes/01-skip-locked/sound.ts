import type { Sound, Voice } from "../../engine/contract";
import { syllables } from "../../engine/audio";
import type { ActorId, EventKind, World } from "./sim";

// Озвучка эпизода по карте sound-designer: одно событие модели — один узнаваемый звук.
// Звуки событий — в окне ~0–0.9 с, реплики — после них, по очереди.

const VOICES: Record<ActorId | "db" | "client", Voice> = {
  A: { wave: "triangle", pitch: 392, rate: 11, spread: 3, gain: 0.14 },
  B: { wave: "square", pitch: 233, rate: 9, spread: 5, gain: 0.1 },
  C: { wave: "sine", pitch: 523, rate: 13, spread: 2, gain: 0.14 },
  B2: { wave: "square", pitch: 277, rate: 10, spread: 3, gain: 0.1 },
  db: { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.16 },
  client: { wave: "triangle", pitch: 440, rate: 10, spread: 7, gain: 0.14 },
};

type Recipe = (s: Sound, at: number, quiet?: boolean) => number; // возвращает длительность

const lock: Recipe = (s, at, quiet) => {
  const k = quiet ? 0.5 : 1;
  s.noise({ dur: 0.04, freq: 3000, q: 8, gain: 0.25 * k, at });
  s.tone({ freq: 900, to: 600, dur: 0.06, wave: "square", gain: 0.12 * k, at: at + 0.01 });
  return 0.08;
};

const stamp: Recipe = (s, at) => {
  s.noise({ dur: 0.08, freq: 200, q: 1, gain: 0.35, at });
  s.tone({ freq: 120, to: 60, dur: 0.12, wave: "sine", gain: 0.3, at });
  return 0.12;
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  lock,
  relock: (s, at) => lock(s, at, true),
  commit: stamp,
  one: (s, at) => (s.tone({ freq: 1047, dur: 0.12, gain: 0.12, at: at + 0.2 }), 0.32),
  zero: (s, at) => {
    s.tone({ freq: 294, to: 277, dur: 0.18, wave: "triangle", gain: 0.2, at });
    s.tone({ freq: 277, to: 220, dur: 0.35, wave: "triangle", gain: 0.2, at: at + 0.2 });
    return 0.55;
  },
  wait: (s, at) => {
    for (const dt of [0, 0.5, 1, 1.5]) s.tone({ freq: 1200, dur: 0.03, wave: "square", gain: 0.05, at: at + dt });
    return 0.2; // тиканье идёт фоном, реплики не ждут
  },
  wake: (s, at) => (s.tone({ freq: 500, to: 1000, dur: 0.12, wave: "triangle", gain: 0.15, at }), 0.12),
  skip: (s, at) => {
    s.noise({ dur: 0.12, freq: 1500, q: 2, gain: 0.1, at });
    s.tone({ freq: 600, to: 900, dur: 0.08, gain: 0.1, at: at + 0.05 });
    return 0.13;
  },
  race: (s, at) => {
    s.tone({ freq: 880, dur: 0.6, gain: 0.07, at });
    s.tone({ freq: 1245, dur: 0.6, gain: 0.07, at });
    return 0.6;
  },
  mutex: (s, at) => {
    s.tone({ freq: 1500, dur: 0.04, wave: "square", gain: 0.08, at });
    s.tone({ freq: 2000, dur: 0.03, wave: "square", gain: 0.06, at: at + 0.05 });
    return 0.08;
  },
  deliver: (s, at) => {
    s.tone({ freq: 1319, dur: 0.25, gain: 0.2, at });
    s.tone({ freq: 1047, dur: 0.4, gain: 0.2, at: at + 0.18 });
    return 0.58;
  },
  rejected: (s, at) => {
    RECIPES.deliver!(s, at);
    s.tone({ freq: 660, dur: 0.1, wave: "triangle", gain: 0.14, at: at + 0.6 });
    s.tone({ freq: 880, dur: 0.25, wave: "triangle", gain: 0.14, at: at + 0.72 });
    return 0.97;
  },
  duplicate: (s, at) => {
    s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.18, at });
    s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.18, at: at + 0.17 });
    s.tone({ freq: 180, to: 110, dur: 0.3, wave: "sawtooth", gain: 0.12, at: at + 0.35 });
    return 0.65;
  },
  ticket: (s, at) => {
    s.noise({ dur: 0.15, freq: 2500, q: 1.5, gain: 0.14, at });
    s.tone({ freq: 1568, dur: 0.06, wave: "square", gain: 0.08, at: at + 0.1 });
    return 0.2; // штамп даст commit следом
  },
  freeze: (s, at) => {
    s.tone({ freq: 425, dur: 0.8, gain: 0.1, at });
    s.tone({ freq: 425, dur: 0.8, gain: 0.1, at: at + 1.8 });
    return 0.8;
  },
  unfreeze: (s, at) => (s.tone({ freq: 200, to: 700, dur: 0.2, wave: "triangle", gain: 0.18, at }), 0.2),
  appear: (s, at) => (s.tone({ freq: 300, to: 600, dur: 0.08, gain: 0.14, at }), 0.08),
  expire: (s, at) => {
    // Пауза перед «фшш» — тишина работает на момент.
    s.noise({ dur: 0.4, freq: 800, q: 0.7, gain: 0.14, at: at + 0.5 });
    s.tone({ freq: 600, to: 300, dur: 0.4, gain: 0.1, at: at + 0.5 });
    return 0.9;
  },
  card: (s, at) => {
    s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.06, at });
    s.tone({ freq: 523, dur: 0.3, gain: 0.05, at: at + 0.1 });
    return 0.4;
  },
  party: (s, at) => {
    [523, 659, 784].forEach((f, i) => s.tone({ freq: f, dur: 0.1, wave: "triangle", gain: 0.12, at: at + i * 0.1 }));
    s.tone({ freq: 1047, dur: 0.4, wave: "triangle", gain: 0.12, at: at + 0.3 });
    return 0.7;
  },
  page: (s, at) => (s.noise({ dur: 0.2, freq: 2000, q: 0.5, gain: 0.05, at }), 0.2),
};

/** Сколько повторов одного события озвучивать и с каким шагом. */
const REPEAT: Partial<Record<EventKind, { max: number; step: number }>> = {
  lock: { max: 3, step: 0.12 }, relock: { max: 2, step: 0.12 }, skip: { max: 3, step: 0.15 },
  commit: { max: 3, step: 0.18 }, zero: { max: 2, step: 0.25 }, one: { max: 2, step: 0.15 },
  deliver: { max: 3, step: 0.4 }, rejected: { max: 2, step: 0.4 }, ticket: { max: 2, step: 0.3 },
};

/** Порядок звучания в кадре: сначала смена сцены и действия, последствия — после. */
const ORDER: EventKind[] = [
  "page", "clock", "unfreeze", "appear", "mutex", "lock", "skip", "wait", "relock", "wake", "ticket",
  "commit", "one", "zero", "race", "freeze", "expire", "deliver", "rejected", "duplicate", "party", "card",
];

function clockTicks(s: Sound, at: number, dt: number): number {
  if (dt >= 60) {
    for (let i = 0; i < 8; i++) s.tone({ freq: 2000, dur: 0.02, wave: "square", gain: 0.05, at: at + i * 0.05 });
    s.noise({ dur: 0.3, freq: 3000, q: 0.5, gain: 0.05, at });
    return 0.4;
  }
  const n = Math.min(Math.max(dt, 1), 4);
  for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: 0.02, wave: "square", gain: 0.05, at: at + i * 0.1 });
  return n * 0.1;
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

export function sound(s: Sound, w: World): void {
  const count = new Map<EventKind, number>();
  for (const e of w.events) count.set(e.kind, (count.get(e.kind) ?? 0) + 1);
  // Звонок у двери заменяет штамп done; при провале часы не тикают — не перебиваем главное.
  const doorbells = (count.get("deliver") ?? 0) + (count.get("rejected") ?? 0);
  if (doorbells) count.set("commit", Math.max(0, (count.get("commit") ?? 0) - doorbells));
  if (count.get("duplicate") || count.get("zero") || count.get("rejected")) count.delete("clock");

  let t = 0;
  let end = 0;
  for (const kind of ORDER) {
    const n = count.get(kind) ?? 0;
    if (n === 0) continue;
    if (kind === "clock") {
      const dt = w.events.filter((e) => e.kind === "clock").reduce((sum, e) => sum + (e.n ?? 0), 0);
      end = Math.max(end, t + clockTicks(s, t, dt));
      t += 0.1;
      continue;
    }
    const rep = REPEAT[kind] ?? { max: 1, step: 0 };
    let last = t;
    for (let i = 0; i < Math.min(n, rep.max); i++) {
      last = t + i * rep.step;
      end = Math.max(end, last + RECIPES[kind]!(s, last));
    }
    // Последствие ждёт свою причину: дубль — после звонков, остальное — с небольшим нахлёстом.
    t = kind === "deliver" || kind === "rejected" ? last + 0.45 : t + 0.05;
  }

  // Реплики: воркеры, кладовщик, клиент — по очереди, после звуков событий.
  const lines: [Voice, string][] = [];
  for (const id of ["A", "B", "C", "B2"] as const) {
    const a = w.actors[id];
    if (a.present && speakable(a.say)) lines.push([VOICES[id], a.say]);
  }
  if (speakable(w.db)) lines.push([VOICES.db, w.db]);
  if (speakable(w.client)) lines.push([VOICES.client, w.client]);
  let at = Math.max(0.35, Math.min(end, 1.2));
  for (const [voice, text] of lines) {
    s.babble(voice, text, at);
    at += syllables(voice, text).length / voice.rate + 0.15;
  }
}
