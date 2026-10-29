import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const keyset: Scene<World> = {
  id: "13",
  // Тексты обложки и финала — черновик MVP (scriptwriter, раскадровка v1); цепочка текстов — в фазе 2.
  meta: {
    episode: 13,
    title: "Keyset-пагинация",
    tagline: "Гость видит карточку дважды, а выгрузка за ночь не успевает. Как листать, чтобы ничего не терять и не тормозить?",
    outro: "Не отсчитывай страницы — запоминай, где остановился",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
