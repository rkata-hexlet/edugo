import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const deadlock: Scene<World> = {
  id: "07",
  // Обложка и финал — tech-expert (docs/reviews/07-tech-expert-arc.md): причина и два средства, без обещания «никогда».
  meta: {
    episode: 7,
    title: "Двое ждут друг друга",
    tagline: "Товара хватает обоим, а заказ Бориса падает с ошибкой. Как не дать заказам запереть друг друга?",
    outro: "Транзакция держит запертые строки до коммита, поэтому, если запираете несколько, делайте это везде в одном порядке, например по id, а повтор на 40P01 оставьте страховкой",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
