// Эпизод в этой папке (docs/recording.md, раздел 3): переключиться на ветку episode/NN-*, dev-сервер, суфлёр в браузере.
// Папок-копий (git worktree) не заводим: над эпизодами не работаем параллельно (решение пользователя 31.10).
//
//   npm run ep -- 02          # суфлёр: http://localhost:5173/?scene=02&record
//   npm run ep -- 02 --play   # плеер вместо суфлёра
import { execFileSync, spawn } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fail = (msg) => (console.error(msg), process.exit(1));

const nn = process.argv[2];
if (!/^\d\d$/.test(nn ?? "")) fail("номер эпизода двумя цифрами: npm run ep -- 02");

const local = git("branch", "--list", `episode/${nn}-*`, "--format=%(refname:short)").split("\n").filter(Boolean);
const remote = git("branch", "-r", "--list", `origin/episode/${nn}-*`, "--format=%(refname:short)")
  .split("\n").filter(Boolean).map((b) => b.replace(/^origin\//, ""));
const branches = [...new Set([...local, ...remote])];
if (branches.length !== 1) fail(branches.length ? `веток несколько: ${branches.join(", ")}` : `нет ветки episode/${nn}-*`);
const branch = branches[0];

if (git("branch", "--show-current") !== branch) {
  // Незакоммиченное переехало бы в чужую ветку — сначала коммит.
  const dirty = git("status", "--porcelain", "--untracked-files=no");
  if (dirty) fail(`незакоммиченные правки — сначала коммит, потом переключение на ${branch}:\n${dirty}`);
  git("switch", branch); // только удалённая — git сам заведёт локальную с отслеживанием
  console.log(`переключился на ${branch}`);
}

const page = `/?scene=${nn}${process.argv.includes("--play") ? "" : "&record"}`;
console.log(`${branch}\nдубли коммитить в эту ветку: voice/${nn}/, public/voice/${nn}/`);
spawn("node_modules/.bin/vite", ["--open", page], { stdio: "inherit" })
  .on("exit", (code) => process.exit(code ?? 0));
