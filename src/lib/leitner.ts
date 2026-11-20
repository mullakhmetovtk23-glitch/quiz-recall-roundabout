export type Grade = 1 | 2 | 3 | 4;
export type Direction = "forward" | "reverse";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewResult {
  box: number;
  dueAt: Date;
  /** true → the card goes back to the end of the current session */
  requeue: boolean;
}

/**
 * Leitner rules:
 * 1 «Не помню»     → box 0, due now, back to the end of this session
 * 2 «С трудом»     → box 1, in 1 day
 * 3 «Помню»        → box 2, in 4 days
 * 4 «Железобетон»  → box 3, in 14 days; if already box ≥ 3 → box 4, in 45 days
 */
export function nextReview(currentBox: number, grade: Grade, now: Date = new Date()): ReviewResult {
  const at = (days: number) => new Date(now.getTime() + days * DAY_MS);
  switch (grade) {
    case 1:
      return { box: 0, dueAt: now, requeue: true };
    case 2:
      return { box: 1, dueAt: at(1), requeue: false };
    case 3:
      return { box: 2, dueAt: at(4), requeue: false };
    case 4:
      return currentBox >= 3
        ? { box: 4, dueAt: at(45), requeue: false }
        : { box: 3, dueAt: at(14), requeue: false };
  }
}

export const GRADES: { grade: Grade; label: string; hint: string }[] = [
  { grade: 1, label: "Не помню", hint: "сейчас" },
  { grade: 2, label: "С трудом", hint: "1 день" },
  { grade: 3, label: "Помню", hint: "4 дня" },
  { grade: 4, label: "Железобетон", hint: "14–45 дней" },
];
