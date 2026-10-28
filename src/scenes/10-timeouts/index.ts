import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const timeouts: Scene<World> = {
  id: "10",
  // Тексты обложки и финала — черновик MVP (scriptwriter, раскадровка v1); цепочка текстов — в фазе 2.
  meta: {
    episode: 10,
    title: "Таймауты и повторы",
    tagline: "Поставщик тормозит. Как не лечь вместе с ним и не добить его повторами?",
    outro: "Не дождались — не значит, что не получилось: ставим срок, повторяем с нашим номером и вразброс, а лежачего не добиваем",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
