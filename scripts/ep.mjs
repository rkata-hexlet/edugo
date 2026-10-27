// Эпизод в своей папке, без переключения веток (docs/recording.md, раздел 3): ветка episode/NN-* —
// рабочая копия ../<репо>-NN (git worktree), зависимости, dev-сервер на порту 51NN, суфлёр в браузере.
// Ветка уже открыта в какой-то папке (в основной тоже) — работаем там.
//
//   npm run ep -- 02          # суфлёр: http://localhost:5102/?scene=02&record
//   npm run ep -- 02 --play   # плеер вместо суфлёра
//   npm run ep -- 02 --rm     # убрать папку эпизода (git откажет, если там незакоммиченное)
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fail = (msg) => (console.error(msg), process.exit(1));

const nn = process.argv[2];
if (!/^\d\d$/.test(nn ?? "")) fail("номер эпизода двумя цифрами: npm run ep -- 02");
const root = dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));

const local = git("branch", "--list", `episode/${nn}-*`, "--format=%(refname:short)").split("\n").filter(Boolean);
const remote = git("branch", "-r", "--list", `origin/episode/${nn}-*`, "--format=%(refname:short)")
  .split("\n").filter(Boolean).map((b) => b.replace(/^origin\//, ""));
const branches = [...new Set([...local, ...remote])];
if (branches.length !== 1) fail(branches.length ? `веток несколько: ${branches.join(", ")}` : `нет ветки episode/${nn}-*`);
const branch = branches[0];

// Папка, где ветка уже открыта: `git worktree list --porcelain` — блоки «worktree <путь> … branch refs/heads/<ветка>».
const opened = git("worktree", "list", "--porcelain").split("\n\n")
  .find((b) => b.split("\n").includes(`branch refs/heads/${branch}`))?.match(/^worktree (.+)$/m)?.[1];
const dir = opened ?? join(dirname(root), `${basename(root)}-${nn}`);

if (process.argv.includes("--rm")) {
  if (dir === root) fail(`${branch} открыта в основной папке — её не убираю`);
  if (!opened) fail(`папки эпизода ${nn} нет`);
  git("worktree", "remove", dir);
  console.log(`убрал ${dir}; ветка ${branch} осталась`);
  process.exit(0);
}

if (!opened) {
  console.log(`${branch} → ${dir}`);
  git("worktree", "add", dir, branch); // только удалённая — git сам заведёт локальную с отслеживанием
}
if (!existsSync(join(dir, "node_modules"))) execFileSync("npm", ["ci"], { cwd: dir, stdio: "inherit" });

const port = String(5100 + Number(nn));
const page = `/?scene=${nn}${process.argv.includes("--play") ? "" : "&record"}`;
console.log(`${branch} в ${dir}\nhttp://localhost:${port}${page}\nдубли коммитить там же: voice/${nn}/, public/voice/${nn}/`);
spawn(join(dir, "node_modules/.bin/vite"), ["--port", port, "--strictPort", "--open", page], { cwd: dir, stdio: "inherit" })
  .on("exit", (code) => process.exit(code ?? 0));
