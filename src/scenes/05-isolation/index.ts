import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const isolation: Scene<World> = {
  id: "05",
  // Обложка и финал — вариант scriptwriter (решение пользователя 23.10), смысл сверяет tech-expert.
  meta: {
    episode: 5,
    title: "Последняя кружка",
    tagline: "Двое нажали «Купить», а заказов два. Как не продать дважды?",
    outro: "Лучше всего держать условие в самом UPDATE. А если оно не влезает в один запрос, изоляция превратит тихую потерю в громкую ошибку, и мы повторим транзакцию",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
