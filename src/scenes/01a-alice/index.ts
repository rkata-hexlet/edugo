import type { Scene } from "../../engine/contract";
import type { World } from "../01-skip-locked/sim";
import { sound } from "../01-skip-locked/sound";
import { PRONOUNCE, buildSteps } from "./script";
import { render } from "./view";

// Эксперимент: кейс 2 эпизода 01 в мире «Алисы» (docs/episodes/01a-alice.md). Звук — словарь
// эпизода 01: события модели те же.
export const alice: Scene<World> = {
  id: "01a",
  meta: {
    episode: 1,
    title: "Розы для Королевы",
    tagline: "Кейс 2 эпизода 01 в саду Червонной Королевы: заснувший садовник, бирка со сроком и номер на розе",
    outro: "Медленного не отличить от упавшего: повтор неизбежен, а дубль отсекает получатель",
  },
  steps: buildSteps,
  render,
  sound,
  pronounce: PRONOUNCE,
};
