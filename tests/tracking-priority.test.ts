/**
 * Unit tests for server/lib/trackingPriority.ts — the pure priority-scoring and
 * credit-budget logic behind the smart container-tracking scheduler. First
 * matching rule wins, so the tests pin the ordering as well as each tier.
 */
import { getTrackingPriority, calcPerRunBudget, type PriorityInput } from "../server/lib/trackingPriority";

const NOW = new Date("2026-01-15T00:00:00Z");

/** Baseline container that lands in the lowest tier; override per case. */
function container(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return {
    status: "booked",
    eta: null,
    isOverdue: false,
    docsReadyNotSent: false,
    numberPlate: null,
    trackingLastCheckedAt: null,
    trackingChangedAt: null,
    ...overrides,
  };
}

/** eta N days from NOW as a plain YYYY-MM-DD string (UTC midnight). */
function etaInDays(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

describe("getTrackingPriority — high tier (24h)", () => {
  it("flags ETA passed with no truck as top priority", () => {
    const r = getTrackingPriority(container({ eta: etaInDays(-5), numberPlate: null }), NOW);
    expect(r.priorityScore).toBe(100);
    expect(r.priorityTier).toBe("high");
    expect(r.minimumIntervalHours).toBe(24);
    expect(r.reason).toMatch(/no truck/i);
  });

  it("flags overdue containers, ahead of status-based rules", () => {
    const r = getTrackingPriority(container({ isOverdue: true, status: "arrived" }), NOW);
    expect(r.priorityScore).toBe(100);
    expect(r.reason).toMatch(/overdue/i);
  });

  it("flags docs-ready-not-sent", () => {
    const r = getTrackingPriority(container({ docsReadyNotSent: true, numberPlate: "ABC1" }), NOW);
    expect(r.priorityScore).toBe(95);
    expect(r.priorityTier).toBe("high");
  });

  it("scores near-delivery statuses in descending order", () => {
    const truck = { numberPlate: "PL8" };
    expect(getTrackingPriority(container({ status: "at port", ...truck }), NOW).priorityScore).toBe(95);
    expect(getTrackingPriority(container({ status: "left dar", ...truck }), NOW).priorityScore).toBe(93);
    expect(getTrackingPriority(container({ status: "at border", ...truck }), NOW).priorityScore).toBe(93);
    expect(getTrackingPriority(container({ status: "in transit", ...truck }), NOW).priorityScore).toBe(90);
  });

  it("is case-insensitive on status", () => {
    const r = getTrackingPriority(container({ status: "IN TRANSIT", numberPlate: "X" }), NOW);
    expect(r.reason).toMatch(/in transit/i);
  });

  it("treats an ETA within 3 days as high", () => {
    const r = getTrackingPriority(container({ eta: etaInDays(2), numberPlate: "X" }), NOW);
    expect(r.priorityScore).toBe(90);
    expect(r.reason).toMatch(/ETA in 2 days/);
  });
});

describe("getTrackingPriority — medium tier (48h)", () => {
  it("treats an ETA of 4-7 days as medium", () => {
    const r = getTrackingPriority(container({ eta: etaInDays(6), numberPlate: "X" }), NOW);
    expect(r.priorityScore).toBe(70);
    expect(r.priorityTier).toBe("medium");
    expect(r.minimumIntervalHours).toBe(48);
  });

  it("scores 'arrived' (no near ETA) as medium", () => {
    const r = getTrackingPriority(container({ status: "arrived", numberPlate: "X" }), NOW);
    expect(r.priorityScore).toBe(65);
    expect(r.priorityTier).toBe("medium");
  });

  it("treats an ETA of 8-14 days as medium", () => {
    const r = getTrackingPriority(container({ eta: etaInDays(12), numberPlate: "X" }), NOW);
    expect(r.priorityScore).toBe(60);
  });

  it("bumps a recently-changed container to medium when no ETA is near", () => {
    const changed = new Date(NOW.getTime() - 10 * 60 * 60 * 1000); // 10h ago
    const r = getTrackingPriority(container({ trackingChangedAt: changed, numberPlate: "X" }), NOW);
    expect(r.priorityScore).toBe(55);
    expect(r.reason).toMatch(/changed recently/i);
  });
});

describe("getTrackingPriority — low tier", () => {
  it("uses a 96h interval for an ETA 15-21 days out", () => {
    const r = getTrackingPriority(container({ eta: etaInDays(18), numberPlate: "X" }), NOW);
    expect(r.priorityTier).toBe("low");
    expect(r.priorityScore).toBe(30);
    expect(r.minimumIntervalHours).toBe(96);
  });

  it("uses a 120h interval for an ETA beyond 21 days", () => {
    const r = getTrackingPriority(container({ eta: etaInDays(30), numberPlate: "X" }), NOW);
    expect(r.minimumIntervalHours).toBe(120);
  });

  it("falls back to lowest priority when no ETA is set", () => {
    const r = getTrackingPriority(container(), NOW);
    expect(r.priorityScore).toBe(15);
    expect(r.priorityTier).toBe("low");
    expect(r.reason).toMatch(/no eta/i);
  });
});

describe("getTrackingPriority — result shape", () => {
  it("computes nextRecommendedCheckAt from now + interval", () => {
    const r = getTrackingPriority(container({ status: "in transit", numberPlate: "X" }), NOW);
    const expected = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(r.nextRecommendedCheckAt.getTime()).toBe(expected.getTime());
    expect(r.priorityLabel).toBe("High");
  });

  it("ignores an unparseable ETA string (treated as no ETA)", () => {
    const r = getTrackingPriority(container({ eta: "not-a-date" }), NOW);
    expect(r.reason).toMatch(/no eta/i);
  });
});

describe("calcPerRunBudget", () => {
  it("splits the monthly remainder across remaining days and 4 runs/day", () => {
    const r = calcPerRunBudget(1000, new Date("2026-01-01T00:00:00Z"));
    expect(r.remainingDays).toBe(31);
    expect(r.dailyBudget).toBe(32); // floor(1000/31)
    expect(r.perRunBudget).toBe(8); // max(1, floor(32/4))
  });

  it("never returns a per-run budget below 1, even at zero remaining", () => {
    const r = calcPerRunBudget(0, new Date("2026-01-10T00:00:00Z"));
    expect(r.dailyBudget).toBe(0);
    expect(r.perRunBudget).toBe(1);
  });

  it("clamps remainingDays to at least 1 on the last day of the month", () => {
    const r = calcPerRunBudget(40, new Date("2026-01-31T12:00:00Z"));
    expect(r.remainingDays).toBe(1);
    expect(r.dailyBudget).toBe(40);
    expect(r.perRunBudget).toBe(10);
  });
});
