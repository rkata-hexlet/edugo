import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const cache: Scene<World> = {
  id: "02",
  // Тексты обложки и финала — scriptwriter → tech-writer → tech-expert (21.10), разбор — в сценарии.
  meta: {
    episode: 2,
    title: "Кэш перед базой",
    tagline: "Как разгрузить базу, пережить горячий ключ и не врать дольше, чем решили",
    outro: "Кэш — это копия: после записи в базу мы сбрасываем ключ, а срок жизни ограничивает, как долго мы готовы врать",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
