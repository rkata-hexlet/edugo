// Composition root: реестр сцен и сборка плеера. Логики здесь нет.
import { mountPlayer } from "./engine/player";
import { skipLocked } from "./scenes/01-skip-locked";
import { alice } from "./scenes/01a-alice";

const scenes = { [skipLocked.id]: skipLocked, [alice.id]: alice };

const requested = new URLSearchParams(location.search).get("scene") ?? skipLocked.id;
mountPlayer(document.getElementById("app")!, scenes[requested] ?? skipLocked);
