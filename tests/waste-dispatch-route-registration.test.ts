import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("waste dispatch route registration", () => {
  it("delegates the compatibility registrar to the canonical registrar", async () => {
    const canonicalRegistrar = vi.fn();
    vi.doMock("../server/routes/factory/employee-pos/index", () => ({
      registerFactoryEmployeesPosRoutes: canonicalRegistrar,
    }));

    const { registerFactoryEmployeesPosRoutes } = await import("../server/routes/factory/factoryEmployeesPosRoutes");
    const app = {} as Express;

    registerFactoryEmployeesPosRoutes(app);

    expect(canonicalRegistrar).toHaveBeenCalledTimes(1);
    expect(canonicalRegistrar).toHaveBeenCalledWith(app);
  });

  it("includes the optimized waste dispatch registrar in the canonical registrar", async () => {
    const wasteDispatchRegistrar = vi.fn();
    const noopRegistrar = vi.fn();

    vi.doMock("../server/routes/factory/employee-pos/employee-crud", () => ({
      registerEmployeeCrudRoutes: noopRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/employeeAdvancesBonusRoutes", () => ({
      registerEmployeeAdvancesBonusRoutes: noopRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/employeeLedgerWasteRoutes", () => ({
      registerEmployeeLedgerWasteRoutes: noopRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/wasteDispatchBandwidthRoutes", () => ({
      registerWasteDispatchBandwidthRoutes: wasteDispatchRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/pos-financial", () => ({
      registerEmployeePosFinancialRoutes: noopRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/netPositionHistoricalCorrection", () => ({
      registerNetPositionHistoricalCorrection: noopRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/employeeNetPositionRoutes", () => ({
      registerEmployeeNetPositionRoutes: noopRegistrar,
    }));
    vi.doMock("../server/routes/factory/employee-pos/employeeAttendanceRoutes", () => ({
      registerEmployeeAttendanceRoutes: noopRegistrar,
    }));

    const { registerFactoryEmployeesPosRoutes } = await import("../server/routes/factory/employee-pos/index");
    const app = {} as Express;

    registerFactoryEmployeesPosRoutes(app);

    expect(wasteDispatchRegistrar).toHaveBeenCalledTimes(1);
    expect(wasteDispatchRegistrar).toHaveBeenCalledWith(app);
  });
});
