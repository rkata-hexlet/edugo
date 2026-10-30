import type { Sound, Voice } from "../../engine/contract";
import type { Lamp } from "../../kit/director";
import { type EventKind, type SimEvent, type World } from "./sim";

// Озвучка эпизода по карте sound-designer (docs/reviews/03-sound-designer-map.md): прибавка в строку — короткий
// «тук» COMMIT, сброс батча — тяжёлый «бум» (только запись в базу), клики — тихий «дождь», потеря и повтор — провал,
// база узнала повтор — чистый «динь». Звуки событий — в окне 0–0.45 с, с 0.5 с говорит диктор; дальше только
// бормотание реплик, тихо.

/** Окно звуков событий, с. Держит тест: дальше начинается голос диктора. */
export const EVENT_WINDOW = 0.45;
/** Когда начинает бормотать Postgres — вместе с диктором, под ним. */
export const BABBLE_AT = 0.5;

const DB_VOICE: Voice = { wave: "sawtooth", pitch: 98, rate: 6, spread: 1.5, gain: 0.09 };

/** Есть ли в кадре событие такого вида: рецепт подстраивается под соседей. */
type Has = (kind: EventKind) => boolean;
type Recipe = (s: Sound, at: number, e: SimEvent, has: Has) => void;

/** Лампа табло: зелёная — «динь», жёлтая — мягкий тон, красная — глухой «бум» (как в эпизодах 01–02). */
const lampTone = (s: Sound, at: number, lamp: Lamp) => {
  if (lamp === "green") s.tone({ freq: 1047, to: 1319, dur: 0.1, gain: 0.09, at });
  else if (lamp === "yellow") s.tone({ freq: 700, dur: 0.1, wave: "triangle", gain: 0.08, at });
  else s.tone({ freq: 220, dur: 0.12, wave: "square", gain: 0.08, at });
};

const thump = (s: Sound, at: number, gain: number) => {
  s.noise({ dur: 0.06, freq: 200, q: 1, gain, at });
  s.tone({ freq: 120, to: 60, dur: 0.1, gain, at });
};

const RECIPES: Partial<Record<EventKind, Recipe>> = {
  page: (s, at) => {
    s.noise({ dur: 0.12, freq: 1800, q: 0.6, gain: 0.03, at: at + 0.05 });
    for (let i = 0; i < 6; i++) s.tone({ freq: 700 + 60 * i, dur: 0.025, gain: 0.04, at: at + 0.06 + 0.03 * i });
  },
  // Перемотка — без «бума»: «бум» в эпизоде значит только запись в базу.
  rewind: (s, at) => s.tone({ freq: 800, to: 200, dur: 0.15, wave: "sawtooth", gain: 0.07, at }),
  card: (s, at) => s.noise({ dur: 0.25, freq: 600, q: 0.8, gain: 0.04, at }),
  flood: (s, at) => {
    s.noise({ dur: 0.4, freq: 2500, q: 0.5, gain: 0.03, at: at + 0.02 });
    for (let i = 0; i < 5; i++) s.tone({ freq: 1800, dur: 0.012, wave: "square", gain: 0.025, at: at + 0.05 + 0.07 * i });
  },
  click: (s, at) => s.tone({ freq: 1500, dur: 0.015, wave: "square", gain: 0.04, at }),
  commit: (s, at) => thump(s, at + 0.1, 0.13),
  wait: (s, at) => s.tone({ freq: 440, to: 400, dur: 0.12, wave: "triangle", gain: 0.05, at }),
  shard: (s, at) => s.tone({ freq: 1200, dur: 0.03, wave: "square", gain: 0.06, at }),
  // Строку разрезали на 16 частей: лесенка тиков вверх.
  split: (s, at) => {
    for (let i = 0; i < 8; i++) s.tone({ freq: 600 + 170 * i, dur: 0.02, wave: "square", gain: 0.05, at: at + 0.04 * i });
  },
  async: (s, at) => s.tone({ freq: 600, to: 1400, dur: 0.08, wave: "triangle", gain: 0.06, at }),
  // Гул короче, если в кадре лампы: не глушит их.
  overload: (s, at, _e, has) => {
    const dur = has("verdict") ? 0.28 : 0.4;
    s.tone({ freq: 90, to: 130, dur, wave: "sawtooth", gain: 0.1, at: at + 0.02 });
    s.noise({ dur, freq: 200, q: 1.5, gain: 0.06, at: at + 0.02 });
  },
  calm: (s, at) => {
    s.tone({ freq: 130, to: 70, dur: 0.25, wave: "sawtooth", gain: 0.06, at: at + 0.02 });
    s.tone({ freq: 660, to: 880, dur: 0.12, wave: "triangle", gain: 0.08, at: at + 0.2 });
  },
  // Сброс батча — один тяжёлый «бум» вместо тысячи «тук»; повтор, который база отвергла, — вполсилы.
  flush: (s, at, _e, has) => {
    const gain = has("skip") ? 0.09 : 0.18;
    s.noise({ dur: 0.12, freq: 160, q: 1, gain, at: at + 0.05 });
    s.tone({ freq: 90, to: 45, dur: 0.18, gain, at: at + 0.05 });
  },
  sigterm: (s, at) => {
    s.tone({ freq: 880, dur: 0.08, gain: 0.07, at });
    s.tone({ freq: 660, dur: 0.1, gain: 0.07, at: at + 0.1 });
  },
  // Под гаснет с копилкой — спад громче (и рядом рассыпание); пустым, штатно — едва слышно.
  deploy: (s, at, e) => s.tone({ freq: 400, to: 150, dur: 0.2, wave: "triangle", gain: e.n ? 0.07 : 0.04, at }),
  spawn: (s, at) => s.tone({ freq: 600, to: 900, dur: 0.06, wave: "triangle", gain: 0.06, at: at + 0.25 }),
  restart: (s, at) => s.tone({ freq: 500, to: 200, dur: 0.15, wave: "triangle", gain: 0.07, at }),
  // Накопленное рассыпалось: шорох вниз.
  spill: (s, at) => {
    s.noise({ dur: 0.25, freq: 3000, q: 0.6, gain: 0.07, at: at + 0.1 });
    s.tone({ freq: 700, to: 200, dur: 0.25, wave: "sawtooth", gain: 0.06, at: at + 0.1 });
  },
  lost: (s, at) => {
    s.tone({ freq: 1200, to: 300, dur: 0.12, wave: "sawtooth", gain: 0.08, at: at + 0.25 });
    s.noise({ dur: 0.05, freq: 900, q: 1, gain: 0.06, at: at + 0.3 });
  },
  // Главный провал кейса 2: тот же батч второй раз — «бум» и «бзз».
  dup: (s, at) => {
    thump(s, at + 0.05, 0.16);
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.2 });
    s.tone({ freq: 200, dur: 0.1, wave: "square", gain: 0.13, at: at + 0.33 });
  },
  skip: (s, at) => s.tone({ freq: 880, to: 1175, dur: 0.08, gain: 0.07, at: at + 0.15 }),
  kill: (s, at) => {
    s.noise({ dur: 0.2, freq: 150, q: 0.7, gain: 0.12, at: at + 0.02 });
    s.tone({ freq: 300, to: 60, dur: 0.3, wave: "sawtooth", gain: 0.07, at: at + 0.05 });
  },
  verdict: (s, at, e) => e.lamps?.forEach((lamp, i) => lamp && lampTone(s, at + 0.05 + 0.1 * i, lamp)),
};

