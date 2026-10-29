import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const saga: Scene<World> = {
  id: "12",
  // Тексты обложки и финала — черновик MVP (scriptwriter, раскадровка v1); цепочка текстов — в фазе 2.
  meta: {
    episode: 12,
    title: "Сага и компенсации",
    tagline: "Деньги ушли, номера нет. Как довести бронь до конца, если одной транзакции на всех не бывает?",
    outro: "Не откат, а новый шаг: сага доделывает или исправляет",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
