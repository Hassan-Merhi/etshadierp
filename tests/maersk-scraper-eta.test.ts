/**
 * tests/maersk-scraper-eta.test.ts
 * --------------------------------
 * Accuracy regression tests for server/lib/maerskDirectScraper.ts.
 *
 * These guard the three fixes that make the Maersk ETA match what the carrier
 * actually displays:
 *   1. formatEtaDate() keeps the port's LOCAL calendar date and never shifts
 *      it across midnight via a UTC round-trip.
 *   2. extractFromJson() reads the ETA off the correct container when a
 *      response carries several, instead of blindly trusting index 0.
 *   3. extractFromJson() flags the structured "synergy" schema so the scraper
 *      can prefer it over partial/ad-hoc payloads.
 */

import { describe, it, expect } from "vitest";
import { formatEtaDate, extractFromJson } from "../server/lib/maerskDirectScraper";

describe("formatEtaDate — timezone-safe calendar dates", () => {
  it("keeps the local date for a datetime whose UTC instant falls on the next day", () => {
    // 22:00 on the 10th at UTC-05 is 03:00 on the 11th in UTC. The old
    // toISOString().slice(0,10) reported "2024-05-11"; Maersk shows the 10th.
    expect(formatEtaDate("2024-05-10T22:00:00-05:00")).toBe("2024-05-10");
  });

  it("keeps the local date for a datetime whose UTC instant falls on the previous day", () => {
    // 01:00 on the 10th at UTC+08 is 17:00 on the 9th in UTC.
    expect(formatEtaDate("2024-05-10T01:00:00+08:00")).toBe("2024-05-10");
  });

  it("passes plain ISO dates through unchanged", () => {
    expect(formatEtaDate("2024-12-31")).toBe("2024-12-31");
    expect(formatEtaDate("2024-12-31T09:30:00")).toBe("2024-12-31");
  });

  it("parses human-readable dates", () => {
    expect(formatEtaDate("May 10, 2024")).toBe("2024-05-10");
  });

  it("returns null for empty / invalid input", () => {
    expect(formatEtaDate(null)).toBeNull();
    expect(formatEtaDate("")).toBeNull();
    expect(formatEtaDate("not a date")).toBeNull();
  });
});

describe("extractFromJson — synergy tracking payload", () => {
  const synergyPayload = {
    containers: [
      {
        container_num: "MSKU1234567",
        eta_final_delivery: "2024-06-02T21:00:00-04:00",
        locations: [
          {
            city: "Shanghai",
            country: "CN",
            events: [{ activity: "Gate-out", event_time: "2024-05-01T08:00:00+08:00", event_time_type: "ACTUAL" }],
          },
          {
            city: "Newark",
            country: "US",
            events: [{ activity: "Discharged", event_time: "2024-06-02T23:00:00-04:00", event_time_type: "EXPECTED" }],
          },
        ],
      },
    ],
  };

  it("recognises the synergy schema and returns its ETA on the local calendar day", () => {
    const r = extractFromJson(synergyPayload, "MSKU1234567");
    expect(r.synergy).toBe(true);
    // eta_final_delivery is 21:00-04:00 → 01:00 next-day in UTC, but Maersk shows the 2nd.
    expect(r.eta).toBe("2024-06-02");
    expect(r.events.length).toBe(2);
  });

  it("falls back to the destination's expected discharge when no eta_final_delivery", () => {
    const noFinal = {
      containers: [{ container_num: "MSKU1234567", locations: synergyPayload.containers[0].locations }],
    };
    const r = extractFromJson(noFinal, "MSKU1234567");
    expect(r.eta).toBe("2024-06-02");
  });
});

describe("extractFromJson — picks the requested container", () => {
  const multi = {
    containers: [
      { container_num: "AAAU0000001", eta_final_delivery: "2024-01-01", locations: [{ city: "X", events: [] }] },
      { container_num: "MSKU7654321", eta_final_delivery: "2024-09-15", locations: [{ city: "Y", events: [] }] },
    ],
  };

  it("reads the ETA off the matching container, not index 0", () => {
    expect(extractFromJson(multi, "MSKU7654321").eta).toBe("2024-09-15");
  });

  it("matches case- and whitespace-insensitively", () => {
    expect(extractFromJson(multi, " msku 765 4321 ").eta).toBe("2024-09-15");
  });

  it("falls back to the first container when none match", () => {
    expect(extractFromJson(multi, "ZZZU9999999").eta).toBe("2024-01-01");
  });
});
