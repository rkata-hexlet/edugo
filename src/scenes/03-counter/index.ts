import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const counter: Scene<World> = {
  id: "03",
  // Тексты обложки и финала — scriptwriter → tech-writer → tech-expert (22.10), разбор — в сценарии.
  meta: {
    episode: 3,
    title: "Счётчик кликов под нагрузкой",
    tagline: "Как выдержать поток записей, пережить деплой и не посчитать клик дважды",
    outro: "Горячей строке не нужен каждый клик, ей хватит пачки. А пачке нужен номер, чтобы повтор не посчитался дважды",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
