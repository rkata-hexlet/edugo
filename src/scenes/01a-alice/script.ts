import type { Step } from "../../engine/contract";
import { claimLease, complete, send, world, type ActorId, type Focus, type World } from "../01-skip-locked/sim";

// Эксперимент «Алиса» (docs/episodes/01a-alice.md): кейс 2 эпизода 01 в саду Червонной Королевы.
// Механика — модель эпизода 01 без изменений: садовники — поды, кусты — задачи, Королева — база
// со своими часами, корзина Герцогини — внешний получатель. Подача — MVP: серые фигуры и подписи.

export const ACT = {
  garden: "Сад Королевы",
  lease: "Бирка со сроком",
  zombie: "Садовник проснулся",
  key: "Номер на розе",
  summary: "Итог",
} as const;

export const NAMES: Record<ActorId, string> = { A: "Двойка", B: "Пятёрка", C: "Семёрка" };

/** Латиница в голосе: термины — английским голосом, как в эпизоде 01. */
export const PRONOUNCE: Record<string, string> = {};

interface ShotOptions {
  voice: string;
  focus?: Focus[];
}

/** Состояние кадра собирается сценарием; реплики, штамп и события живут один кадр. */
class Director {
  readonly steps: Step<World>[] = [];
  w: World = world(3);
  private act = "";
  private label: string | null = null;
  private doubtOf: ActorId | null = null;

  scene(act: string, w?: World): void {
    if (act !== this.act) this.label = null;
    this.act = act;
    if (w) this.w = w;
  }

  term(label: string): void {
    this.label = label;
  }

  doubt(who: ActorId | null): void {
    this.doubtOf = who;
  }

  shot(action: ((w: World) => void) | undefined, opts: ShotOptions): void {
    const w = this.w;
    w.db = null;
    w.mail = null;
    w.ghost = null;
    w.stamp = null;
    w.term = this.label;
    w.focus = opts.focus ?? null;
    w.events = [];
    for (const a of Object.values(w.actors)) a.say = null;
    action?.(w);
    w.doubt = this.doubtOf;
    w.frame = this.steps.length;
    if (w.stamp) w.events.push({ kind: "rewind" });
    this.steps.push({ act: this.act, caption: "", state: structuredClone(w), narration: opts.voice });
  }
}

function setClock(w: World, t: number): void {
  w.events.push({ kind: "clock", n: t - w.clock });
  w.clock = t;
}

function freeze(w: World, who: ActorId, frozen: boolean): void {
  w.actors[who].frozen = frozen;
  w.events.push({ kind: frozen ? "freeze" : "unfreeze", by: who });
}

/** Садовник берёт куст: Королева выдаёт бирку — номер захвата и срок по своим часам. */
function takeBush(w: World, who: ActorId): number {
  const id = claimLease(w, who);
  if (id === null) throw new Error(`сценарий: ${NAMES[who]} не нашёл куст`);
  w.actors[who].carrying = id;
  return id;
}

function release(w: World, who: ActorId): void {
  w.actors[who].carrying = null;
  w.actors[who].seen = null;
}

const L = 4270; // часы Королевы: без нескольких минут час пополудни — к чаю

