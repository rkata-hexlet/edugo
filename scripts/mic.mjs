// Телефон как микрофон (docs/recording.md, раздел 2а): scrcpy забирает микрофон Android по USB без сжатия,
// PulseAudio делает из него виртуальный микрофон PhoneMic и ставит по умолчанию — суфлёр пишет с него.
// Ctrl+C — вернуть прежний микрофон и убрать PhoneMic.
//
//   npm run mic
//
// PULSE_SINK сборка scrcpy с GitHub не слушает: её звук уходит в колонки, телефон слышит сам себя — петля.
// Поэтому на время старта колонки без звука, поток scrcpy (по PID) переносится в PhoneSink, колонки включаются.
import { execFileSync, spawn } from "node:child_process";

const run = (cmd, ...args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const pactl = (...args) => run("pactl", ...args);
const fail = (msg) => (console.error(msg), process.exit(1));
const has = (cmd) => { try { run("which", cmd); return true; } catch { return false; } };

if (!has("scrcpy")) fail("нет scrcpy ≥ 2.0 — установка в docs/recording.md, раздел 2а");
if (!has("adb")) fail("нет adb: sudo apt install adb");
if (!/\tdevice$/m.test(run("adb", "devices"))) fail("телефона нет в `adb devices`: кабель, «Отладка по USB», разрешить на телефоне");

// Прежний микрофон; PhoneMic остался от прошлого запуска — первый настоящий вход.
const prevSource = [pactl("get-default-source"), ...pactl("list", "short", "sources").split("\n").map((l) => l.split("\t")[1])]
  .find((s) => s !== "phonemic" && !s.endsWith(".monitor"));
const sinkMuted = pactl("get-sink-mute", "@DEFAULT_SINK@").endsWith("yes");
const modules = [];
if (!pactl("list", "short", "sinks").includes("\tphone\t")) {
  modules.push(pactl("load-module", "module-null-sink", "sink_name=phone", "rate=48000",
    "sink_properties=device.description=PhoneSink"));
  modules.push(pactl("load-module", "module-remap-source", "master=phone.monitor", "source_name=phonemic",
    "source_properties=device.description=PhoneMic"));
}
pactl("set-default-source", "phonemic");

let done = false;
const cleanup = () => {
  if (done) return;
  done = true;
  pactl("set-sink-mute", "@DEFAULT_SINK@", sinkMuted ? "1" : "0");
  pactl("set-default-source", prevSource);
  for (const m of modules.reverse()) pactl("unload-module", m);
  console.log(`\nмикрофон по умолчанию снова ${prevSource}`);
};

pactl("set-sink-mute", "@DEFAULT_SINK@", "1");
// adb из системы: у scrcpy свой adb другой версии, и он перезапускает сервер adb.
const scrcpy = spawn("scrcpy", ["--no-video", "--no-control", "--no-window", "--audio-source=mic", "--audio-codec=raw"],
  { stdio: "inherit", env: { ...process.env, ADB: run("which", "adb") } });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => scrcpy.kill("SIGTERM"));
scrcpy.on("exit", (code) => (cleanup(), process.exit(code ?? 0)));

// Поток scrcpy в PulseAudio: блок sink-input с его application.process.id.
const findInput = () => pactl("list", "sink-inputs").split(/\n(?=Sink Input #)/)
  .find((b) => b.includes(`application.process.id = "${scrcpy.pid}"`))?.match(/^Sink Input #(\d+)/)?.[1];
const started = Date.now();
const timer = setInterval(() => {
  try {
    const id = findInput();
    if (id) {
      clearInterval(timer);
      pactl("move-sink-input", id, "phone");
      pactl("set-sink-mute", "@DEFAULT_SINK@", sinkMuted ? "1" : "0");
      console.log("PhoneMic готов: суфлёр пишет с телефона. Экран телефона не блокировать. Ctrl+C — вернуть микрофон");
    } else if (Date.now() - started > 15000) throw new Error("звук scrcpy не появился за 15 с");
  } catch (e) {
    // Без этого колонки остались бы без звука, а scrcpy — висеть: уборка идёт по выходу scrcpy.
    clearInterval(timer);
    console.error(e.message);
    scrcpy.kill("SIGTERM");
  }
}, 200);
