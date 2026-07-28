import type { NextFunction, Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { ledgerAccounts } from "@shared/schema";

function selectedCompanyId(req: Request): number | null {
  const session = req.session as any;
  const raw = session?.factoryCompanyId ?? session?.currentCompanyId;
  const companyId = Number(raw);
  return Number.isInteger(companyId) && companyId > 0 ? companyId : null;
}

function requestedLedgerIds(body: unknown): number[] {
  if (!body || typeof body !== "object") return [];
  const payload = body as Record<string, unknown>;
  const candidates: unknown[] = [payload.ledgerAccountId];
  if (Array.isArray(payload.charges)) {
    for (const charge of payload.charges) {
      if (charge && typeof charge === "object") {
        candidates.push((charge as Record<string, unknown>).ledgerAccountId);
      }
    }
  }

  return [
    ...new Set(
      candidates
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    ),
  ];
}

export async function requirePostOffloadLedgerOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const isCreate = req.method === "POST" && /^\/\d+\/post-offload-charges\/?$/.test(req.path);
  const isEdit = req.method === "PATCH" && /^\/\d+\/post-offload-charges\/\d+\/?$/.test(req.path);
  if (!isCreate && !isEdit) return next();

  const companyId = selectedCompanyId(req);
  if (!companyId) {
    res.status(400).json({ message: "No company selected" });
    return;
  }

  const ledgerIds = requestedLedgerIds(req.body);
  if (ledgerIds.length === 0) return next();

  const ownedRows = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        inArray(ledgerAccounts.id, ledgerIds),
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    );
  const ownedIds = new Set(ownedRows.map((row) => row.id));
  const invalidIds = ledgerIds.filter((id) => !ownedIds.has(id));
  if (invalidIds.length > 0) {
    res.status(400).json({
      message: "Post-offload ledger account must belong to the selected factory company",
      code: "POST_OFFLOAD_LEDGER_COMPANY_MISMATCH",
    });
    return;
  }

  next();
}