/** Повторы одного события в кадре: сколько озвучивать и с каким шагом. */
const REPEAT: Partial<Record<EventKind, { max: number; step: number }>> = {
  click: { max: 3, step: 0.06 }, commit: { max: 2, step: 0.12 }, shard: { max: 3, step: 0.07 }, deploy: { max: 3, step: 0.1 },
  spill: { max: 1, step: 0 }, flush: { max: 2, step: 0.15 },
};

/** Лесенка: клик → прибавка → вердикт; смена сцены и перемотка — сразу. */
const SLOT: Partial<Record<EventKind, number>> = { commit: 0.05, verdict: 0.25, shard: 0.05 };

function clockTicks(s: Sound, dt: number): void {
  const n = Math.min(Math.max(dt, 1), 3);
  for (let i = 0; i < n; i++) s.tone({ freq: 2000, dur: 0.02, wave: "square", gain: 0.04, at: i * 0.07 });
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
  if (w.flashback) return; // кадр эпизода 01 — тишина под голос
  const s = scaled(out, replay ? 0.7 : 1);
  const byKind = new Map<EventKind, SimEvent[]>();
  for (const e of w.events) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  if (replay) for (const k of ["clock", "flood", "overload", "calm", "dup", "spill", "kill", "page"] as const) byKind.delete(k);
  if (byKind.has("dup")) byKind.delete("flush"); // повтор — одним провалом
  if (byKind.has("flush")) byKind.delete("commit"); // сброс — один «бум», без «тук»
  if (byKind.has("overload")) for (const k of ["click", "commit"] as const) byKind.delete(k); // гул перегрузки — один
  if (byKind.has("clock")) byKind.delete("click"); // тики часов не тонут в «дожде» кликов
  if (byKind.has("sigterm")) byKind.delete("rewind"); // сигнал не смазан перемоткой
  if (byKind.has("kill")) byKind.delete("spill"); // у kill своё рассыпание; потеря на деплое — слышна
  // Штатный деплой (поды пустые) — один тихий спад на кадр, не три.
  if (byKind.get("deploy")?.every((e) => !e.n)) byKind.set("deploy", byKind.get("deploy")!.slice(0, 1));
  // Рядом с бзз дубля красная лампа смазала бы его: square против square.
  const verdicts = byKind.get("verdict");
  if (verdicts && byKind.has("dup")) {
    byKind.set("verdict", verdicts.map((e) => ({ ...e, lamps: e.lamps?.map((l) => (l === "red" ? null : l)) })));
  }

  const has: Has = (k) => byKind.has(k);
  for (const [kind, events] of byKind) {
    if (kind === "clock") {
      clockTicks(s, events.reduce((sum, e) => sum + (e.n ?? 0), 0));
      continue;
    }
    const recipe = RECIPES[kind];
    if (!recipe) continue;
    // При SIGTERM — один «бум»: второй накрыл бы лампы.
    const one = replay || (kind === "flush" && byKind.has("sigterm"));
    const rep = one ? { max: 1, step: 0 } : (REPEAT[kind] ?? { max: 1, step: 0 });
    // «тик-тик-тик → бум», «сигнал → бум»: сброс после часов и SIGTERM, а не вместе с ними.
    const base = kind === "flush" && (byKind.has("clock") || byKind.has("sigterm")) ? 0.15 : (SLOT[kind] ?? 0);
    events.slice(0, rep.max).forEach((e, i) => recipe(s, Math.min(base + i * rep.step, EVENT_WINDOW), e, has));
  }

  if (speakable(w.db)) s.babble(DB_VOICE, w.db, BABBLE_AT);
}
