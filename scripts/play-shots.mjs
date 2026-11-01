// Снимки конструктора в портрете (телефон 390×844): итог прогона по наборам кирпичей (`?bricks=…&end`)
// и кадр посреди прогона. Нужен `npm run dev`.
//   node scripts/play-shots.mjs [--sets ",T,TO,TOR,TORJ,OB,TOB,TORKJB"] [--out out/shots/play]
import { mkdirSync, rmSync } from "node:fs";
import puppeteer from "puppeteer-core";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const url = arg("url", "http://localhost:5173/play.html");
const out = arg("out", "out/shots/play");
const sets = arg("sets", ",T,TO,TOR,TORJ,TORKJ,OB,TOB,TORKJB").split(",");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--hide-scrollbars"],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("страница:", e.message));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(`${out}/${name}.png`);
};
for (const s of sets) {
  await page.goto(`${url}?bricks=${s}&end`, { waitUntil: "networkidle0" });
  await shot(`end-${s || "empty"}`);
}
// посреди прогона: беда B у экономного решения
await page.goto(`${url}?bricks=TOB`, { waitUntil: "networkidle0" });
await page.click(".cx-run");
await new Promise((r) => setTimeout(r, 7000));
await shot("mid-TOB");
await browser.close();
