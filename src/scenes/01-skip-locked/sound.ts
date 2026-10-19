import type { Sound, Voice } from "../../engine/contract";
import { syllables } from "../../engine/audio";
import { ACTORS, type ActorId, type EventKind, type Lamp, type SimEvent, type World } from "./sim";

// Озвучка эпизода по карте sound-designer (v5, под анимацию этапа 6): одно событие модели — один
// узнаваемый звук. Звуки событий — в окне 0–0.45 с, в такт эффектам кадра (пик за 20–40 мс до
// визуального удара); с 0.5 с говорит диктор — дальше только бормотание реплик, тихо.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинают бормотать персонажи — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;

const VOICES: Record<ActorId | "db" | "mail", Voice> = {
  A: { wave: "triangle", pitch: 392, rate: 11, spread: 3, gain: 0.08 },
  B: { wave: "square", pitch: 233, rate: 9, spread: 5, gain: 0.06 },
  C: { wave: "sine", pitch: 523, rate: 13, spread: 2, gain: 0.08 },
  db: { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 },
  mail: { wave: "triangle", pitch: 440, rate: 10, spread: 7, gain: 0.08 },
};

type Recipe = (s: Sound, at: number, e: SimEvent) => void;

const lock = (s: Sound, at: number, k = 1) => {
  s.noise({ dur: 0.03, freq: 3000, q: 8, gain: 0.14 * k, at: at + 0.04 });
  s.tone({ freq: 900, to: 600, dur: 0.05, wave: "square", gain: 0.08 * k, at: at + 0.05 });
};

/** Лампа табло: зелёная — «динь», жёлтая — мягкий тон, красная — глухой «бум». */
const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  // Свежий стол: лесенка тиков в такт каскаду строк (по 30 мс).
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  // Перемотка: отмотка назад и удар штампа в пике fx-stamp.
  rewind: (s, at) => {
    s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.08, at });
    s.noise({ dur: 0.05, freq: 250, q: 1, gain: 0.14, at: at + 0.15 });
    s.tone({ freq: 110, to: 60, dur: 0.1, gain: 0.14, at: at + 0.15 });
  },
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  lock: (s, at) => lock(s, at),
  relock: (s, at) => lock(s, at, 0.5),
  skip: (s, at) => {
    s.noise({ dur: 0.1, freq: 1500, q: 2, gain: 0.07, at: at + 0.05 });
    s.tone({ freq: 600, to: 900, dur: 0.07, gain: 0.07, at: at + 0.08 });
  },
  // COMMIT: глухой «пум» в пике кивка слона.
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.16, at: at + 0.1 });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.16, at: at + 0.1 });
  },
  one: (s, at) => s.tone({ freq: 1047, dur: 0.1, gain: 0.09, at: at + 0.1 }),
  zero: (s, at) => {
    s.tone({ freq: 294, to: 277, dur: 0.15, wave: "triangle", gain: 0.14, at: at + 0.05 });
    s.tone({ freq: 277, to: 220, dur: 0.2, wave: "triangle", gain: 0.14, at: at + 0.2 });
  },
  wait: (s, at) => {
    s.tone({ freq: 1200, dur: 0.03, wave: "square", gain: 0.035, at: at + 0.1 });
    s.tone({ freq: 1200, dur: 0.03, wave: "square", gain: 0.035, at: at + 0.35 });
  },
  wake: (s, at) => s.tone({ freq: 500, to: 1000, dur: 0.1, wave: "triangle", gain: 0.11, at: at + 0.05 }),
  unfreeze: (s, at, e) => {
    s.tone({ freq: 200, to: 700, dur: 0.18, wave: "triangle", gain: 0.12, at: at + 0.05 });
    if (e.by === "B") s.noise({ dur: 0.06, freq: 400, q: 1, gain: 0.05, at: at + 0.25 }); // «кхм» зомби
  },
  race: (s, at) => {
    s.tone({ freq: 880, dur: 0.08, gain: 0.05, at: at + 0.1 });
    s.tone({ freq: 1245, dur: 0.08, gain: 0.05, at: at + 0.1 });
  },
  ghost: (s, at) => s.noise({ dur: 0.08, freq: 3500, q: 3, gain: 0.05, at: at + 0.1 }),
  ticket: (s, at) => {
    s.noise({ dur: 0.1, freq: 2500, q: 1.5, gain: 0.09, at: at + 0.04 });
    s.tone({ freq: 1568, dur: 0.05, wave: "square", gain: 0.06, at: at + 0.1 });
  },
  // «?» у пода: интонация вопроса вверх, без разрешения.
  doubt: (s, at) => s.tone({ freq: 520, to: 700, dur: 0.18, gain: 0.07, at: at + 0.1 }),
  // Отказ по чужому токену: строгое «нет» (база уберегла запись), не комичное «уу» провала.
  clash: (s, at) => {
    s.tone({ freq: 330, dur: 0.08, wave: "square", gain: 0.1, at: at + 0.05 });
    s.tone({ freq: 247, dur: 0.14, wave: "square", gain: 0.1, at: at + 0.14 });
  },
  freeze: (s, at) => s.tone({ freq: 425, to: 300, dur: 0.3, gain: 0.07, at: at + 0.05 }),
  // Под упал: глухой удар и обрыв — без тона «ошибки», это не баг, а жизнь.
  crash: (s, at) => {
    s.noise({ dur: 0.2, freq: 150, q: 0.7, gain: 0.2, at: at + 0.02 });
    s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.08, at: at + 0.05 });
  },
  // Срок вышел — «просто значение в колонке»: тихое «фшш» без драмы.
  expire: (s, at) => {
    s.noise({ dur: 0.3, freq: 800, q: 0.7, gain: 0.07, at: at + 0.1 });
    s.tone({ freq: 600, to: 300, dur: 0.3, gain: 0.05, at: at + 0.1 });
  },
  send: (s, at) => {
    s.tone({ freq: 1319, dur: 0.15, gain: 0.12, at: at + 0.05 });
    s.tone({ freq: 1047, dur: 0.2, gain: 0.12, at: at + 0.2 });
  },
  // Повтор с ключом: короткий «дзинь» и мягкое подтверждение «уже отправлено».
  replay: (s, at) => {
    s.tone({ freq: 1319, dur: 0.12, gain: 0.09, at: at + 0.05 });
    s.tone({ freq: 660, dur: 0.08, wave: "triangle", gain: 0.1, at: at + 0.2 });
    s.tone({ freq: 880, dur: 0.12, wave: "triangle", gain: 0.1, at: at + 0.3 });
  },
  // Главный комичный провал: «бзз-бзз» и стон вниз.
  duplicate: (s, at) => {
    s.tone({ freq: 220, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.05 });
    s.tone({ freq: 220, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.2 });
    s.tone({ freq: 180, to: 110, dur: 0.12, wave: "sawtooth", gain: 0.09, at: at + 0.32 });
  },
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

