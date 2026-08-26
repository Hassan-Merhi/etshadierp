import type { Express, Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { companySettings, ledgerAccounts } from "@shared/schema";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  GOLDEN_COAST_PHASE2_LOOKUP_SUBTYPES,
  GoldenCoastPhase2SetupError,
  type GoldenCoastLedgerRow,
  type GoldenCoastSettingsKey,
  type GoldenCoastSettingsSnapshot,
  planGoldenCoastAccountProvisioning,
  summarizeGoldenCoastAccountSetup,
} from "../../services/accounting/goldenCoastPhase2Accounts";
import { requireSpCompany } from "./spHelpers";

// ── Golden Coast Phase 2 ledger provisioning ─────────────────────────────────
//
// Lives in the existing Supplier Partner setup area so an Admin can verify the
// Phase 2 balance-sheet roles next to the rest of SP setup. All reads and writes
// are scoped to the currently selected supplier_partner company.

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Loads every ledger account in this company that Phase 2 may resolve a role
 * to, including inactive and soft-deleted rows so setup can repair them.
 */
async function loadGoldenCoastAccounts(
  tx: DatabaseTransaction | typeof db,
  companyId: number
): Promise<GoldenCoastLedgerRow[]> {
  const rows = await tx
    .select({
      id: ledgerAccounts.id,
      companyId: ledgerAccounts.companyId,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      accountType: ledgerAccounts.accountType,
      subType: ledgerAccounts.subType,
      isHidden: ledgerAccounts.isHidden,
      active: ledgerAccounts.active,
      deletedAt: ledgerAccounts.deletedAt,
    })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        inArray(ledgerAccounts.subType, [...GOLDEN_COAST_PHASE2_LOOKUP_SUBTYPES])
      )
    );

  return rows.map((row) => ({ ...row, id: Number(row.id), companyId: Number(row.companyId) }));
}

/**
 * Every live account name in this company, as name -> id. Provisioning consults
 * it so a rename or insert cannot violate uq_ledger_accounts_company_name_active
 * and abort the transaction.
 */
async function loadCompanyAccountNames(
  tx: DatabaseTransaction | typeof db,
  companyId: number
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));
  return new Map(rows.map((row) => [row.name, Number(row.id)]));
}

async function loadGoldenCoastSettings(
  tx: DatabaseTransaction | typeof db,
  companyId: number
): Promise<GoldenCoastSettingsSnapshot> {
  const [row] = await tx
    .select({
      spPosPayableAccountId: companySettings.spPosPayableAccountId,
      spPosProfitAccountId: companySettings.spPosProfitAccountId,
    })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  return row ?? {};
}

/**
 * Points the company-settings columns that later POS/close phases read at the
 * canonical Phase 2 accounts. Existing rows are updated in place; a company with
 * no settings row yet gets one.
 */
async function bindGoldenCoastSettings(
  tx: DatabaseTransaction,
  companyId: number,
  bindings: Partial<Record<GoldenCoastSettingsKey, number>>
): Promise<GoldenCoastSettingsKey[]> {
  const current = await loadGoldenCoastSettings(tx, companyId);
  const changed: GoldenCoastSettingsKey[] = [];
  const updates: Partial<Record<GoldenCoastSettingsKey, number>> = {};

  for (const [key, accountId] of Object.entries(bindings) as Array<[GoldenCoastSettingsKey, number]>) {
    if (Number(current[key] ?? 0) === Number(accountId)) continue;
    updates[key] = accountId;
    changed.push(key);
  }
  if (changed.length === 0) return changed;

  const [existing] = await tx
    .select({ id: companySettings.id })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (existing) {
    await tx
      .update(companySettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companySettings.companyId, companyId));
  } else {
    await tx.insert(companySettings).values({ companyId, ...updates });
  }

  return changed;
}

