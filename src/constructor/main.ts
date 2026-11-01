// Composition root конструктора (ADR-0007): уровень + SVG-перо + контроллер прогона. Логики здесь нет.
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./ui/play.css";
import { SvgPen } from "../engine/pen";
import { level } from "./levels/01-booking";
import { mountGame } from "./ui/game";

const app = document.getElementById("app")!;
mountGame(app, level, (svg) => new SvgPen(svg), new URLSearchParams(location.search));
