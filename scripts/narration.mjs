// Выгрузка закадра эпизода одним файлом для правки пользователем (процедура — CLAUDE.md, «Процесс эпизода»):
// строка = кадр плеера с номером, по актам; сверху обложка и финал. Источник — script.ts сцены.
//
//   npm run narration -- [--scene 01-skip-locked] [--out docs/episodes/01-narration.md]
import { writeFileSync } from "node:fs";
import { createServer } from "vite";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const dir = arg("scene", "01-skip-locked");
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const mod = await vite.ssrLoadModule(`/src/scenes/${dir}/index.ts`);
  const scene = Object.values(mod).find((v) => v && typeof v === "object" && "steps" in v);
  const out = arg("out", `docs/episodes/${scene.id}-narration.md`);
  const lines = [
    `# Эпизод ${scene.id} — закадр для правки`,
    "",
    "Как править: меняй текст как хочешь, номер кадра в начале строки не трогай. Удалить кадр — стереть строку.",
    "Новый кадр — строка без номера там, где он нужен. Комментарий мне — в квадратных скобках [так].",
    "Файл выгружен из script.ts (`npm run narration`), номера — кадры плеера (`#step=N`).",
    "",
    "## Обложка и финал",
    "",
    `- Название: ${scene.meta.title}`,
    `- Подзаголовок: ${scene.meta.tagline}`,
    `- Финальная фраза: ${scene.meta.outro}`,
    "",
  ];
  let act = "";
  scene.steps().forEach((s, i) => {
    if (s.act !== act) lines.push(`## ${(act = s.act)}`, "");
    lines.push(`${i + 1}. ${s.narration ?? ""}${s.caption ? `  \n   _Подпись в кадре:_ ${s.caption}` : ""}`, "");
  });
  writeFileSync(out, lines.join("\n"));
  console.log(`готово: ${out}`);
} finally {
  await vite.close();
}