/** Сколько повторов одного события озвучивать и с каким шагом: несколько подов — не каша под диктором. */
const REPEAT: Partial<Record<EventKind, { max: number; step: number }>> = {
  lock: { max: 2, step: 0.1 }, relock: { max: 2, step: 0.1 }, skip: { max: 3, step: 0.1 },
  commit: { max: 2, step: 0.12 }, zero: { max: 2, step: 0.2 }, send: { max: 3, step: 0.1 }, // хук — «три письма»
};

/**
 * Порядок и сдвиг внутри окна: смена сцены и перемотка — сразу, действие — следом, последствия
 * (письмо, дубль, оценка табло) — к концу окна, как и в анимации.
 */
const SLOT: Partial<Record<EventKind, number>> = {
  page: 0, rewind: 0, card: 0, clock: 0, ghost: 0, doubt: 0,
  lock: 0, relock: 0, skip: 0, wait: 0, wake: 0, unfreeze: 0, ticket: 0.08, clash: 0,
  commit: 0, one: 0, zero: 0.05, race: 0, freeze: 0, crash: 0, expire: 0,
  send: 0, replay: 0, duplicate: 0, verdict: 0.2,
};

function clockTicks(s: Sound, dt: number): void {
  if (dt >= 60) {
    // Скачок часов (+ fx-pulse): быстрая «перемотка вперёд».
    s.noise({ dur: 0.15, freq: 2000, q: 0.5, gain: 0.05, at: 0 });
    s.noise({ dur: 0.15, freq: 3500, q: 0.5, gain: 0.05, at: 0.15 });
    for (let i = 0; i < 8; i++) s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.035, at: 0.04 * i });
    return;
  }
  const n = Math.min(Math.max(dt, 1), 2);
  for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: 0.02, wave: "square", gain: 0.04, at: 0.05 + i * 0.1 });
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

export function sound(s: Sound, w: World): void {
  const byKind = new Map<EventKind, SimEvent[]>();
  for (const e of w.events) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  // Звук письма заменяет штамп done; при провале и перемотке часы не тикают — не перебиваем главное.
  const letters = (byKind.get("send")?.length ?? 0) + (byKind.get("replay")?.length ?? 0);
  const commits = byKind.get("commit") ?? [];
  if (letters) byKind.set("commit", commits.slice(0, Math.max(0, commits.length - letters)));
  if (["duplicate", "zero", "replay", "rewind", "verdict"].some((k) => byKind.has(k as EventKind))) byKind.delete("clock");
  // Письмо уходит после действия: дубль и повтор — следом за ним.
  const afterSend = byKind.has("send") || byKind.has("replay") ? 0.08 : 0;

  for (const [kind, events] of byKind) {
    if (kind === "clock") {
      clockTicks(s, events.reduce((sum, e) => sum + (e.n ?? 0), 0));
      continue;
    }
    const recipe = RECIPES[kind];
    if (!recipe || events.length === 0) continue;
    const rep = REPEAT[kind] ?? { max: 1, step: 0 };
    const base = (SLOT[kind] ?? 0) + (kind === "duplicate" ? afterSend : 0);
    events.slice(0, rep.max).forEach((e, i) => recipe(s, base + i * rep.step, e));
  }

  // Реплики: поды, кладовщик, Почта — по очереди, под диктором и тихо.
  const lines: [Voice, string][] = [];
  for (const id of ACTORS) {
    const a = w.actors[id];
    if (a.present && speakable(a.say)) lines.push([VOICES[id], a.say]);
  }
  if (speakable(w.db)) lines.push([VOICES.db, w.db]);
  if (speakable(w.mail)) lines.push([VOICES.mail, w.mail]);
  let at = BABBLE_AT;
  for (const [voice, text] of lines) {
    s.babble(voice, text, at);
    at += syllables(voice, text).length / voice.rate + 0.15;
  }
}
