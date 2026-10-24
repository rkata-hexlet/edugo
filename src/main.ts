// Composition root: реестр сцен, дубли диктора и выбор режима (плеер или суфлёр). Логики здесь нет.
import type { Scene } from "./engine/contract";
import { mountPlayer } from "./engine/player";
import { mountRecorder } from "./engine/recorder";
import { loadTakes } from "./engine/takes";
import { skipLocked } from "./scenes/01-skip-locked";
import { cache } from "./scenes/02-cache";
import { doubleCharge } from "./scenes/08-double-charge";

// У каждой сцены свой тип состояния; плееру он не важен — сцена сама рисует своё состояние.
const scenes: Record<string, Scene<any>> = { [skipLocked.id]: skipLocked, [cache.id]: cache, [doubleCharge.id]: doubleCharge };

const params = new URLSearchParams(location.search);
const scene = scenes[params.get("scene") ?? skipLocked.id] ?? skipLocked;
const mount = params.has("record") ? mountRecorder : mountPlayer;
void loadTakes(scene.id).then((takes) => mount(document.getElementById("app")!, scene, takes));