async function handleGoldenCoastSetup(req: Request, res: Response): Promise<void> {
  try {
    const companyId = await requireSpCompany(req, res);
    if (!companyId) return;

    const result = await db.transaction(async (tx) => {
      const accounts = await loadGoldenCoastAccounts(tx, companyId);
      const existingNames = await loadCompanyAccountNames(tx, companyId);
      const plan = planGoldenCoastAccountProvisioning({ companyId, accounts, existingNames });

      const created: Array<{ role: string; accountId: number; code: string; name: string }> = [];
      const repaired: Array<{ role: string; accountId: number; fields: string[] }> = [];
      const settingsBindings: Partial<Record<GoldenCoastSettingsKey, number>> = {};

      for (const item of plan.items) {
        if (item.accountId == null) {
          // Reuse the canonical code unless it is already taken in this company,
          // which would violate the (company_id, code) unique index.
          const [clash] = await tx
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, item.code)))
            .limit(1);
          const code = clash ? `${item.code}-${item.subType.slice(-6).toUpperCase()}` : item.code;

          const [inserted] = await tx
            .insert(ledgerAccounts)
            .values({
              companyId,
              code,
              name: item.name,
              accountType: item.accountType,
              subType: item.subType,
              isHidden: !item.requiresVisible,
              active: true,
            })
            .returning({ id: ledgerAccounts.id, code: ledgerAccounts.code, name: ledgerAccounts.name });

          const accountId = Number(inserted.id);
          created.push({ role: item.role, accountId, code: inserted.code, name: inserted.name });
          if (item.settingsKey) settingsBindings[item.settingsKey] = accountId;
          continue;
        }

        if (item.settingsKey) settingsBindings[item.settingsKey] = item.accountId;
        if (item.repairs.length === 0) continue;

        // Field-level, non-destructive repair of an existing account. The row's
        // id — and therefore every historical voucher entry pointing at it — is
        // preserved; only role configuration is rewritten.
        const patch: Record<string, unknown> = {};
        for (const repair of item.repairs) {
          patch[repair.field] = repair.to;
        }
        await tx
          .update(ledgerAccounts)
          .set(patch)
          .where(and(eq(ledgerAccounts.id, item.accountId), eq(ledgerAccounts.companyId, companyId)));

        repaired.push({
          role: item.role,
          accountId: item.accountId,
          fields: item.repairs.map((repair) => repair.field),
        });
      }

      const settingsChanged = await bindGoldenCoastSettings(tx, companyId, settingsBindings);

      const finalAccounts = await loadGoldenCoastAccounts(tx, companyId);
      const finalSettings = await loadGoldenCoastSettings(tx, companyId);
      const finalNames = await loadCompanyAccountNames(tx, companyId);
      const status = summarizeGoldenCoastAccountSetup({
        companyId,
        accounts: finalAccounts,
        settings: finalSettings,
        existingNames: finalNames,
      });

      return { created, repaired, settingsChanged, warnings: plan.warnings, status };
    });

    logger.info("Golden Coast Phase 2 account setup applied", {
      module: "golden-coast-phase2",
      companyId,
      created: result.created.length,
      repaired: result.repaired.length,
      settingsChanged: result.settingsChanged,
    });

    res.json({
      success: true,
      ...result,
      message:
        result.created.length === 0 && result.repaired.length === 0 && result.settingsChanged.length === 0
          ? "Golden Coast accounts already configured"
          : "Golden Coast account setup complete",
    });
  } catch (error: unknown) {
    if (error instanceof GoldenCoastPhase2SetupError) {
      res.status(400).json({ message: error.message, code: "GC_PHASE2_SETUP_INVALID" });
      return;
    }
    logger.error("Golden Coast Phase 2 account setup failed", { error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function handleGoldenCoastSetupStatus(req: Request, res: Response): Promise<void> {
  try {
    const companyId = await requireSpCompany(req, res);
    if (!companyId) return;

    const [accounts, settings, existingNames] = await Promise.all([
      loadGoldenCoastAccounts(db, companyId),
      loadGoldenCoastSettings(db, companyId),
      loadCompanyAccountNames(db, companyId),
    ]);

    res.json(summarizeGoldenCoastAccountSetup({ companyId, accounts, settings, existingNames }));
  } catch (error: unknown) {
    if (error instanceof GoldenCoastPhase2SetupError) {
      res.status(400).json({ message: error.message, code: "GC_PHASE2_SETUP_INVALID" });
      return;
    }
    logger.error("Golden Coast Phase 2 setup status failed", { error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerSpGoldenCoastSetupRoutes(app: Express): void {
  app.post("/api/sp/setup/golden-coast", requireAuth, requireRole("Admin"), (req, res) => {
    void handleGoldenCoastSetup(req, res);
  });
  app.get("/api/sp/setup/golden-coast/status", requireAuth, (req, res) => {
    void handleGoldenCoastSetupStatus(req, res);
  });
}

export { loadGoldenCoastAccounts, loadGoldenCoastSettings, loadCompanyAccountNames };
