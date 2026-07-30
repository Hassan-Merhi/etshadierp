import type { Express } from "express";
import { requireAuth, requireNonPOS } from "../auth";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { getHistoricalCurrencyReadiness } from "../services/accounting/historicalCurrencyReadiness";
import { getHistoricalCurrencyReconciliation } from "../services/accounting/historicalCurrencyReconciliation";
import {
  applyHistoricalCurrencyRepairPlan,
  automaticRepairInput,
  listHistoricalRepairCases,
  planHistoricalCurrencyRepairs,
  type HistoricalRepairCase,
  type HistoricalRepairInput,
  type HistoricalRepairPlan,
} from "../services/accounting/historicalCurrencyRepairCenter";
import {
  ExpiredRepairTokenError,
  InvalidRepairTokenError,
  REPAIR_TOKEN_TTL_MS,
  RepairTokenConfigurationError,
  signRepairToken,
  verifyRepairToken,
} from "../services/factory/repairToken";

const ALLOWED_ROLES = new Set(["Admin", "Owner", "Developer"]);

interface RepairCenterTokenPayload {
  purpose: "historical-currency-repair-center";
  companyId: number;
  userId: string;
  fingerprint: string;
  itemCount: number;
  expiresAt: number;
}

function requireRepairRole(req: any, res: any): boolean {
  const role = req.session?.currentRole;
  if (!role || !ALLOWED_ROLES.has(role)) {
    res.status(403).json({ message: "Admin, Owner, or Developer access is required" });
    return false;
  }
  return true;
}

function actorFromRequest(req: any): { userId: string; username: string } {
  const userId = String(req.session?.userId ?? req.user?.id ?? "unknown");
  const username = String(req.session?.username ?? req.user?.username ?? userId);
  return { userId, username };
}

function signedPreview(
  actor: { userId: string; username: string },
  plan: HistoricalRepairPlan,
  repairs: HistoricalRepairInput[],
) {
  const expiresAt = Date.now() + REPAIR_TOKEN_TTL_MS;
  const confirmationToken = signRepairToken({
    purpose: "historical-currency-repair-center",
    companyId: plan.companyId,
    userId: actor.userId,
    fingerprint: plan.fingerprint,
    itemCount: plan.itemCount,
    expiresAt,
  } satisfies RepairCenterTokenPayload);
  return {
    dryRun: true,
    writePerformed: false,
    repairs,
    confirmationToken,
    confirmationExpiresAt: new Date(expiresAt).toISOString(),
    plan,
  };
}

function companyFromRequest(req: any, res: any): number | null {
  const companyId = req.session.currentCompanyId;
  if (!companyId) {
    res.status(400).json({ message: "No company selected" });
    return null;
  }
  return companyId;
}

function completeAutomaticRepairs(cases: HistoricalRepairCase[]): HistoricalRepairInput[] {
  const repairs: HistoricalRepairInput[] = [];
  const voucherGroups = new Map<number, HistoricalRepairCase[]>();

  for (const repairCase of cases) {
    if (repairCase.kind === "voucherEntry" && repairCase.voucherId) {
      const group = voucherGroups.get(repairCase.voucherId) || [];
      group.push(repairCase);
      voucherGroups.set(repairCase.voucherId, group);
      continue;
    }
    const input = automaticRepairInput(repairCase);
    if (input) repairs.push(input);
  }

  for (const group of voucherGroups.values()) {
    const inputs = group.map(automaticRepairInput);
    if (inputs.every((input): input is HistoricalRepairInput => input !== null)) {
      repairs.push(...inputs);
    }
  }

  return repairs;
}

