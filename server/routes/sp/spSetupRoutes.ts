import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { eq, and, isNull, asc } from "drizzle-orm";
import { ledgerAccounts, locations, bankAccounts } from "@shared/schema";
import { requireSpCompany, getSpAccount, SP_ACCOUNTS } from "./spHelpers";
import { getSpSupplierVoucherLinkGapCount, repairSpSupplierVoucherLinks } from "./spSupplierVoucherSync";

// ── Setup ─────────────────────────────────────────────────────────────────

export function registerSpSetupRoutes(app: Express) {
  app.post("/api/sp/setup", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const created: string[] = [];
      const existing: string[] = [];

      for (const acct of SP_ACCOUNTS) {
        const found = await getSpAccount(companyId, acct.subType);
        if (!found) {
          await db.insert(ledgerAccounts).values({
            companyId,
            code: acct.code,
            name: acct.name,
            accountType: acct.accountType,
            subType: acct.subType,
            isHidden: acct.isHidden,
            active: true,
          });
          created.push(acct.name);
        } else {
          existing.push(acct.name);
        }
      }

      // Ensure a default location exists for inventory tracking
      const locs = await db
        .select()
        .from(locations)
        .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
      if (locs.length === 0) {
        await db.insert(locations).values({
          companyId,
          code: "SP-WH-001",
          name: "Main Warehouse",
          active: true,
        });
        created.push("Default location: Main Warehouse");
      }

      // Repair historical SP Goods-OTW vouchers and ensure future container
      // supplier edits remain synchronized with the voucher header.
      const repairedSupplierVoucherLinks = await repairSpSupplierVoucherLinks(companyId);

      res.json({
        created,
        existing,
        repairedSupplierVoucherLinks,
        requiredAccountCount: SP_ACCOUNTS.length,
        message:
          created.length > 0 || repairedSupplierVoucherLinks > 0
            ? "Setup and supplier-link repair complete"
            : "Already configured",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sp/setup/status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const accounts = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)))
        .orderBy(asc(ledgerAccounts.code));

      const spAccounts = accounts.filter((a) => a.subType?.startsWith("sp_"));
      const isConfigured = SP_ACCOUNTS.every((sa) => spAccounts.some((a) => a.subType === sa.subType));

      const locs = await db
        .select()
        .from(locations)
        .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));

      const banks = await db.select().from(bankAccounts).where(eq(bankAccounts.companyId, companyId));
      const supplierVoucherLinkGapCount = await getSpSupplierVoucherLinkGapCount(companyId);

      res.json({
        isConfigured,
        spAccounts,
        requiredAccountCount: SP_ACCOUNTS.length,
        locations: locs,
        bankAccounts: banks,
        supplierVoucherLinkGapCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
