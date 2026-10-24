import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const writeSkew: Scene<World> = {
  id: "06",
  // Обложка и финал — tech-expert (docs/reviews/06-tech-expert-arc.md), обещание выполнимо: причина и два решения.
  meta: {
    episode: 6,
    title: "Курьер и четыре коробки",
    tagline: "Мест в слоте три, а заказов четыре. Как не перегрузить курьера?",
    outro: "Если правило держится на подсчёте разных строк, ни READ COMMITTED, ни REPEATABLE READ его не защитят. Сведите правило в одну строку с условием в UPDATE, а если не выходит, берите SERIALIZABLE и повторяйте транзакцию",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
