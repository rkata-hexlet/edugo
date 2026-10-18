import type { Scene } from "../../engine/contract";
import { PRONOUNCE, buildSteps } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

export const skipLocked: Scene<World> = {
  id: "01",
  title: "01 · Три пода и одна задача",
  steps: buildSteps,
  render,
  sound,
  pronounce: PRONOUNCE,
};
