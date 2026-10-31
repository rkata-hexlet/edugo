import { defineConfig } from "vitest/config";

// Потолок кучи воркера: бесконечный цикл в симуляции падает с heap OOM за секунды,
// а не съедает память машины (18.10: vitest дорос до 5.7 ГБ, ноутбук завис).
// Без кэша модулей на диске: он переживает git checkout, и import.meta.glob отдавал список сцен чужой ветки
// (31.10: общий тест начала эпизода видел в ветке 07 только сцены master).
export default defineConfig({
  test: { execArgv: ["--max-old-space-size=512"], experimental: { fsModuleCache: false } },
});
