import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const leader: Scene<World> = {
  id: "09",
  // Обложка и финал — tech-expert и scriptwriter (docs/reviews/09-*): обещание без «ровно один раз».
  meta: {
    episode: 9,
    title: "Три пода, одно списание",
    tagline: "Как ночная задача на трёх подах спишет абонентку один раз",
    outro: "Замок даёт одного исполнителя почти всегда, а одно списание — только проверка у получателя",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
