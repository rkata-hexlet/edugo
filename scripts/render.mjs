// Офлайн-рендер эпизода в mp4: headless Chrome снимает кадры по шкале записи (?capture&render),
// звук — WAV из OfflineAudioContext той же страницы, склейка — ffmpeg. Экран и звуковая карта не нужны.
// Голоса диктора в записи нет (Web Speech не пишется в файл) — субтитры диктора вшиты в кадр.
//
//   npm run dev        # в соседнем терминале
//   npm run render -- [--url http://localhost:5173/] [--scene 01] [--fps 30] [--size 1920x1080]
//                     [--out dist/episode-01.mp4] [--from 0] [--to <с>]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import puppeteer from "puppeteer-core";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const url = arg("url", "http://localhost:5173/");
const sceneId = arg("scene", "01");
const fps = Number(arg("fps", "30"));
const [width, height] = arg("size", "1920x1080").split("x").map(Number);
const out = arg("out", `dist/episode-${sceneId}.mp4`);
const from = Number(arg("from", "0"));
const chrome = arg("chrome", process.env.CHROME ?? "/usr/bin/google-chrome");

mkdirSync(dirname(out), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [`--window-size=${width},${height}`, "--hide-scrollbars", "--mute-audio", "--force-device-scale-factor=1"],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("страница:", e.message));
  await page.goto(`${url}?scene=${sceneId}&capture&render`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__edugo?.ready, { timeout: 30000 });
  const total = await page.evaluate(() => window.__edugo.total);
  const to = Math.min(Number(arg("to", String(total))), total);
  console.log(`длительность ${total.toFixed(1)} с, рендер ${from}–${to.toFixed(1)} с, ${fps} кадр/с, ${width}×${height}`);

  // Звук: целиком из страницы кусками (base64 через CDP), обрезка под --from/--to — в ffmpeg.
  const size = await page.evaluate(() => window.__edugo.renderAudio());
  const chunks = [];
  for (let off = 0; off < size; off += 4 << 20) {
    chunks.push(Buffer.from(await page.evaluate((o) => window.__edugo.audioChunk(o, 4 << 20), off), "base64"));
  }
  const wav = out.replace(/\.mp4$/, ".wav");
  writeFileSync(wav, Buffer.concat(chunks));

  const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-ss", String(from), "-t", String(to - from), "-i", wav,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    // Звуки событий тихие по замыслу (под диктором); без диктора — подтянуть громкость к норме роликов.
    "-af", "loudnorm=I=-18:TP=-2:LRA=11",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${code}`)))));

  const cdp = await page.createCDPSession();
  const frames = Math.round((to - from) * fps);
  const started = Date.now();
  for (let n = 0; n < frames; n++) {
    await page.evaluate((t) => window.__edugo.seek(t), from + n / fps);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    if (n % (fps * 10) === 0) {
      const rate = (n + 1) / ((Date.now() - started) / 1000);
      console.log(`${(from + n / fps).toFixed(0)} с / ${to.toFixed(0)} с  (${rate.toFixed(1)} кадр/с)`);
    }
  }
  ffmpeg.stdin.end();
  await done;
  console.log(`готово: ${out}`);
} finally {
  await browser.close();
}
