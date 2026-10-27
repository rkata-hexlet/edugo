import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Озвучка эпизода по карте sound-designer (21.10): Redis — коротко, сухо и высоко (память быстрая),
// Postgres — низко и тяжелее, результат для посетителя — «динь» (верный адрес) или «бзз» (старый → 404).
// Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только бормотание реплик, тихо.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинает бормотать Postgres — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

type Recipe = (s: Sound, at: number, e: SimEvent, i: number) => void;

/** Лампа табло: зелёная — «динь», жёлтая — мягкий тон, красная — глухой «бум» (как в эпизоде 01). */
const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

/** Тонет узел Redis — «бульк» выше и короче гула базы, чтобы кластер не звучал как Postgres. */
const drown: Recipe = (s, at) => {
  [0.05, 0.17, 0.29].forEach((dt) => s.tone({ freq: 520, to: 260, dur: 0.08, gain: 0.07, at: at + dt }));
  s.noise({ dur: 0.3, freq: 900, q: 2, gain: 0.03, at: at + 0.05 });
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
  // Поток кликов: тихий «дождь» один раз, а не треск на каждый клик.
  flood: (s, at) => {
    s.noise({ dur: 0.4, freq: 2500, q: 0.5, gain: 0.03, at: at + 0.02 });
    for (let i = 0; i < 5; i++) s.tone({ freq: 1800, dur: 0.012, wave: "square", gain: 0.025, at: at + 0.05 + 0.07 * i });
  },
  hit: (s, at) => s.tone({ freq: 900, to: 1400, dur: 0.04, wave: "square", gain: 0.07, at }),
  miss: (s, at) => {
    s.tone({ freq: 330, to: 200, dur: 0.07, wave: "triangle", gain: 0.1, at });
    s.noise({ dur: 0.03, freq: 500, q: 1, gain: 0.05, at });
  },
  // Чтение строки — ниже и тише COMMIT: не путать чтение с записью.
  select: (s, at) => {
    s.tone({ freq: 160, to: 90, dur: 0.09, gain: 0.1, at });
    s.noise({ dur: 0.05, freq: 300, q: 1, gain: 0.07, at });
  },
  set: (s, at) => {
    s.tone({ freq: 1200, dur: 0.03, wave: "square", gain: 0.08, at });
    s.tone({ freq: 1600, dur: 0.03, wave: "square", gain: 0.07, at: at + 0.04 });
  },
  del: (s, at) => {
    s.noise({ dur: 0.08, freq: 1200, q: 1, gain: 0.07, at });
    s.tone({ freq: 900, to: 400, dur: 0.08, wave: "triangle", gain: 0.07, at });
  },
  del0: (s, at) => {
    s.noise({ dur: 0.08, freq: 1200, q: 1, gain: 0.035, at });
    s.tone({ freq: 400, dur: 0.03, gain: 0.03, at: at + 0.1 });
  },
  // Правка без COMMIT в кадре — мягкий тон; с COMMIT звучит только он.
  update: (s, at) => s.tone({ freq: 500, dur: 0.04, wave: "triangle", gain: 0.05, at }),
  commit: (s, at) => {
    s.noise({ dur: 0.06, freq: 200, q: 1, gain: 0.16, at: at + 0.1 });
    s.tone({ freq: 120, to: 60, dur: 0.1, gain: 0.16, at: at + 0.1 });
  },
  ok: (s, at) => s.tone({ freq: 1047, to: 1319, dur: 0.08, gain: 0.08, at }),
  // Главный провал эпизода: «бзз-бзз» и стон вниз; повторный — только первый «бзз».
  stale: (s, at, _e, i) => {
    if (i > 0) return void s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.08, at });
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at });
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.13 });
    s.tone({ freq: 170, to: 100, dur: 0.12, wave: "sawtooth", gain: 0.09, at: Math.min(at + 0.25, EVENT_WINDOW) });
  },
  overload: (s, at) => {
    s.tone({ freq: 90, to: 130, dur: 0.4, wave: "sawtooth", gain: 0.1, at: at + 0.02 });
    s.noise({ dur: 0.4, freq: 200, q: 1.5, gain: 0.06, at: at + 0.02 });
  },
  calm: (s, at) => {
    s.tone({ freq: 130, to: 70, dur: 0.25, wave: "sawtooth", gain: 0.06, at: at + 0.02 });
    s.tone({ freq: 660, to: 880, dur: 0.12, wave: "triangle", gain: 0.08, at: at + 0.2 });
  },
  expire: (s, at) => {
    s.noise({ dur: 0.3, freq: 800, q: 0.7, gain: 0.07, at: at + 0.1 });
    s.tone({ freq: 600, to: 300, dur: 0.3, gain: 0.05, at: at + 0.1 });
  },
  l1hit: (s, at) => s.tone({ freq: 1300, to: 1800, dur: 0.03, wave: "square", gain: 0.05, at }),
  l1expire: (s, at) => {
    s.noise({ dur: 0.15, freq: 1500, q: 0.7, gain: 0.05, at: at + 0.1 });
    s.tone({ freq: 900, to: 500, dur: 0.15, gain: 0.04, at: at + 0.1 });
  },
  crash: (s, at) => {
    s.noise({ dur: 0.2, freq: 150, q: 0.7, gain: 0.2, at: at + 0.02 });
    s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.08, at: at + 0.05 });
  },
  reshard: (s, at) => {
    s.tone({ freq: 500, to: 900, dur: 0.15, wave: "triangle", gain: 0.08, at: at + 0.05 });
    s.tone({ freq: 1100, dur: 0.03, wave: "square", gain: 0.06, at: at + 0.22 });
    s.tone({ freq: 700, dur: 0.03, wave: "square", gain: 0.06, at: at + 0.3 });
  },
  publish: (s, at) => {
    s.tone({ freq: 1568, dur: 0.1, gain: 0.08, at: at + 0.02 });
    s.tone({ freq: 1568, to: 2000, dur: 0.12, gain: 0.05, at: at + 0.1 });
  },
  drop: (s, at) => {
    s.noise({ dur: 0.04, freq: 1800, q: 1, gain: 0.05, at });
    s.tone({ freq: 700, to: 450, dur: 0.05, wave: "triangle", gain: 0.06, at });
  },
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lamp && lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

