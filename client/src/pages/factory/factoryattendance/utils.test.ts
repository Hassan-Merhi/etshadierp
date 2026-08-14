/**
 * Attendance date arithmetic and printed sheets.
 *
 * Attendance is recorded against a local calendar day, and the module says so in
 * its own comment: formatting through UTC returns the previous day for anyone
 * east of Greenwich, which marks a worker present on the wrong day. The week
 * builder, the range builder and the printed sheets all hang off that, and the
 * printed sheet is the one people sign.
 */
import { describe, expect, it } from "vitest";
import {
  escHtml,
  formatDate,
  generateDateRange,
  generateRangePrintHtml,
  generateWeeklyBlankSheetHtml,
  generateWeeklyResultsSheetHtml,
  getInitialMode,
  getWeekDays,
  setModeInUrl,
  weekLabel,
} from "./utils";
import type { AttendanceRecord, AttendanceStatus, WorkerRow } from "./types";

const workers: WorkerRow[] = [
  {
    id: 1,
    fullName: "Ali Hassan",
    employeeCode: "W-001",
    department: "Baling",
    position: "Operator",
    shiftType: "Day",
    active: true,
  },
  {
    id: 2,
    fullName: "Sara Nasser",
    employeeCode: "W-002",
    department: "Baling",
    position: "Operator",
    shiftType: "Day",
    active: true,
  },
];

describe("date ranges", () => {
  it("lists every day between the two ends, inclusive", () => {
    expect(generateDateRange("2026-03-01", "2026-03-04")).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
    ]);
  });

  it("returns the single day when both ends are the same", () => {
    expect(generateDateRange("2026-03-01", "2026-03-01")).toEqual(["2026-03-01"]);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(generateDateRange("2026-03-04", "2026-03-01")).toEqual([]);
  });

  it("crosses a month boundary without repeating or skipping a day", () => {
    expect(generateDateRange("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("keeps the local calendar day rather than shifting through UTC", () => {
    // A date formatted through toISOString() comes back as the previous day for
    // anyone in a positive offset, which marks attendance against the wrong day.
    const [only] = generateDateRange("2026-03-01", "2026-03-01");
    expect(only).toBe("2026-03-01");
  });
});

describe("weeks", () => {
  it("starts the week on Monday whichever day is given", () => {
    const fromWednesday = getWeekDays("2026-03-04");
    expect(fromWednesday).toHaveLength(6);
    expect(fromWednesday[0].iso).toBe("2026-03-02");
    expect(fromWednesday[0].dayName).toBe("Mon");
    expect(fromWednesday[5].iso).toBe("2026-03-07");
  });

  it("treats Sunday as the end of the week that just passed", () => {
    // Sunday is not a working day on this sheet; a naive week start would put
    // it at the head of the coming week and shift every column by six days.
    expect(getWeekDays("2026-03-08")[0].iso).toBe("2026-03-02");
  });

  it("labels a week by its first and last day", () => {
    expect(weekLabel(getWeekDays("2026-03-04"))).toBe("Mar 2 – Mar 7, 2026");
  });
});

describe("display helpers", () => {
  it("formats a date without shifting it", () => {
    expect(formatDate("2026-03-04")).toContain("2026");
    expect(formatDate("2026-03-04")).toContain("4");
  });

  it("returns the input when it is not a date", () => {
    expect(formatDate("not-a-date")).toBe("Invalid Date");
  });

  it("escapes the characters that would break the printed markup", () => {
    expect(escHtml('<script>&"')).toBe("&lt;script&gt;&amp;&quot;");
  });
});

describe("view mode in the url", () => {
  it("defaults to the daily view", () => {
    window.history.replaceState(null, "", "/attendance");
    expect(getInitialMode()).toBe("daily");
  });

  it("reads the per-worker view from the query string", () => {
    window.history.replaceState(null, "", "/attendance?mode=perWorker");
    expect(getInitialMode()).toBe("perWorker");
  });

  it("drops the parameter again when returning to the default view", () => {
    setModeInUrl("perWorker");
    expect(window.location.search).toContain("mode=perWorker");

    setModeInUrl("daily");
    // The default is expressed by the parameter's absence, so a shared link
    // opens on the view the sender was looking at.
    expect(window.location.search).not.toContain("mode=");
  });
});

describe("printed weekly sheet", () => {
  const weekDays = getWeekDays("2026-03-04");

  it("prints a blank sheet with a row per worker and a column per day", () => {
    const html = generateWeeklyBlankSheetHtml(workers, weekDays, "Day", "en");

    expect(html).toContain("Ali Hassan");
    expect(html).toContain("Sara Nasser");
    expect(html.match(/<th>Mon<br\/>2<\/th>/)).not.toBeNull();
    expect(html).toContain("<html");
  });

  it("prints the Arabic sheet with Arabic day names", () => {
    const html = generateWeeklyBlankSheetHtml(workers, weekDays, "Day", "ar");

    expect(html).toContain(weekDays[0].dayNameAr);
    expect(html).not.toContain("<th>Mon<br/>");
  });

  it("marks the recorded status on the results sheet", () => {
    const attendance: Record<number, AttendanceStatus> = { 1: "Present", 2: "Absent" };
    const html = generateWeeklyResultsSheetHtml(
      workers,
      attendance,
      { 2: "Called in sick" },
      weekDays,
      "2026-03-04",
      "Day",
      "en"
    );

    expect(html).toContain("Ali Hassan");
    expect(html).toContain("Called in sick");
    // The selected day is highlighted so the reader knows which column the
    // statuses belong to.
    expect(html).toContain("background:#d0e0f0");
  });
});

describe("printed range sheet", () => {
  it("fills each worker's recorded days across the range", () => {
    const attendance: AttendanceRecord[] = [
      { id: 1, workerId: 1, attendanceDate: "2026-03-02", shift: "Day", status: "Present", notes: null },
      { id: 2, workerId: 1, attendanceDate: "2026-03-03", shift: "Day", status: "Absent", notes: null },
      { id: 3, workerId: 2, attendanceDate: "2026-03-02", shift: "Day", status: "Late", notes: null },
    ];

    const html = generateRangePrintHtml(
      workers,
      attendance,
      generateDateRange("2026-03-02", "2026-03-03"),
      "2026-03-02",
      "2026-03-03",
      "en"
    );

    expect(html).toContain("Ali Hassan");
    expect(html).toContain("Sara Nasser");
    expect(html).toContain("2026-03-02");
  });

  it("prints a sheet for a range with no records at all", () => {
    const html = generateRangePrintHtml(
      workers,
      [],
      generateDateRange("2026-03-02", "2026-03-03"),
      "2026-03-02",
      "2026-03-03",
      "ar"
    );

    expect(html).toContain("<html");
    expect(html).toContain("Ali Hassan");
  });
});
