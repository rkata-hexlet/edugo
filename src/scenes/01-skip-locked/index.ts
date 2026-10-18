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
    title: "Три пода и одна задача",
    tagline: "Как сделать так, чтобы на один заказ приходило одно письмо",
    outro: "База бережёт своё состояние, а повторные письма отсекает получатель по ключу идемпотентности",
  },
  steps: buildSteps,
  render,
  sound,
  pronounce: PRONOUNCE,
};
