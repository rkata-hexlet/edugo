// Контракт сцены — leaf: импортируется и каркасом, и сценами, сам ничего не импортирует.

/** Один шаг детерминированной симуляции: что произошло и подпись для зрителя. */
export interface Step<S> {
  state: S;
  caption: string;
}

/** Сцена = заранее просчитанная последовательность состояний + отрисовка любого из них. */
export interface Scene<S> {
  id: string;
  title: string;
  steps(): Step<S>[];
  render(root: SVGSVGElement, state: S): void;
}
