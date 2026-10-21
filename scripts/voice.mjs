// Дубли живого диктора: сырая запись суфлёра (voice/<сцена>/<ключ>.webm) → чистый голос для плеера
// и рендера (public/voice/<сцена>/<ключ>.ogg) + справочник длительностей takes.json.
// Обработку зовёт dev-сервер при каждом дубле (vite.config.ts); после смены фильтров — заново все:
//
//   npm run voice [-- --scene 01]
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// Начало и конец дубля — щелчки пробела: срезать, затем тишину по краям (с запасом на вдох и
// затухание), фон и гул ниже голоса, громкость — к норме речи в роликах.
const SILENCE = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08";
const FILTER = [
  "atrim=start=0.2", "areverse", "atrim=start=0.2", "areverse",
  "highpass=f=80", "afftdn=nf=-30",
  SILENCE, "areverse", SILENCE, "areverse",
  "loudnorm=I=-16:TP=-1.5:LRA=11", "aresample=48000",
].join(",");

export const rawPath = (scene, key) => `voice/${scene}/${key}.webm`;
/** Отвергнутый дубль: хранится для разбора, но не заменяет прежний и не попадает в обработку. */
const rejectedPath = (scene, key) => `voice/${scene}/${key}.rejected.webm`;
const outDir = (scene) => `public/voice/${scene}`;
/** Принятый дубль — `<ключ>.webm`; `.new` (обработка прервалась) и `.rejected` — не в счёт. */
const isTake = (f) => /^[^.]+\.webm$/.test(f);

/**
 * Обработать сырой дубль `raw` во временный файл и проверить; файл плеера (`<ключ>.ogg`) заменяется
 * только прошедшим проверку дублем. Возвращает длительность, мс.
 */
async function process(scene, key, raw = rawPath(scene, key)) {
  mkdirSync(outDir(scene), { recursive: true });
  const out = `${outDir(scene)}/${key}.ogg`;
  const tmp = `${out}.tmp.ogg`;
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", FILTER, "-ac", "1", "-c:a", "libopus", "-b:a", "96k", tmp]);
    const ms = await duration(tmp).catch(() => 0); // пустой выход — тоже «не слышен»
    // Голос занимает почти всю запись; осталась доля — микрофон не услышал (21.10: кадр 40, 0.5 с из 18).
    if (!(ms >= 300) || ms < (await duration(raw)) * 0.3) throw new Error("голос почти не слышен — проверьте микрофон");
    renameSync(tmp, out);
    return ms;
  } finally {
    rmSync(tmp, { force: true });
  }
}

async function duration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Math.round(Number(stdout) * 1000);
}

const index = (scene) => `${outDir(scene)}/takes.json`;
const readIndex = (scene) => (existsSync(index(scene)) ? JSON.parse(readFileSync(index(scene), "utf8")) : {});
const writeIndex = (scene, takes) =>
  writeFileSync(index(scene), JSON.stringify(Object.fromEntries(Object.entries(takes).sort()), null, 1) + "\n");

// Дубли идут подряд, обработка — по очереди: справочник пишется без гонки.
let queue = Promise.resolve();

/** Сохранить сырой дубль и обработать; возвращает длительность, мс. */
export function saveTake(scene, key, raw) {
  const job = queue.then(async () => {
    mkdirSync(`voice/${scene}`, { recursive: true });
    // Новый дубль лежит рядом, пока не пройдёт проверку: отвергнутый не затирает прежний удачный.
    const fresh = `voice/${scene}/${key}.new.webm`;
    writeFileSync(fresh, raw);
    let ms;
    try {
      ms = await process(scene, key, fresh);
    } catch (e) {
      renameSync(fresh, rejectedPath(scene, key));
      throw e;
    }
    renameSync(fresh, rawPath(scene, key));
    rmSync(rejectedPath(scene, key), { force: true });
    const takes = readIndex(scene);
    takes[key] = ms;
    writeIndex(scene, takes);
    return ms;
  });
  queue = job.catch(() => {});
  return job;
}

if (import.meta.url === `file://${globalThis.process.argv[1]}`) {
  const i = globalThis.process.argv.indexOf("--scene");
  const scenes = i > 0 ? [globalThis.process.argv[i + 1]] : existsSync("voice") ? readdirSync("voice") : [];
  for (const scene of scenes) {
    const keys = readdirSync(`voice/${scene}`).filter(isTake).map((f) => f.slice(0, -5));
    const before = readIndex(scene);
    const takes = {};
    const failed = [];
    for (const key of keys) {
      try {
        takes[key] = await process(scene, key);
      } catch (e) {
        // Не прошёл проверку с новыми фильтрами — остаётся прежний файл плеера и его длина.
        if (key in before && existsSync(`${outDir(scene)}/${key}.ogg`)) takes[key] = before[key];
        failed.push(`${key}: ${e.message}`);
      }
    }
    // Обработанные дубли без сырых — мусор прошлых правок.
    for (const f of readdirSync(outDir(scene))) if (f.endsWith(".ogg") && !(f.slice(0, -4) in takes)) rmSync(`${outDir(scene)}/${f}`);
    writeIndex(scene, takes);
    console.log(`сцена ${scene}: ${keys.length - failed.length} из ${keys.length} дублей обработаны`);
    for (const f of failed) console.error(`  не обработан ${f}`);
    if (failed.length) globalThis.process.exitCode = 1;
  }
}
