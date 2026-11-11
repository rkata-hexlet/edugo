import type { Scene } from "../../engine/contract";
import { OUTRO, PRONOUNCE, buildClasses } from "./script";
import type { World } from "./sim";
import { sound } from "./sound";
import { render } from "./view";

// Набросок хода нового формата кухни: четыре причины по очереди (только недетерминированные), в главе «нагрузка не та» — круг настоящей задачи
// (решение пользователя 11.11: «берём kk, из kc круг внутри главы»).
export const classes: Scene<World> = {
  id: "kk",
  meta: { episode: 0, title: "Почему верная починка не проходит с первого раза", tagline: "Четыре причины, почему измерение врёт", outro: OUTRO },
  steps: buildClasses, render, sound, pronounce: PRONOUNCE,
};
