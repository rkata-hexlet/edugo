import { defineConfig } from "vitest/config";

// Потолок кучи воркера: бесконечный цикл в симуляции падает с heap OOM за секунды,
// а не съедает память машины (18.10: vitest дорос до 5.7 ГБ, ноутбук завис).
export default defineConfig({
  test: { execArgv: ["--max-old-space-size=512"] },
});
