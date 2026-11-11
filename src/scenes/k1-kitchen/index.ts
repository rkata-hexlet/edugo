import type { Scene } from "../../engine/contract";
import { OUTRO, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

// «Внутренняя кухня» — закулисье incident-lab, не урок серии: нумерации серии не занимает (номер 0 на обложке).
export const kitchen: Scene<World> = {
  id: "k1",
  meta: {
    episode: 0,
    title: "Внутренняя кухня: письма опаздывают",
    tagline: "Как снимали один сюжет тренажёра — дубли, срывы и каскадёр",
    outro: OUTRO,
  },
  steps: buildSteps,
  render,
  sound,
};
