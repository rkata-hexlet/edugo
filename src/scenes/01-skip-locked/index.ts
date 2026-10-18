import type { Scene } from "../../engine/contract";
import { buildSteps } from "./script";
import type { World } from "./sim";
import { render } from "./view";

export const skipLocked: Scene<World> = {
  id: "01",
  title: "01 · Почтальоны и одна посылка",
  steps: buildSteps,
  render,
};
