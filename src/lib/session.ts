import type { Card } from "./db";
import type { Direction } from "./leitner";

export type DirectionMode = "reverse" | "forward" | "mixed";

export interface SessionItem {
  key: string;
  card: Card;
  direction: Direction;
}

export function dueAtFor(card: Pick<Card, "fwd_due_at" | "rev_due_at">, direction: Direction) {
  return new Date(direction === "forward" ? card.fwd_due_at : card.rev_due_at);
}

export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * Builds the queue of (card, direction) pairs.
 * - dueOnly: every direction whose own due date has passed (mixed → both directions may appear).
 * - free: every card once; mixed picks a random direction per card.
 */
export function buildSession(
  cards: Card[],
  mode: DirectionMode,
  dueOnly: boolean,
  now: Date = new Date(),
  rand: () => number = Math.random,
): SessionItem[] {
  const items: SessionItem[] = [];
  for (const card of cards) {
    if (dueOnly) {
      const dirs: Direction[] = mode === "mixed" ? ["forward", "reverse"] : [mode];
      for (const d of dirs) {
        if (dueAtFor(card, d) <= now) items.push({ key: `${card.id}:${d}`, card, direction: d });
      }
    } else {
      const d: Direction = mode === "mixed" ? (rand() < 0.5 ? "forward" : "reverse") : mode;
      items.push({ key: `${card.id}:${d}`, card, direction: d });
    }
  }
  return shuffle(items, rand);
}
