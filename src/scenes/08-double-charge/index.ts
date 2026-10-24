import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const doubleCharge: Scene<World> = {
  id: "08",
  // Обложка и финал — tech-expert и scriptwriter (docs/reviews/08-*): обещание — для повтора того же запроса.
  meta: {
    episode: 8,
    title: "Двойное списание",
    tagline: "Как повторить оплату после обрыва связи и не списать деньги дважды",
    outro: "Повторять оплату безопасно, когда ключ доходит до банка, а ответ на него помнят",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
