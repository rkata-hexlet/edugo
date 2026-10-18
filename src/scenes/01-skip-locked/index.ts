import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const skipLocked: Scene<World> = {
  id: "01",
  // Тексты обложки — черновик из сценария; через scriptwriter → tech-writer → tech-expert на этапе 2.
  meta: {
    episode: 1,
    title: "Три пода и одна задача",
    tagline: "Несколько подов разбирают одну очередь задач в Postgres",
    outro: "База бережёт свою запись, а двойной эффект гасит приёмник",
  },
  steps: buildSteps,
  render,
  sound,
  pronounce: PRONOUNCE,
};
