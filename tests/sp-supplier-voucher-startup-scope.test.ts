import { describe, expect, it, vi } from "vitest";

import { runSpSupplierVoucherStartup } from "../server/routes/sp/spSupplierVoucherStartup";

describe("SP supplier voucher startup scope", () => {
  it("runs trigger setup and global repair inside explicit maintenance scope", async () => {
    let maintenanceActive = false;
    const ensureTrigger = vi.fn(async () => {
      expect(maintenanceActive).toBe(true);
    });
    const repairLinks = vi.fn(async () => {
      expect(maintenanceActive).toBe(true);
      return 4;
    });
    const runMaintenanceScope = vi.fn(async (reason: string, callback: () => Promise<number>) => {
      expect(reason).toBe("sp-supplier-voucher-sync-startup");
      maintenanceActive = true;
      try {
        return await callback();
      } finally {
        maintenanceActive = false;
      }
    });

    await expect(
      runSpSupplierVoucherStartup({ ensureTrigger, repairLinks, runMaintenanceScope }),
    ).resolves.toBe(4);

    expect(ensureTrigger).toHaveBeenCalledTimes(1);
    expect(repairLinks).toHaveBeenCalledTimes(1);
    expect(runMaintenanceScope).toHaveBeenCalledTimes(1);
    expect(maintenanceActive).toBe(false);
  });

  it("keeps startup failures visible instead of bypassing tenant isolation", async () => {
    const failure = new Error("supplier repair failed");
    const repairLinks = vi.fn(async () => {
      throw failure;
    });

    await expect(
      runSpSupplierVoucherStartup({
        ensureTrigger: vi.fn(async () => undefined),
        repairLinks,
        runMaintenanceScope: async (_reason, callback) => callback(),
      }),
    ).rejects.toBe(failure);

    expect(repairLinks).toHaveBeenCalledTimes(1);
  });
});
