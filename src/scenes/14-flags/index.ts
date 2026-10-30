import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const flags: Scene<World> = {
  id: "14",
  // Тексты обложки и финала — черновик MVP (scriptwriter, раскадровка v0); цепочка текстов — в фазе 2.
  meta: {
    episode: 14,
    title: "Фичефлаги",
    tagline: "Выключили флаг, а стало хуже. Почему выключатель не возвращает всё как было?",
    outro: "Выключатель не откатывает данные: сначала научи читать, потом включай запись",
  },
  steps: buildSteps,
  render,
  sound: (s, w) => sound(s, w, w.replay),
  pronounce: PRONOUNCE,
};
