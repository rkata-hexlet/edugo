import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const unique: Scene<World> = {
  id: "04",
  // Тексты обложки и финала — scriptwriter после tech-expert (22.10), разбор — в сценарии.
  meta: {
    episode: 4,
    title: "Сколько людей кликнули?",
    tagline: "Почему уникальные не складываются и что хранить вместо числа",
    outro: "Клики складываются, уникальные — нет. Храним не число, а маленький слепок: он весит килобайты и умеет сливаться",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
