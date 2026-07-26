import type { Request, Response } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  intercompanyAccountLinks,
  ledgerAccounts,
  userCompanyRoles,
} from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  canManageIntercompanyCompany,
  canManageIntercompanyPair,
  ledgersMatchIntercompanyPair,
  type IntercompanyActorScope,
} from "../services/security/intercompanyConfigurationPolicy";

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function loadActorScope(userId: string): Promise<IntercompanyActorScope> {
  const roles = await db
    .select({ companyId: userCompanyRoles.companyId, role: userCompanyRoles.role })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));
  return {
    isDeveloper: roles.some((row) => row.role === "Developer"),
    companyRoles: new Map(roles.map((row) => [row.companyId, row.role])),
  };
}

async function loadLink(linkId: number) {
  const [link] = await db
    .select()
    .from(intercompanyAccountLinks)
    .where(eq(intercompanyAccountLinks.id, linkId))
    .limit(1);
  return link ?? null;
}

async function ledgersBelongToPair(input: {
  sourceLedgerAccountId: number;
  destLedgerAccountId: number;
  sourceCompanyId: number;
  destCompanyId: number;
}): Promise<boolean> {
  const rows = await db
    .select({ id: ledgerAccounts.id, companyId: ledgerAccounts.companyId })
    .from(ledgerAccounts)
    .where(
      inArray(ledgerAccounts.id, [
        input.sourceLedgerAccountId,
        input.destLedgerAccountId,
      ])
    );
  const companyByLedger = new Map(rows.map((row) => [row.id, row.companyId]));
  return ledgersMatchIntercompanyPair(
    companyByLedger.get(input.sourceLedgerAccountId),
    companyByLedger.get(input.destLedgerAccountId),
    input.sourceCompanyId,
    input.destCompanyId
  );
}

function installLinkFilter(
  res: Response,
  scope: IntercompanyActorScope
): void {
  const originalJson = res.json.bind(res);
  (res as any).json = (body: unknown) => {
    if (!Array.isArray(body)) return originalJson(body);
    return originalJson(
      body.filter((row) =>
        canManageIntercompanyPair(
          scope,
          Number(row?.sourceCompanyId),
          Number(row?.destCompanyId)
        )
      )
    );
  };
}

function deny(
  req: Request,
  res: Response,
  reason: string,
  status = 404,
  message = "Intercompany configuration not found"
): false {
  logger.error(
    JSON.stringify({
      event: "intercompany_configuration_scope_denied",
      ts: new Date().toISOString(),
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      reason,
    })
  );
  res.status(status).json({ message });
  return false;
}

export async function enforceIntercompanyConfigurationScope(
  req: Request,
  res: Response
): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) return true;

  const method = req.method.toUpperCase();
  const path = req.path;
  const isRelevant =
    path === "/api/intercompany-links" ||
    /^\/api\/intercompany-links\/\d+(?:\/recipients)?$/.test(path) ||
    /^\/api\/companies\/\d+\/member-ids$/.test(path);
  if (!isRelevant) return true;

  const scope = await loadActorScope(userId);

  if (method === "GET" && path === "/api/intercompany-links") {
    installLinkFilter(res, scope);
    return true;
  }

  const memberIdsMatch = path.match(/^\/api\/companies\/(\d+)\/member-ids$/);
  if (method === "GET" && memberIdsMatch) {
    const targetCompanyId = Number(memberIdsMatch[1]);
    if (!canManageIntercompanyCompany(scope, targetCompanyId)) {
      return deny(req, res, "MEMBER_LIST_COMPANY_SCOPE_DENIED", 404, "Company not found");
    }
    return true;
  }

  if (method === "POST" && path === "/api/intercompany-links") {
    const sourceCompanyId = positiveId(req.body?.sourceCompanyId);
    const destCompanyId = positiveId(req.body?.destCompanyId);
    const sourceLedgerAccountId = positiveId(req.body?.sourceLedgerAccountId);
    const destLedgerAccountId = positiveId(req.body?.destLedgerAccountId);
    if (
      sourceCompanyId == null ||
      destCompanyId == null ||
      sourceLedgerAccountId == null ||
      destLedgerAccountId == null
    ) {
      return true;
    }

    if (!canManageIntercompanyPair(scope, sourceCompanyId, destCompanyId)) {
      return deny(req, res, "INTERCOMPANY_PAIR_SCOPE_DENIED", 403, "Access denied");
    }
    if (
      !(await ledgersBelongToPair({
        sourceCompanyId,
        destCompanyId,
        sourceLedgerAccountId,
        destLedgerAccountId,
      }))
    ) {
      return deny(req, res, "INTERCOMPANY_LEDGER_SCOPE_DENIED", 400, "Invalid intercompany accounts");
    }
    return true;
  }

  const linkMatch = path.match(/^\/api\/intercompany-links\/(\d+)(?:\/recipients)?$/);
  if (!linkMatch) return true;
  const linkId = Number(linkMatch[1]);
  const link = await loadLink(linkId);
  if (!link) return true;

  const sourceCompanyId = positiveId(req.body?.sourceCompanyId) ?? link.sourceCompanyId;
  const destCompanyId = positiveId(req.body?.destCompanyId) ?? link.destCompanyId;
  if (!canManageIntercompanyPair(scope, sourceCompanyId, destCompanyId)) {
    return deny(req, res, "INTERCOMPANY_LINK_SCOPE_DENIED");
  }

  if (method === "PUT") {
    const sourceLedgerAccountId =
      positiveId(req.body?.sourceLedgerAccountId) ?? link.sourceLedgerAccountId;
    const destLedgerAccountId =
      positiveId(req.body?.destLedgerAccountId) ?? link.destLedgerAccountId;
    if (
      !(await ledgersBelongToPair({
        sourceCompanyId,
        destCompanyId,
        sourceLedgerAccountId,
        destLedgerAccountId,
      }))
    ) {
      return deny(req, res, "INTERCOMPANY_LEDGER_SCOPE_DENIED", 400, "Invalid intercompany accounts");
    }
  }

  return true;
}
