// Снимки кадров сцены для проверки глазами и для рецензентов: headless Chrome открывает
// `?scene=NN&capture#step=N`, доводит анимации до конца и снимает 1280×720. Листы — склейка
// `montage` (ImageMagick) по 6 кадров 2×3. Нужен запущенный dev-сервер (`npm run dev`): снимаем
// текущие правки, без сборки. `--phrases` — кадр с закадром из нескольких кусков снимается по куску
// (`NN-K.png`, K с 1): так видно картинку, привязанную к фразе (`Scene.render(…, phrase)`).
//
//   npm run shots -- --scene 11 [--from 1] [--to 99] [--out out/shots/11] [--sheet] [--phrases]
//                    [--url http://localhost:5173/]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import puppeteer from "puppeteer-core";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const sceneId = arg("scene", "01");
const url = arg("url", "http://localhost:5173/");
const from = Number(arg("from", "1"));
const to = Number(arg("to", "999"));
const out = arg("out", `out/shots/${sceneId}`);
const chrome = arg("chrome", process.env.CHROME ?? "/usr/bin/google-chrome");
const pad = (n) => String(n).padStart(2, "0");
const byPhrase = process.argv.includes("--phrases");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--hide-scrollbars", "--mute-audio"],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("страница:", e.message));
const shots = [];
/** Снять кадр n (кусок закадра phrase, с нуля; без него — полная картинка); false — кадры кончились. */
const shoot = async (n, file, phrase) => {
  // Смена одного #step — переход внутри документа: плеер не перезагрузится и номер за концом не поправит.
  await page.goto("about:blank");
  const query = phrase === undefined ? "" : `&phrase=${phrase}`;
  await page.goto(`${url}?scene=${sceneId}&capture${query}#step=${n}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 400));
  // Плеер сам поправляет номер за последним кадром — значит, кадры кончились.
  if (!(await page.evaluate((n) => location.hash === `#step=${n}`, n))) return false;
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: file });
  shots.push(file);
  return true;
};
for (let n = from; n <= to; n++) {
  if (!(await shoot(n, `${out}/${pad(n)}.png`))) break;
  const count = byPhrase ? Number(await page.evaluate(() => document.querySelector("[data-phrases]")?.dataset.phrases ?? 1)) : 1;
  if (count < 2) continue;
  shots.pop(); // полная картинка — это последний кусок
  rmSync(`${out}/${pad(n)}.png`);
  for (let k = 0; k < count; k++) await shoot(n, `${out}/${pad(n)}-${k + 1}.png`, k);
}
await browser.close();
console.log(`кадров: ${shots.length} → ${out}`);

if (process.argv.includes("--sheet")) {
  for (let i = 0; i < shots.length; i += 6) {
    const part = shots.slice(i, i + 6);
    const name = (f) => f.slice(out.length + 1, -".png".length);
    const sheet = `${out}/sheet-${name(part[0])}-${name(part.at(-1))}.png`;
    execFileSync("montage", [...part, "-tile", "2x3", "-geometry", "640x360+4+4", sheet]);
    console.log(`лист: ${sheet}`);
  }
}
