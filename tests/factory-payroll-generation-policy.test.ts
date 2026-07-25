import { describe, expect, it } from "vitest";
import {
  buildFactoryPayrollGenerationLockKey,
  calculateFactoryPayroll,
} from "../server/services/payroll/factoryPayrollGenerationPolicy";

describe("factory payroll generation policy", () => {
  it("preserves monthly attendance-based salary calculation", () => {
    const result = calculateFactoryPayroll({
      salaryType: "Monthly",
      baseSalary: 3100,
      perBaleRate: 0,
      perKgRate: 0,
      overtimeRate: 0,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      attendanceStatuses: ["Present", "Half Day", "Absent"],
      baleWeightsKg: [],
      outstandingAdvance: 0,
    });

    expect(result.basePay).toBe(150);
    expect(result.presentDays).toBe(1.5);
    expect(result.absentDays).toBe(1.5);
    expect(result.netSalary).toBe(150);
  });

  it("preserves weekday fallback for daily workers without attendance", () => {
    const result = calculateFactoryPayroll({
      salaryType: "Daily",
      baseSalary: 50,
      perBaleRate: 0,
      perKgRate: 0,
      overtimeRate: 0,
      startDate: "2026-07-20",
      endDate: "2026-07-24",
      attendanceStatuses: [],
      baleWeightsKg: [],
      outstandingAdvance: 0,
    });

    expect(result.totalWorkingDays).toBe(5);
    expect(result.basePay).toBe(250);
    expect(result.netSalary).toBe(250);
  });

  it("preserves per-bale and per-kilogram earnings", () => {
    const perBale = calculateFactoryPayroll({
      salaryType: "Per Bale",
      baseSalary: 0,
      perBaleRate: 12,
      perKgRate: 0,
      overtimeRate: 0,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      attendanceStatuses: [],
      baleWeightsKg: [90, 95, 100],
      outstandingAdvance: 0,
    });
    expect(perBale.balesCount).toBe(3);
    expect(perBale.baleEarnings).toBe(36);

    const perKg = calculateFactoryPayroll({
      salaryType: "Per KG",
      baseSalary: 0,
      perBaleRate: 0,
      perKgRate: 2,
      overtimeRate: 0,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      attendanceStatuses: [],
      baleWeightsKg: [10, 12.5],
      outstandingAdvance: 0,
    });
    expect(perKg.kgProcessed).toBe(22.5);
    expect(perKg.kgEarnings).toBe(45);
  });

  it("caps advance settlement at gross pay", () => {
    const result = calculateFactoryPayroll({
      salaryType: "Daily",
      baseSalary: 100,
      perBaleRate: 0,
      perKgRate: 0,
      overtimeRate: 0,
      startDate: "2026-07-20",
      endDate: "2026-07-20",
      attendanceStatuses: ["Present"],
      baleWeightsKg: [],
      outstandingAdvance: 250,
    });

    expect(result.advances).toBe(100);
    expect(result.netSalary).toBe(0);
  });

  it("scopes concurrency locks by company and exact period", () => {
    const first = buildFactoryPayrollGenerationLockKey(1, "2026-07-01", "2026-07-31");
    expect(first).toBe("factory-payroll-generation:1:2026-07-01:2026-07-31");
    expect(buildFactoryPayrollGenerationLockKey(2, "2026-07-01", "2026-07-31")).not.toBe(first);
    expect(buildFactoryPayrollGenerationLockKey(1, "2026-08-01", "2026-08-31")).not.toBe(first);
  });
});
