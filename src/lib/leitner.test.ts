import { describe, expect, it } from "vitest";
import { nextReview } from "./leitner";

const now = new Date("2026-01-01T12:00:00Z");
const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86400000);

describe("Leitner grading", () => {
  it("1 «Не помню» → box 0, due now, back into the session", () => {
    const r = nextReview(3, 1, now);
    expect(r).toMatchObject({ box: 0, requeue: true });
    expect(days(r.dueAt)).toBe(0);
  });
  it("2 «С трудом» → box 1 in 1 day", () => {
    const r = nextReview(2, 2, now);
    expect([r.box, days(r.dueAt), r.requeue]).toEqual([1, 1, false]);
  });
  it("3 «Помню» → box 2 in 4 days", () => {
    const r = nextReview(0, 3, now);
    expect([r.box, days(r.dueAt)]).toEqual([2, 4]);
  });
  it("4 «Железобетон» from box < 3 → box 3 in 14 days", () => {
    const r = nextReview(2, 4, now);
    expect([r.box, days(r.dueAt)]).toEqual([3, 14]);
  });
  it("4 «Железобетон» from box 3 → box 4 in 45 days", () => {
    const r = nextReview(3, 4, now);
    expect([r.box, days(r.dueAt)]).toEqual([4, 45]);
  });
});
