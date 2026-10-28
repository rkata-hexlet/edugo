import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const replica: Scene<World> = {
  id: "11",
  // Тексты обложки и финала — черновик MVP (scriptwriter, раскадровка v1); цепочка текстов — в фазе 2.
  meta: {
    episode: 11,
    title: "Где моя бронь?",
    tagline: "Реплика отстаёт на пару секунд, и гость бронирует номер дважды. Как показать гостю его собственную бронь?",
    outro: "Реплика отвечает из прошлого, поэтому спрашивай у неё только то, что не страшно увидеть с опозданием",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