export function buildSteps(): Step<World>[] {
  const d = new Director();
  const w0 = world(3);
  w0.clock = L;
  for (const id of ["A", "B", "C"] as const) w0.actors[id].label = NAMES[id];
  d.scene(ACT.garden, w0);
  d.doubt("B");
  d.shot((w) => {
    w.db = "Красные розы к чаю!";
  }, {
    focus: ["table", "B"],
    voice: "Червонная Королева требует к чаю красные розы, а садовники-карты красят для неё белые кусты. Только вот Пятёрка то и дело замирает с кистью в руке, и тогда её куст стоит ничей: спит она или вовсе выбыла, со стороны не понять.",
  });

  d.scene(ACT.lease);
  d.shot((w) => {
    w.leaseCols = true;
  }, {
    focus: ["table"],
    voice: "Раз узнать это нельзя, мы дадим садовнику срок. Для этого у каждого куста появятся две отметки: номер захвата и время, до которого куст за садовником.",
  });
  d.term("Lease");
  d.shot((w) => takeBush(w, "B"), {
    focus: ["B", "row:1", "clock"],
    voice: "Когда Пятёрка берёт первый куст, Королева вешает на него бирку с номером захвата и временем по своим часам, а копию отдаёт садовнику. Других часов, которым верят в этом саду, нет. Это и есть lease, аренда на время.",
  });
  d.shot((w) => {
    setClock(w, L + 5);
    w.actors.B.checkedAt = w.clock;
    w.actors.B.thought = "Время есть — успею!";
    freeze(w, "B", true);
  }, {
    focus: ["B", "row:1"],
    voice: "Пятёрка глядит на бирку, видит запас по времени и прямо с кистью в руке засыпает.",
  });
  d.shot((w) => {
    setClock(w, L + 37);
    w.events.push({ kind: "expire" });
  }, {
    focus: ["row:1", "clock"],
    voice: "Срок на бирке давно прошёл, а Королеве и дела нет: бирка висит, как висела. Срок — это просто надпись, сама по себе она ничего не делает.",
  });
  d.shot((w) => {
    w.ghost = { row: 1, token: w.rows[0].token! };
    w.events.push({ kind: "ghost" });
    takeBush(w, "C");
  }, {
    focus: ["C", "row:1", "clock"],
    voice: "И только когда за работой приходит Семёрка, Королева сверяет бирку со своими часами. Аренда истекла, поэтому куст достаётся Семёрке с новой биркой, а у спящей Пятёрки в руке остаётся старая.",
  });
  const beforeZombie = structuredClone(d.w);

  d.scene(ACT.zombie);
  d.shot((w) => {
    setClock(w, L + 46);
    freeze(w, "B", false);
    send(w, "B", 1);
  }, {
    focus: ["B", "mail"],
    voice: "И тут Пятёрка просыпается! Она полагается на свою старую проверку, срезает розу, красит её и отправляет за ограду, в корзину Герцогини, даже не подозревая, что куст уже не её. Это снова check-then-act.",
  });
  d.shot((w) => {
    complete(w, "B", 1, true);
    w.clash = { row: 1, by: "B" };
    w.events.push({ kind: "clash" });
    w.db = "Куста с такой биркой нет.";
    w.actors.B.thought = null;
  }, {
    focus: ["B", "row:1"],
    voice: "Пятёрка идёт к Королеве отметить куст готовым, но та ищет куст с её биркой и не находит: бирка на кусте уже чужая! Отметка не проходит. Вот только роза уже лежит в корзине Герцогини, и забрать её назад Королева не может.",
  });
  d.shot((w) => {
    release(w, "B");
    send(w, "C", 1);
    complete(w, "C", 1, true);
    release(w, "C");
  }, {
    focus: ["C", "mail", "row:1"],
    voice: "Следом с того же куста срезает и красит розу Семёрка, и её роза тоже уходит Герцогине. Куст отмечен готовым один раз, а роз в корзине две. Королева сберегла свой сад, но до чужой корзины ей не дотянуться.",
  });

  d.scene(ACT.key, structuredClone(beforeZombie));
  d.term("Idempotency key");
  d.shot((w) => {
    w.stamp = "⟲ Вернёмся: номер куста на розе";
    w.keyed = true;
    setClock(w, L + 46);
    freeze(w, "B", false);
    send(w, "B", 1, true);
  }, {
    focus: ["B", "mail"],
    voice: "Королева не властна над корзиной Герцогини, значит, защищаться должна сама Герцогиня. Вернёмся назад, пока Пятёрка ещё спит, и подпишем на розе номер куста, а не бирки: бирки у садовников разные, а куст один. Это ключ идемпотентности, idempotency key.",
  });
  d.shot((w) => {
    complete(w, "B", 1, true);
    release(w, "B");
    w.actors.B.thought = null;
    send(w, "C", 1, true);
    complete(w, "C", 1, true);
    release(w, "C");
    w.mail = "Такую я уже получала.";
  }, {
    focus: ["C", "mail"],
    voice: "Роза Семёрки тоже доходит до Герцогини, но та находит номер куста в своей книге и просто отвечает как в прошлый раз: такую уже получала. Вторая роза в корзину не ложится.",
  });
  const afterKeyed = structuredClone(d.w);

  d.scene(ACT.summary, afterKeyed);
  d.term("At-least-once");
  d.doubt(null);
  d.shot(undefined, {
    focus: ["mail", "table"],
    voice: "Медленного садовника не отличить от упавшего, поэтому куст иногда приходится отдавать другому, пока первый ещё жив. Повторная роза неизбежна, а терять розы мы не хотим. Так мы и приходим к гарантии at-least-once: отправка может повториться, а распознать повтор должен тот, кто принимает.",
  });
  return d.steps;
}
