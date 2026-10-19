import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const skipLocked: Scene<World> = {
  id: "01",
  // Тексты обложки и финала — scriptwriter → tech-writer → tech-expert (18.10), разбор — в сценарии.
  meta: {
    episode: 1,
    title: "Очередь задач на Postgres",
    tagline: "Как несколько подов делят одну очередь: без дублей, без простоев и без зависших задач",
    outro: "База бережёт своё состояние, а повторные письма отсекает получатель по ключу идемпотентности",
  },
  steps: buildSteps,
  render,
  sound,
  pronounce: PRONOUNCE,
};