export function registerHistoricalCurrencyRepairCenterRoutes(app: Express) {
  app.get(
    "/api/accounts/multi-currency/repair-center",
    requireAuth,
    requireNonPOS,
    async (req: any, res: any) => {
      if (!requireRepairRole(req, res)) return;
      const companyId = companyFromRequest(req, res);
      if (!companyId) return;
      try {
        const [readiness, reconciliation, cases] = await Promise.all([
          getHistoricalCurrencyReadiness(companyId),
          getHistoricalCurrencyReconciliation(companyId),
          listHistoricalRepairCases(companyId),
        ]);
        const automaticRepairs = completeAutomaticRepairs(cases);
        const automaticKeys = new Set(automaticRepairs.map((repair) => `${repair.kind}:${repair.id}`));
        return res.json({
          generatedAt: new Date().toISOString(),
          companyId,
          readiness,
          reconciliation,
          totalCases: cases.length,
          autoRepairableCount: automaticRepairs.length,
          manualReviewCount: cases.filter((repairCase) => !automaticKeys.has(`${repairCase.kind}:${repairCase.id}`)).length,
          cases,
          writePerformed: false,
        });
      } catch (error: unknown) {
        logger.error("Historical currency repair-center diagnostic failed", { error, companyId });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );

  app.get(
    "/api/accounts/multi-currency/repair-center/reconciliation",
    requireAuth,
    requireNonPOS,
    async (req: any, res: any) => {
      if (!requireRepairRole(req, res)) return;
      const companyId = companyFromRequest(req, res);
      if (!companyId) return;
      try {
        return res.json(await getHistoricalCurrencyReconciliation(companyId));
      } catch (error: unknown) {
        logger.error("Historical currency reconciliation failed", { error, companyId });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );

  app.post(
    "/api/accounts/multi-currency/repair-center/auto-plan",
    requireAuth,
    requireNonPOS,
    async (req: any, res: any) => {
      if (!requireRepairRole(req, res)) return;
      const companyId = companyFromRequest(req, res);
      if (!companyId) return;
      try {
        const cases = await listHistoricalRepairCases(companyId);
        const repairs = completeAutomaticRepairs(cases);
        if (repairs.length === 0) {
          return res.status(409).json({
            code: "NO_SAFE_AUTOMATIC_REPAIRS",
            message: "No complete unresolved voucher or opening group has enough persisted evidence for automatic repair. Review the remaining cases manually.",
          });
        }
        const plan = await planHistoricalCurrencyRepairs(companyId, repairs);
        return res.json(signedPreview(actorFromRequest(req), plan, repairs));
      } catch (error: unknown) {
        const status = error instanceof RepairTokenConfigurationError ? 503 : 400;
        return res.status(status).json({ message: getErrorMessage(error) });
      }
    },
  );

  app.post(
    "/api/accounts/multi-currency/repair-center/plan",
    requireAuth,
    requireNonPOS,
    async (req: any, res: any) => {
      if (!requireRepairRole(req, res)) return;
      const companyId = companyFromRequest(req, res);
      if (!companyId) return;
      try {
        const repairs = (req.body?.repairs ?? []) as HistoricalRepairInput[];
        const plan = await planHistoricalCurrencyRepairs(companyId, repairs);
        return res.json(signedPreview(actorFromRequest(req), plan, repairs));
      } catch (error: unknown) {
        const status = error instanceof RepairTokenConfigurationError ? 503 : 400;
        return res.status(status).json({ message: getErrorMessage(error) });
      }
    },
  );

  app.post(
    "/api/accounts/multi-currency/repair-center/apply",
    requireAuth,
    requireNonPOS,
    async (req: any, res: any) => {
      if (!requireRepairRole(req, res)) return;
      const companyId = companyFromRequest(req, res);
      if (!companyId) return;
      try {
        const actor = actorFromRequest(req);
        const token = verifyRepairToken<RepairCenterTokenPayload>(req.body?.confirmationToken);
        if (token.purpose !== "historical-currency-repair-center") {
          throw new InvalidRepairTokenError("wrong repair purpose");
        }
        if (token.companyId !== companyId || token.userId !== actor.userId) {
          throw new InvalidRepairTokenError("company or user mismatch");
        }
        const repairs = (req.body?.repairs ?? []) as HistoricalRepairInput[];
        const plan = await planHistoricalCurrencyRepairs(companyId, repairs);
        if (plan.fingerprint !== token.fingerprint || plan.itemCount !== token.itemCount) {
          return res.status(409).json({
            code: "STALE_REPAIR_PLAN",
            message: "The approved rows or current database state changed after preview. Run the dry-run again.",
          });
        }
        const result = await applyHistoricalCurrencyRepairPlan(plan, actor);
        const [readiness, reconciliation] = await Promise.all([
          getHistoricalCurrencyReadiness(companyId),
          getHistoricalCurrencyReconciliation(companyId),
        ]);
        return res.json({
          dryRun: false,
          writePerformed: true,
          result,
          readiness,
          reconciliation,
        });
      } catch (error: unknown) {
        if (error instanceof InvalidRepairTokenError || error instanceof ExpiredRepairTokenError) {
          return res.status(409).json({ code: "INVALID_REPAIR_CONFIRMATION", message: getErrorMessage(error) });
        }
        if (error instanceof RepairTokenConfigurationError) {
          return res.status(503).json({ message: getErrorMessage(error) });
        }
        const message = getErrorMessage(error);
        const status = /changed after preview|stale|complete batch|unbalanced|incomplete currency metadata/i.test(message)
          ? 409
          : 400;
        logger.error("Historical currency repair-center apply failed", { error, companyId });
        return res.status(status).json({ message });
      }
    },
  );
}