/** Повторы одного события в кадре: сколько озвучивать и с каким шагом. */
const REPEAT: Partial<Record<EventKind, { max: number; step: number }>> = {
  hit: { max: 3, step: 0.1 }, miss: { max: 2, step: 0.12 }, select: { max: 2, step: 0.12 }, set: { max: 2, step: 0.12 },
  ok: { max: 3, step: 0.1 }, stale: { max: 2, step: 0.12 }, l1hit: { max: 2, step: 0.1 }, drop: { max: 2, step: 0.08 },
};

/** Лесенка цепочки: промах → база → копия → ответ; смена сцены и перемотка — сразу. */
const SLOT: Partial<Record<EventKind, number>> = {
  select: 0.1, ok: 0.1, drop: 0.15, verdict: 0.2, update: 0.05,
};

function clockTicks(s: Sound, dt: number): void {
  if (dt >= 60) {
    s.noise({ dur: 0.15, freq: 2000, q: 0.5, gain: 0.05, at: 0 });
    s.noise({ dur: 0.15, freq: 3500, q: 0.5, gain: 0.05, at: 0.15 });
    for (let i = 0; i < 8; i++) s.tone({ freq: 2000, dur: 0.015, wave: "square", gain: 0.035, at: 0.04 * i });
    return;
  }
  const n = Math.min(Math.max(dt, 1), 2);
  for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: 0.02, wave: "square", gain: 0.04, at: 0.05 + i * 0.1 });
}

/** Тот же звук, громкость × k: повтор в итоге — «воспоминание», тише исходного. */
function scaled(s: Sound, k: number): Sound {
  if (k === 1) return s;
  return {
    tone: (o) => s.tone({ ...o, gain: (o.gain ?? 0.1) * k }),
    noise: (o) => s.noise({ ...o, gain: (o.gain ?? 0.1) * k }),
    babble: (v, t, at) => s.babble({ ...v, gain: v.gain * k }, t, at),
  };
}

const speakable = (text: string | null): text is string => !!text && /[\p{L}\p{N}]/u.test(text);

/** Озвучить кадр; replay — повтор в итоге: тише, без часов и тревоги, по одному звуку на событие. */
export function sound(out: Sound, w: World, replay = false): void {
  const s = scaled(out, replay ? 0.7 : 1);
  const byKind = new Map<EventKind, SimEvent[]>();
  for (const e of w.events) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  if (byKind.has("commit")) byKind.delete("update"); // правку с коммитом — одним «пум»
  const dt = (byKind.get("clock") ?? []).reduce((sum, e) => sum + (e.n ?? 0), 0);
  // Скачок часов на минуты слышен и рядом с 404: сначала прошло время, потом провал (sound-designer, фаза 2).
  const leap = dt >= 60 && !byKind.has("rewind");
  if (!leap && ["stale", "rewind", "verdict"].some((k) => byKind.has(k as EventKind))) byKind.delete("clock");
  if (byKind.has("rewind")) byKind.delete("page"); // перемотка уже звучит сменой сцены
  if (replay) for (const k of ["clock", "flood", "overload", "calm", "stale", "page"] as const) byKind.delete(k);
  const chain = byKind.has("miss") || byKind.has("select");
  // Копия в Redis раньше ответа посетителю: без промаха в кадре SET — сразу, ответ — за ним.
  const setAt = chain ? 0.2 : 0;
  const okAt = chain ? 0.3 : byKind.has("set") ? 0.15 : 0.1;
  // Верный и старый адрес в одном кадре: сначала «динь», потом «бзз», иначе провал заглушит «динь».
  // COMMIT («пум» на 0.1) и скачок часов идут раньше провала и не слипаются с ним.
  const staleAt = Math.max(
    byKind.has("ok") ? 0.3 : byKind.has("hit") || byKind.has("l1hit") ? 0.1 : 0,
    byKind.has("commit") ? 0.28 : 0,
    byKind.has("set") ? 0.15 : 0,
    leap ? 0.25 : 0,
  );
  // Порядок эпизода «сначала база, потом удаление» слышен: DEL после «пум» COMMIT.
  const delAt = byKind.has("commit") ? 0.25 : 0;
  const drowning = !!w.redis && w.redis.nodes > 1;

  for (const [kind, events] of byKind) {
    if (kind === "clock") {
      clockTicks(s, events.reduce((sum, e) => sum + (e.n ?? 0), 0));
      continue;
    }
    const recipe = kind === "overload" && drowning ? drown : RECIPES[kind];
    if (!recipe) continue;
    const rep = replay ? { max: 1, step: 0 } : (REPEAT[kind] ?? { max: 1, step: 0 });
    const base = kind === "ok" ? okAt : kind === "stale" ? staleAt : kind === "set" ? setAt : kind === "del" || kind === "del0" ? delAt : (SLOT[kind] ?? 0);
    const ss = kind === "ok" && byKind.has("verdict") ? scaled(s, 0.7) : s;
    events.slice(0, rep.max).forEach((e, i) => recipe(ss, Math.min(base + i * rep.step, EVENT_WINDOW), e, i));
  }

  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
