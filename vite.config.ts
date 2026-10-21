import { createReadStream, existsSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error — скрипт на JS, без типов
import { saveTake } from "./scripts/voice.mjs";

/**
 * Дубли диктора в dev: приём записи суфлёра (`?record`) — POST /__voice/<сцена>/<ключ>, тело — webm;
 * раздача /voice/… прямо с диска — public/ dev-сервер помнит на момент старта, новых дублей не увидит.
 */
const voice = (): Plugin => ({
  name: "edugo-voice",
  configureServer(server) {
    server.middlewares.use("/voice", (req, res, next) => {
      const m = /^\/(\w+)\/(takes\.json|[0-9a-f]{8}\.ogg)(\?.*)?$/.exec(req.url ?? "");
      const file = m && `public/voice/${m[1]}/${m[2]}`;
      if (!file || !existsSync(file)) return next();
      res.setHeader("content-type", file.endsWith(".ogg") ? "audio/ogg" : "application/json");
      res.setHeader("cache-control", "no-store"); // перезаписанный дубль — сразу новый
      createReadStream(file).pipe(res);
    });
    server.middlewares.use("/__voice", (req, res) => {
      const m = /^\/(\w+)\/([0-9a-f]{8})$/.exec(req.url ?? "");
      if (req.method !== "POST" || !m) return void ((res.statusCode = 404), res.end());
      const body: Buffer[] = [];
      req.on("data", (c: Buffer) => body.push(c));
      req.on("end", () => {
        saveTake(m[1], m[2], Buffer.concat(body)).then(
          (ms: number) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify({ ms }))),
          (e: Error) => ((res.statusCode = 500), res.end(e.message)),
        );
      });
    });
  },
});

export default defineConfig({
  plugins: [voice()],
  // Новый дубль — не повод перезагружать страницу суфлёра.
  server: { watch: { ignored: ["**/voice/**", "**/public/voice/**"] } },
});
