import { describe, expect, it } from "vitest";
import {
  getSchedulerCallbackName,
  nameSchedulerCallback,
  resolveSchedulerMetricName,
} from "../server/lib/schedulerObservability";

describe("Phase 5 performance and operations", () => {
  it("records cron metrics under a stable business job name", () => {
    const callback = nameSchedulerCallback(async () => undefined, "overdue customer check");

    expect(getSchedulerCallbackName(callback)).toBe("overdue-customer-check");
    expect(resolveSchedulerMetricName("0 9 * * *", callback)).toBe("cron:overdue-customer-check");
    expect(resolveSchedulerMetricName("0 9 * * *", async () => undefined)).toBe("cron-expression:0 9 * * *");
  });
});
