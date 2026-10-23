import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const isolation: Scene<World> = {
  id: "05",
  // Черновик MVP: тексты обложки и финала пройдут scriptwriter → tech-writer → tech-expert.
  meta: {
    episode: 5,
    title: "Уровни изоляции транзакций",
    tagline: "Как не продать последнюю кружку дважды и что меняет REPEATABLE READ",
    outro: "Условие держим в самой записи; а REPEATABLE READ не чинит данные сам — он превращает тихую потерю в ошибку, и транзакцию надо повторить",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
