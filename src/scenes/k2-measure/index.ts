import type { Scene } from "../../engine/contract";
import { OUTRO, PRONOUNCE, buildClasses, buildCycle } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

// Два наброска хода нового формата кухни: `kc` — цикл, `kk` — пять классов. Приёмка пользователем, потом один уходит.
const meta = (tagline: string) => ({ episode: 0, title: "Врёт не решение, а прибор", tagline, outro: OUTRO });

export const cycle: Scene<World> = {
  id: "kc", meta: meta("Набросок: один цикл, причины по ходу"), steps: buildCycle, render, sound, pronounce: PRONOUNCE,
};
export const classes: Scene<World> = {
  id: "kk", meta: meta("Набросок: пять причин по очереди"), steps: buildClasses, render, sound, pronounce: PRONOUNCE,
};
