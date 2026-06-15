import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  containers,
  ledgerAccounts,
  voucherEntries,
  vouchers,
  agentDeclarantMappings,
  companies,
  userCompanyRoles,
  suppliers,
  bankAccounts,
} from "../../shared/schema";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import {
  resolveGitCompanyScope,
  fetchActiveContainers,
  loadCompanyNames,
  enrichContainers,
  applyGitFilters,
  buildSummary,
  type GitFilterQuery,
  type EnrichedContainer,
} from "../lib/gitHelpers";

const ALLOWED_EXCEL_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const ALLOWED_EXCEL_EXT = [".xlsx", ".xls"];

const gitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXCEL_MIME.includes(file.mimetype) && ALLOWED_EXCEL_EXT.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
    }
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────

type WarningCode =
  | "no_open_balance"
  | "ledger_exceeds_containers"
  | "allocation_gap"
  | "fuzzy_match"
  | "no_account_linked";

type AllocStatus = "Cleared" | "Partially Cleared" | "Open";

interface ContainerRow {
  id: number;
  containerNumber: string;
  companyId: number;
  numberPlate: string | null;
  offloadDate: string | null;
  borderDate: string | null;
  createdAt: Date;
  transporter: string | null;
  location: string | null;
  dutyFee: number;
  status: string;
  supplierName: string | null;
  supplierCode: string | null;
}

interface AllocatedRow extends ContainerRow {
  clearedAmount: number;
  remainingAmount: number;
  allocationStatus: AllocStatus;
}

interface PreviewRow {
  id: number;
  containerNumber: string;
  companyId: number;
  numberPlate: string | null;
  borderDate: string | null;
  transporter: string | null;
  location: string | null;
  dutyFee: number;
  status: string;
  supplierName: string | null;
  supplierCode: string | null;
}

// ─── Container statuses treated as "offloaded / completed" ───────────────────
// These are included in the official FIFO balance allocation.
// All other statuses (OTW, At Port, etc.) go to activePreviewRows.
// DB stores "OFFLOADED" (all-caps) via storage.offloadContainer; keep both casings.
const OFFLOADED_STATUSES = new Set(["Offloaded", "OFFLOADED", "Closed", "CLOSED", "Completed", "COMPLETED"]);

// ─── FIFO allocation ─────────────────────────────────────────────────────────
// Sort offloaded rows oldest→newest, then walk consuming clearedByPayments.
// Returns three buckets: clearedRows, partialRows (0 or 1), openRows.

// outstanding = amount currently owed to the agent (always a positive number).
// Payments made toward containers = offloadedDutyTotal - outstanding (floored at 0).
// The oldest containers are cleared first (FIFO = first-in-first-out).
function fifoAllocate(
  offloadedRows: ContainerRow[],
  outstanding: number
): {
  clearedRows: AllocatedRow[];
  partialRows: AllocatedRow[];
  openRows: AllocatedRow[];
} {
  const sorted = [...offloadedRows].sort((a, b) => {
    const oA = a.offloadDate ?? "9999-99-99";
    const oB = b.offloadDate ?? "9999-99-99";
    if (oA !== oB) return oA < oB ? -1 : 1;
    const bA = a.borderDate ?? "9999-99-99";
    const bB = b.borderDate ?? "9999-99-99";
    if (bA !== bB) return bA < bB ? -1 : 1;
    const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    if (tA !== tB) return tA - tB;
    return a.id - b.id;
  });

  const offloadedDutyTotal = sorted.reduce((s, r) => s + r.dutyFee, 0);
  // Payments made = total duty – what is still owed. Floored at 0 (can't be negative).
  let toConsume = Math.max(offloadedDutyTotal - outstanding, 0);

  const clearedRows: AllocatedRow[] = [];
  const partialRows: AllocatedRow[] = [];
  const openRows: AllocatedRow[] = [];

  for (const row of sorted) {
    if (toConsume >= row.dutyFee) {
      toConsume -= row.dutyFee;
      clearedRows.push({
        ...row,
        clearedAmount: row.dutyFee,
        remainingAmount: 0,
        allocationStatus: "Cleared",
      });
    } else if (toConsume > 0) {
      const cl = toConsume;
      toConsume = 0;
      partialRows.push({
        ...row,
        clearedAmount: cl,
        remainingAmount: row.dutyFee - cl,
        allocationStatus: "Partially Cleared",
      });
    } else {
      openRows.push({
        ...row,
        clearedAmount: 0,
        remainingAmount: row.dutyFee,
        allocationStatus: "Open",
      });
    }
  }

  return { clearedRows, partialRows, openRows };
}

// ─── Per-company FIFO summary builder ────────────────────────────────────────
// Runs all steps (container fetch → mapping resolution → FIFO allocation)
// for a single company. Called once per company in both single and all-companies
// modes so the logic is never duplicated.
// Read-only: no DB mutations of any kind.

async function buildAgentsForCompany(cid: number) {
  // ── 1. Containers with non-zero duty ──
  const rawContainers = await db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      companyId: containers.companyId,
      numberPlate: containers.numberPlate,
      offloadDate: containers.offloadDate,
      borderDate: containers.borderDate,
      createdAt: containers.createdAt,
      transporter: containers.transporter,
      location: containers.trackingLocation,
      dutyFee: containers.dutyFee,
      agent: containers.agent,
      status: containers.status,
      supplierName: suppliers.legalName,
      supplierCode: suppliers.code,
    })
    .from(containers)
    .leftJoin(suppliers, eq(containers.supplierId, suppliers.id))
    .where(
      and(
        eq(containers.companyId, cid),
        isNotNull(containers.agent),
        isNotNull(containers.dutyFee),
        sql`${containers.agent} <> ''`,
        sql`CAST(${containers.dutyFee} AS NUMERIC) > 0`
      )
    );

  if (rawContainers.length === 0) return [];

  // ── 2. Unique agent names ──
  const uniqueAgents = [
    ...new Set(rawContainers.map((r) => r.agent!.trim()).filter(Boolean)),
  ];

  // ── 3. Active mappings for this company + global (company_id IS NULL) ──
  const allMappings = await db
    .select()
    .from(agentDeclarantMappings)
    .where(
      and(
        eq(agentDeclarantMappings.active, true),
        or(
          eq(agentDeclarantMappings.companyId, cid),
          isNull(agentDeclarantMappings.companyId)
        )
      )
    );

  // ── 4. Ledger accounts for this company ──
  // Also include any account explicitly referenced by the mappings for this company,
  // because an agent may be mapped to an account that lives under a different company ID
  // (e.g. a shared/parent-company agent account).
  const mappedAccountIds = allMappings
    .map((m) => m.ledgerAccountId)
    .filter((id): id is number => id !== null);

  const allLedgerAccts = await db
    .select({
      id: ledgerAccounts.id,
      name: ledgerAccounts.name,
      openingBalance: ledgerAccounts.openingBalance,
      openingBalanceSide: ledgerAccounts.openingBalanceSide,
    })
    .from(ledgerAccounts)
    .where(
      and(
        or(
          eq(ledgerAccounts.companyId, cid),
          mappedAccountIds.length > 0
            ? inArray(ledgerAccounts.id, mappedAccountIds)
            : sql`false`
        ),
        isNull(ledgerAccounts.deletedAt)
      )
    );

  // ── 5. Agent → ledger account resolution ──
  // Priority:
  //   1. Company-specific exact agent_name
  //   2. Company-specific alias
  //   3. Global (company_id IS NULL) exact agent_name
  //   4. Global alias
  //   5. Fuzzy ledger account name (fallback)
  function resolveAgent(agentName: string): {
    accountId: number | null;
    accountName: string | null;
    confidence: "exact" | "fuzzy" | "unmapped";
  } {
    const norm = agentName.trim().toLowerCase();

    const byCompanyName = allMappings.find(
      (m) => m.companyId === cid && m.agentName.trim().toLowerCase() === norm
    );
    if (byCompanyName?.ledgerAccountId) {
      const acc = allLedgerAccts.find((a) => a.id === byCompanyName.ledgerAccountId);
      if (acc) return { accountId: acc.id, accountName: acc.name, confidence: "exact" };
    }

    const byCompanyAlias = allMappings.find(
      (m) =>
        m.companyId === cid &&
        (m.aliases as string[]).some((al) => al.trim().toLowerCase() === norm)
    );
    if (byCompanyAlias?.ledgerAccountId) {
      const acc = allLedgerAccts.find((a) => a.id === byCompanyAlias.ledgerAccountId);
      if (acc) return { accountId: acc.id, accountName: acc.name, confidence: "exact" };
    }

    const byGlobalName = allMappings.find(
      (m) => m.companyId === null && m.agentName.trim().toLowerCase() === norm
    );
    if (byGlobalName?.ledgerAccountId) {
      const acc = allLedgerAccts.find((a) => a.id === byGlobalName.ledgerAccountId);
      if (acc) return { accountId: acc.id, accountName: acc.name, confidence: "exact" };
    }

    const byGlobalAlias = allMappings.find(
      (m) =>
        m.companyId === null &&
        (m.aliases as string[]).some((al) => al.trim().toLowerCase() === norm)
    );
    if (byGlobalAlias?.ledgerAccountId) {
      const acc = allLedgerAccts.find((a) => a.id === byGlobalAlias.ledgerAccountId);
      if (acc) return { accountId: acc.id, accountName: acc.name, confidence: "exact" };
    }

    const fuzzy = allLedgerAccts.find((acc) => {
      const an = acc.name.trim().toLowerCase();
      return an.includes(norm) || norm.includes(an);
    });
    if (fuzzy)
      return { accountId: fuzzy.id, accountName: fuzzy.name, confidence: "fuzzy" };

    return { accountId: null, accountName: null, confidence: "unmapped" };
  }

  // ── 6. Ledger balance for an account ──
  // Dr − Cr movements on top of opening balance (optional=false filters adjustments).
  async function getLedgerBalance(accountId: number): Promise<number> {
    const acct = allLedgerAccts.find((a) => a.id === accountId);
    if (!acct) return 0;

    const rawOB = parseFloat(acct.openingBalance || "0");
    let balance = acct.openingBalanceSide === "Cr" ? -rawOB : rawOB;

    // Ledger voucher entries — no company filter, matches Accounts page behaviour
    const entries = await db
      .select({ debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(
        and(
          eq(voucherEntries.ledgerAccountId, accountId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt)
        )
      );

    for (const e of entries) {
      balance += parseFloat(e.debitAmount || "0") - parseFloat(e.creditAmount || "0");
    }

    // Linked bank accounts — entries stored under bankAccountId, not ledgerAccountId.
    // The Accounts page balance folds these in, so we must too.
    const linkedBanks = await db
      .select({ id: bankAccounts.id, openingBalance: bankAccounts.openingBalance, openingBalanceSide: bankAccounts.openingBalanceSide })
      .from(bankAccounts)
      .where(eq(bankAccounts.linkedLedgerId, accountId));

    for (const bank of linkedBanks) {
      const bOB = parseFloat(bank.openingBalance || "0");
      balance += bank.openingBalanceSide === "Cr" ? -bOB : bOB;

      const bankEntries = await db
        .select({ debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.bankAccountId, bank.id),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt)
          )
        );

      for (const e of bankEntries) {
        balance += parseFloat(e.debitAmount || "0") - parseFloat(e.creditAmount || "0");
      }
    }

    return balance;
  }

  // ── 7. Build per-agent summaries ──
  return Promise.all(
    uniqueAgents.map(async (agentName) => {
      const resolution = resolveAgent(agentName);

      const agentContainers: ContainerRow[] = rawContainers
        .filter((r) => r.agent?.trim() === agentName)
        .map((r) => ({
          id: r.id,
          containerNumber: r.containerNumber,
          companyId: r.companyId,
          numberPlate: r.numberPlate ?? null,
          offloadDate: r.offloadDate ?? null,
          borderDate: r.borderDate ?? null,
          createdAt: r.createdAt,
          transporter: r.transporter ?? null,
          location: r.location ?? null,
          dutyFee: parseFloat(r.dutyFee || "0"),
          status: r.status,
          supplierName: r.supplierName ?? null,
          supplierCode: r.supplierCode ?? null,
        }));

      const offloadedContainers = agentContainers.filter((r) =>
        OFFLOADED_STATUSES.has(r.status)
      );
      const activeContainers = agentContainers.filter(
        (r) => !OFFLOADED_STATUSES.has(r.status)
      );

      const containerDutyTotal = agentContainers.reduce((s, r) => s + r.dutyFee, 0);
      const offloadedDutyTotal = offloadedContainers.reduce((s, r) => s + r.dutyFee, 0);

      let ledgerBalance: number | null = null;
      if (resolution.accountId !== null) {
        ledgerBalance = await getLedgerBalance(resolution.accountId);
      }

      const warnings: WarningCode[] = [];
      if (resolution.confidence === "fuzzy") warnings.push("fuzzy_match");
      if (resolution.confidence === "unmapped") warnings.push("no_account_linked");

      let clearedRows: AllocatedRow[] = [];
      let partialRows: AllocatedRow[] = [];
      let openRows: AllocatedRow[] = [];
      let clearedByPayments = 0;
      let openBalance: number | null = null;

      if (ledgerBalance !== null) {
        // outstanding = how much we currently owe the agent.
        // A negative ledger balance is a Cr-heavy (liability) account — standard AP
        // convention: the company owes the agent that amount.
        // A positive ledger balance means Dr-heavy — same "we owe them" interpretation
        // when duty charges are posted as Debit entries.
        // In both cases |ledgerBalance| is the net outstanding amount.
        const outstanding = Math.abs(ledgerBalance);

        if (outstanding === 0) {
          // Fully settled — zero balance means every duty dollar has been paid.
          warnings.push("no_open_balance");
          clearedRows = offloadedContainers.map((r) => ({
            ...r,
            clearedAmount: r.dutyFee,
            remainingAmount: 0,
            allocationStatus: "Cleared" as AllocStatus,
          }));
          clearedByPayments = offloadedDutyTotal;
          openBalance = 0;
        } else if (outstanding > offloadedDutyTotal) {
          // Outstanding exceeds all offloaded duty — there may be extra charges not yet
          // matched to containers, or no containers have been offloaded yet.
          warnings.push("ledger_exceeds_containers");
          openRows = offloadedContainers.map((r) => ({
            ...r,
            clearedAmount: 0,
            remainingAmount: r.dutyFee,
            allocationStatus: "Open" as AllocStatus,
          }));
          clearedByPayments = 0;
          openBalance = outstanding;
        } else {
          // Partial payment — FIFO: oldest containers are cleared first.
          const result = fifoAllocate(offloadedContainers, outstanding);
          clearedRows = result.clearedRows;
          partialRows = result.partialRows;
          openRows = result.openRows;
          clearedByPayments =
            clearedRows.reduce((s, r) => s + r.clearedAmount, 0) +
            partialRows.reduce((s, r) => s + r.clearedAmount, 0);
          openBalance = outstanding;

          const openSum =
            openRows.reduce((s, r) => s + r.remainingAmount, 0) +
            partialRows.reduce((s, r) => s + r.remainingAmount, 0);
          if (Math.abs(openSum - outstanding) > 0.01) {
            warnings.push("allocation_gap");
          }
        }
      }

      const activePreviewRows: PreviewRow[] = activeContainers.filter((r) => !!(r.numberPlate ?? "").trim()).map((r) => ({
        id: r.id,
        containerNumber: r.containerNumber,
        companyId: r.companyId,
        numberPlate: r.numberPlate,
        borderDate: r.borderDate,
        transporter: r.transporter,
        location: r.location,
        dutyFee: r.dutyFee,
        supplierName: r.supplierName,
        supplierCode: r.supplierCode,
        status: r.status,
      }));

      return {
        agentName,
        ledgerAccountId: resolution.accountId,
        ledgerAccountName: resolution.accountName,
        matchConfidence: resolution.confidence,
        ledgerBalance,
        containerDutyTotal,
        offloadedDutyTotal,
        clearedByPayments,
        openBalance,
        warnings,
        clearedRows,
        partialRows,
        openRows,
        activePreviewRows,
      };
    })
  );
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerGitRoutes(app: Express) {
  /**
   * GET /api/git/agent-duty-summary
   *
   * Returns per-agent FIFO balance allocation for the Agent/Duty report.
   *
   * Access:
   *   Admin / Developer  → any company, any query mode
   *   Owner              → only companies in user_company_roles
   *   Manager / POS / Normal User → 403
   *
   * Query params:
   *   companyId=<n>       single company (Admin/Dev: any; Owner: must have access)
   *   allCompanies=true   all accessible companies, grouped response
   *   (none)              falls back to session company — backward-compatible
   *
   * Response shapes:
   *   mode "single": { asOf, mode, companyId, companyName, agents: [...] }
   *   mode "all":    { asOf, mode, companies: [{ companyId, companyName, agents }] }
   *
   * Read-only. No vouchers, containers, or accounting records are modified.
   */
  app.get(
    "/api/git/agent-duty-summary",
    requireAuth,
    requireRole("Admin", "Owner"),
    async (req, res) => {
      try {
        const sessionCompanyId: number | undefined =
          (req.session as any)?.currentCompanyId;
        const userId: string = (req.user as any).id;
        const role: string = (req.user as any).role;
        const isAdminOrDev = role === "Admin" || role === "Developer";

        const wantsAll = req.query.allCompanies === "true";
        const requestedId = req.query.companyId
          ? parseInt(req.query.companyId as string, 10)
          : undefined;

        const asOf = new Date().toISOString();

        // ── All-companies mode ──────────────────────────────────────────────
        if (wantsAll) {
          let accessibleIds: number[];

          if (isAdminOrDev) {
            // Admin/Dev: all companies that actually have containers with duty
            const rows = await db
              .selectDistinct({ companyId: containers.companyId })
              .from(containers)
              .where(
                and(
                  isNotNull(containers.agent),
                  isNotNull(containers.dutyFee),
                  sql`${containers.agent} <> ''`,
                  sql`CAST(${containers.dutyFee} AS NUMERIC) > 0`
                )
              );
            accessibleIds = rows.map((r) => r.companyId);
          } else {
            // Owner: only their user_company_roles companies
            const roles = await db
              .select({ companyId: userCompanyRoles.companyId })
              .from(userCompanyRoles)
              .where(eq(userCompanyRoles.userId, userId));
            accessibleIds = roles.map((r) => r.companyId);
          }

          if (accessibleIds.length === 0) {
            return res.json({ asOf, mode: "all", companies: [] });
          }

          // Load company names in one query
          const companyRows = await db
            .select({ id: companies.id, name: companies.name })
            .from(companies)
            .where(inArray(companies.id, accessibleIds));
          const nameMap: Record<number, string> = Object.fromEntries(
            companyRows.map((c) => [c.id, c.name])
          );

          // Build each company section in parallel
          const sections = await Promise.all(
            accessibleIds.map(async (cid) => ({
              companyId: cid,
              companyName: nameMap[cid] ?? `Company ${cid}`,
              agents: await buildAgentsForCompany(cid),
            }))
          );

          // Sort by companyId for stable order
          sections.sort((a, b) => a.companyId - b.companyId);

          return res.json({ asOf, mode: "all", companies: sections });
        }

        // ── Single-company mode ────────────────────────────────────────────
        let companyId: number;

        if (requestedId) {
          // Owner: validate they have access to this specific company
          if (!isAdminOrDev) {
            const access = await db
              .select({ id: userCompanyRoles.id })
              .from(userCompanyRoles)
              .where(
                and(
                  eq(userCompanyRoles.userId, userId),
                  eq(userCompanyRoles.companyId, requestedId)
                )
              )
              .limit(1);
            if (access.length === 0) {
              return res
                .status(403)
                .json({ message: "Access denied to this company" });
            }
          }
          companyId = requestedId;
        } else {
          if (!sessionCompanyId) {
            return res.status(400).json({ message: "Company ID required" });
          }
          companyId = sessionCompanyId;
        }

        // Load company name
        const companyRow = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        const companyName = companyRow[0]?.name ?? `Company ${companyId}`;

        const agents = await buildAgentsForCompany(companyId);

        return res.json({ asOf, mode: "single", companyId, companyName, agents });
      } catch (err) {
        console.error("[gitRoutes] agent-duty-summary error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ─── Shared inner helper ────────────────────────────────────────────────────
  // Resolves scope, fetches+enriches active containers, applies query filters,
  // then calls the route-specific shaper function. Read-only: zero mutations.

  async function handleGitListing(
    req: Request,
    res: Response,
    preFilter?: (rows: EnrichedContainer[]) => EnrichedContainer[],
  ): Promise<void> {
    try {
      const userId: string = (req.user as any).id;
      const role: string = (req.user as any).role;
      const sessionCompanyId: number | undefined =
        (req.session as any)?.currentCompanyId;

      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId,
      );
      if ("error" in scope) {
        res.status(scope.status).json({ message: scope.error });
        return;
      }

      const companyIds =
        scope.mode === "all" ? scope.companyIds : [scope.companyId];

      const includeOffloaded = req.query.includeOffloaded === "true";

      const [raw, nameMap] = await Promise.all([
        fetchActiveContainers(companyIds, { includeOffloaded }),
        loadCompanyNames(companyIds),
      ]);

      let enriched = enrichContainers(raw, nameMap);

      // Route-level pre-filter (e.g. at-port, truck-location)
      if (preFilter) enriched = preFilter(enriched);

      // User-supplied query filters
      const filtered = applyGitFilters(enriched, req.query as GitFilterQuery);

      const asOf = new Date().toISOString();

      if (scope.mode === "all") {
        res.json({ asOf, mode: "all", total: filtered.length, containers: filtered });
      } else {
        const companyName = nameMap[scope.companyId] ?? `Company ${scope.companyId}`;
        res.json({
          asOf,
          mode: "single",
          companyId: scope.companyId,
          companyName,
          total: filtered.length,
          containers: filtered,
        });
      }
    } catch (err) {
      console.error("[gitRoutes] listing error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }

  /**
   * GET /api/git/containers
   *
   * All active containers (OTW / Sea / At Port / Left Dar / At Border /
   * In Transit / Arrived) with computed fields attached.
   *
   * Access: Admin / Developer (any company) | Owner (their companies only)
   * Query:  companyId, allCompanies, status, transporter, agent, location,
   *         search/q, docsReady, delayed, overdue
   *
   * Response (single):
   *   { asOf, mode:"single", companyId, companyName, total, containers:[...] }
   * Response (all):
   *   { asOf, mode:"all", total, containers:[...] }
   *
   * Each container includes:
   *   all original DB fields + companyName + maxOffloadDate + daysDelayed
   *   + docsReadyNotSent + isOverdue
   *
   * Read-only. No mutations.
   */
  app.get(
    "/api/git/containers",
    requireAuth,
    requireRole("Admin", "Owner"),
    (req, res) => handleGitListing(req, res),
  );

  /**
   * GET /api/git/summary
   *
   * Aggregate counts over active containers (same scope + filter logic as
   * /api/git/containers, but returns stats instead of raw rows).
   *
   * Response (single):
   *   { asOf, mode:"single", companyId, companyName, summary:{...} }
   * Response (all):
   *   { asOf, mode:"all", summary:{...}, byCompany:[{companyId,companyName,summary}] }
   *
   * summary fields: total, byStatus, delayed, overdue, docsReadyNotSent,
   *                 withTruck, withoutTruck
   *
   * Read-only. No mutations.
   */
  app.get(
    "/api/git/summary",
    requireAuth,
    requireRole("Admin", "Owner"),
    async (req, res) => {
      try {
        const userId: string = (req.user as any).id;
        const role: string = (req.user as any).role;
        const sessionCompanyId: number | undefined =
          (req.session as any)?.currentCompanyId;

        const scope = await resolveGitCompanyScope(
          userId,
          role,
          req.query as Record<string, string | undefined>,
          sessionCompanyId,
        );
        if ("error" in scope) {
          return res.status(scope.status).json({ message: scope.error });
        }

        const companyIds =
          scope.mode === "all" ? scope.companyIds : [scope.companyId];

        const [raw, nameMap] = await Promise.all([
          fetchActiveContainers(companyIds),
          loadCompanyNames(companyIds),
        ]);

        const enriched = enrichContainers(raw, nameMap);
        const filtered = applyGitFilters(enriched, req.query as GitFilterQuery);
        const asOf = new Date().toISOString();

        if (scope.mode === "all") {
          // Overall + per-company breakdown
          const overall = buildSummary(filtered);

          const byCompany = companyIds.map((cid) => ({
            companyId: cid,
            companyName: nameMap[cid] ?? `Company ${cid}`,
            summary: buildSummary(filtered.filter((r) => r.companyId === cid)),
          }));

          return res.json({
            asOf,
            mode: "all",
            summary: overall,
            byCompany,
          });
        }

        const companyName =
          nameMap[scope.companyId] ?? `Company ${scope.companyId}`;
        return res.json({
          asOf,
          mode: "single",
          companyId: scope.companyId,
          companyName,
          summary: buildSummary(filtered),
        });
      } catch (err) {
        console.error("[gitRoutes] summary error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  /**
   * GET /api/git/at-port
   *
   * Active containers whose status is exactly "At Port".
   * All query params from /api/git/containers are supported on top of the
   * pre-filter (e.g. ?agent=NAHLI further narrows within At Port containers).
   *
   * Read-only. No mutations.
   */
  app.get(
    "/api/git/at-port",
    requireAuth,
    requireRole("Admin", "Owner"),
    (req, res) =>
      handleGitListing(req, res, (rows) =>
        rows.filter((r) => r.status === "At Port"),
      ),
  );

  /**
   * GET /api/git/truck-location
   *
   * Active containers that have a truck assigned (numberPlate is set).
   * Useful for real-time fleet positioning view.
   * All query params from /api/git/containers are supported on top.
   *
   * Read-only. No mutations.
   */
  app.get(
    "/api/git/truck-location",
    requireAuth,
    requireRole("Admin", "Owner"),
    (req, res) =>
      handleGitListing(req, res, (rows) =>
        rows.filter((r) => !!(r.numberPlate ?? "").trim()),
      ),
  );

  // ─── ETA-only template (dev) — pre-filled with real container numbers ────

  app.get(
    "/api/git/containers/eta-template.xlsx",
    requireAuth,
    requireRole("Admin", "Owner", "Developer"),
    async (req: any, res: any) => {
      try {
        // Fetch all active containers (non-inactive statuses)
        const rows = await db
          .select({
            containerNumber: containers.containerNumber,
            eta: containers.eta,
            status: containers.status,
            companyName: companies.name,
          })
          .from(containers)
          .leftJoin(companies, eq(containers.companyId, companies.id))
          .where(
            sql`LOWER(${containers.status}) NOT IN ('offloaded','closed','completed')`
          )
          .orderBy(containers.containerNumber);

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("ETA Update");

        // ── Header row ──────────────────────────────────────────────────────
        const headers = ["Container #", "Company", "Status", "Current ETA", "New ETA (YYYY-MM-DD)"];
        const headerRow = ws.addRow(headers);
        headerRow.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
          cell.font = { bold: true, color: { argb: "FFFFFF" }, size: 11 };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        });
        headerRow.height = 28;

        // ── Hint row ────────────────────────────────────────────────────────
        const hintRow = ws.addRow([
          "Used to match — do not edit",
          "",
          "",
          "For reference only",
          "Fill this column to update",
        ]);
        hintRow.eachCell((cell: any) => {
          if (cell.value) {
            cell.font = { italic: true, color: { argb: "888888" }, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F5F5" } };
          }
        });

        // ── Data rows — one per active container ────────────────────────────
        rows.forEach((r, i) => {
          const row = ws.addRow([
            r.containerNumber,
            r.companyName ?? "",
            r.status ?? "",
            r.eta ?? "",
            "", // New ETA — user fills this in
          ]);
          const bg = i % 2 === 0 ? "FFFFFF" : "F0F4FA";
          row.eachCell((cell: any) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          });
          // Highlight the "New ETA" cell so it's obvious what to fill
          const etaCell = row.getCell(5);
          etaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7" } };
          etaCell.font = { bold: true };
        });

        // ── Column widths ───────────────────────────────────────────────────
        [22, 26, 22, 18, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        // ── Freeze header rows ──────────────────────────────────────────────
        ws.views = [{ state: "frozen", ySplit: 2 }];

        const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="eta_update_${today}.xlsx"`);
        const buf = await wb.xlsx.writeBuffer();
        res.send(buf);
      } catch (err: any) {
        console.error("[ETA template]", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ─── Excel import template ────────────────────────────────────────────────

  app.get(
    "/api/git/containers/import-template.xlsx",
    requireAuth,
    requireRole("Admin", "Owner", "Developer"),
    async (req: any, res: any) => {
      try {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Containers");

        const headers = [
          "Container #",
          "Status",
          "Plate / Truck #",
          "ETA (YYYY-MM-DD)",
          "Border Date (YYYY-MM-DD)",
          "Transporter",
          "Location",
          "Agent",
          "Duty Fee",
          "Transport Fee",
          "Freight Status",
          "Docs Received",
          "Docs Sent Date (YYYY-MM-DD)",
          "Tracking Link",
          "Tracking Description",
          "Tracking Enabled",
          "Tracking Carrier Hint",
          "Shop Name",
        ];

        // Header row — dark blue
        const headerRow = ws.addRow(headers);
        headerRow.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
          cell.font = { bold: true, color: { argb: "FFFFFF" }, size: 11 };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          cell.border = {
            bottom: { style: "thin", color: { argb: "FFFFFF" } },
          };
        });
        headerRow.height = 28;

        // Hint row — light grey, italic
        const hints = [
          "Required — used to match",
          "OTW / Sea / At Port / Left Dar / At Border / In Transit / Arrived",
          "e.g. T840 EFX",
          "YYYY-MM-DD",
          "YYYY-MM-DD",
          "",
          "e.g. NAKONDE",
          "",
          "number",
          "number",
          "Yes / No / Pending",
          "Yes / No",
          "YYYY-MM-DD",
          "https://…",
          "",
          "Yes / No — enable ParcelsApp auto-tracking",
          "e.g. MAERSK, MSC, COSCO — leave blank to auto-detect",
          "e.g. ABC SHOP",
        ];
        const hintRow = ws.addRow(hints);
        hintRow.eachCell((cell: any) => {
          if (cell.value) {
            cell.font = { italic: true, color: { argb: "888888" }, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F5F5" } };
          }
        });

        // Example row 1
        const ex1 = ws.addRow([
          "MSKU1234567", "In Transit", "T840 EFX", "2026-05-20", "2026-05-15",
          "FARHAT", "NAKONDE", "NCA", "8500", "1200",
          "Yes", "Yes", "2026-05-10", "",
          "Cleared border — heading inland", "Yes", "MAERSK", "ABC SHOP",
        ]);
        ex1.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7" } };
          cell.font = { italic: true, color: { argb: "5D4037" } };
        });

        // Example row 2
        const ex2 = ws.addRow([
          "TCNU9876543", "At Port", "", "2026-05-25", "",
          "CONTINENTAL", "LEFT DAR", "FARHAT AGENCY", "8500", "",
          "Pending", "No", "", "",
          "Awaiting customs clearance", "No", "", "XYZ STORE",
        ]);
        ex2.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7" } };
          cell.font = { italic: true, color: { argb: "5D4037" } };
        });

        // Add a note in the first example cell
        ex1.getCell(1).font = { bold: true, italic: true, color: { argb: "5D4037" } };
        ex1.getCell(1).note = "Example row — delete before importing";

        // Column widths (18 columns)
        const colWidths = [20, 28, 18, 20, 20, 18, 16, 18, 12, 14, 14, 14, 24, 30, 35, 14, 22, 20];
        colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="container_import_template.xlsx"');
        const buf = await wb.xlsx.writeBuffer();
        res.send(buf);
      } catch (err: any) {
        console.error("[GIT import template]", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ─── Excel bulk import / update ───────────────────────────────────────────

  app.post(
    "/api/git/containers/import-excel",
    requireAuth,
    requireRole("Admin", "Owner", "Developer"),
    (req: Request, res: Response, next: NextFunction) => {
      gitUpload.single("file")(req, res, (err: any) => {
        if (!err) return next();
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: "File too large. Maximum allowed size is 10 MB." });
        }
        return res.status(400).json({ message: err.message || "Invalid file upload." });
      });
    },
    async (req: any, res: any) => {
      try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
        // Prefer a sheet named "Containers" (case-insensitive), fallback to first sheet
        const sheetName =
          workbook.SheetNames.find((n) => n.toLowerCase() === "containers") ??
          workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // No range override — let sheet_to_json use the first row (the real header row) as
        // column names. The hint row (row 2) and the two example rows are caught later by
        // the knownExamples set and the "required / used to match" text check below.
        const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        /** Convert any value to a plain string — handles JS Date objects from Excel */
        function toStr(v: any): string {
          if (v === null || v === undefined) return "";
          if (v instanceof Date) {
            // Format as YYYY-MM-DD in UTC to avoid timezone shifts
            const y = v.getUTCFullYear();
            const m = String(v.getUTCMonth() + 1).padStart(2, "0");
            const d = String(v.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          }
          return String(v).trim();
        }

        /**
         * For optional text fields: treats numeric 0 (Excel blank) as empty string.
         */
        function toOptStr(v: any): string {
          if (v === null || v === undefined || v === 0 || v === "") return "";
          const s = String(v).trim();
          return s === "0" ? "" : s;
        }

        /**
         * Convert a value to a YYYY-MM-DD date string.
         * Handles JS Date objects, properly-formatted strings, AND Excel serial numbers
         * (which appear as plain integers like 46043 when the cell has no date format).
         * Treats 0 / "0" / blank as empty (Excel stores empty date cells as 0).
         */
        function toDateStr(v: any): string {
          // Numeric 0 = blank date cell in Excel
          if (v === null || v === undefined || v === "" || v === 0) return "";
          if (v instanceof Date) {
            const y = v.getUTCFullYear();
            const m = String(v.getUTCMonth() + 1).padStart(2, "0");
            const d = String(v.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          }
          const s = String(v).trim();
          if (!s || s === "0") return "";
          // Already a valid ISO date
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          // Excel serial number (e.g. 46043 → 2026-02-07)
          const n = Number(s);
          if (!isNaN(n) && Number.isInteger(n) && n > 1000 && n < 200000) {
            try {
              const parsed = XLSX.SSF.parse_date_code(n);
              if (parsed && parsed.y > 1900 && parsed.y < 2100) {
                const mm = String(parsed.m).padStart(2, "0");
                const dd = String(parsed.d).padStart(2, "0");
                return `${parsed.y}-${mm}-${dd}`;
              }
            } catch { /* fall through */ }
          }
          return s;
        }

        // Normalise column header → internal key
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const COL: Record<string, string> = {
          container: "containerNumber",
          containerno: "containerNumber",
          containernum: "containerNumber",
          containernumber: "containerNumber",
          status: "status",
          platetruckno: "numberPlate",
          platetruck: "numberPlate",
          plate: "numberPlate",
          numberplate: "numberPlate",
          truck: "numberPlate",
          trucknumber: "numberPlate",
          plateno: "numberPlate",
          eta: "eta",
          etayyyymmdd: "eta",
          borderdate: "borderDate",
          borderdateyyyymmdd: "borderDate",
          transporter: "transporter",
          location: "trackingLocation",
          trackinglocation: "trackingLocation",
          agent: "agent",
          dutyfee: "dutyFee",
          duty: "dutyFee",
          transportfee: "transportFee",
          trackingdescription: "trackingDescription",
          description: "trackingDescription",
          freightstatus: "freightStatus",
          freight: "freightStatus",
          docsreceived: "docReceived",
          docs: "docReceived",
          docreceived: "docReceived",
          documentsreceived: "docReceived",
          docssentdate: "docsSentDate",
          docssentdateyyyymmdd: "docsSentDate",
          docssent: "docsSentDate",
          sentdate: "docsSentDate",
          trackinglink: "trackingLink",
          link: "trackingLink",
          tracklink: "trackingLink",
          trackingenabled: "trackingEnabled",
          autotrackingenabled: "trackingEnabled",
          autotracking: "trackingEnabled",
          tracking: "trackingEnabled",
          trackingon: "trackingEnabled",
          trackon: "trackingEnabled",
          trackingcarrierhint: "trackingCarrierHint",
          carrierhint: "trackingCarrierHint",
          carrier: "trackingCarrierHint",
          shippingline: "trackingCarrierHint",
          shippingcarrier: "trackingCarrierHint",
          shopname: "shopName",
          shop: "shopName",
          store: "shopName",
          storename: "shopName",
          clientshop: "shopName",
        };

        // Status values — stored with exact casing; compare case-insensitively so
        // user input like "otw" or "AT PORT" still works.
        const STATUS_CANONICAL: Record<string, string> = {};
        for (const s of [
          "OTW", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived",
          "Offloaded", "Closed", "Completed",
        ]) {
          STATUS_CANONICAL[s.toLowerCase()] = s;
        }
        const VALID_FREIGHT = new Set(["Yes", "No", "Pending"]);

        // Fetch all containers accessible to this session company
        const allContainers = await db
          .select({ id: containers.id, containerNumber: containers.containerNumber, companyId: containers.companyId })
          .from(containers)
          .where(eq(containers.companyId, req.session.currentCompanyId));

        const byNumber = new Map(allContainers.map((c) => [c.containerNumber.trim().toUpperCase(), c]));

        let updated = 0;
        let skipped = 0;
        let notFound = 0;
        const errors: string[] = [];

        for (let i = 0; i < rawRows.length; i++) {
          const raw = rawRows[i];
          // Sheet row number = 1 (header) + 1 (hint row) + i + 1 (1-based) = i + 3
          const rowNum = i + 3;

          // Build two maps from each raw column:
          //   rawMap  — raw cell value (for date/number fields that need special parsing)
          //   row     — string representation of each mapped field (for text/status fields)
          const rawMap: Record<string, any> = {};
          const row: Record<string, string> = {};
          for (const [rawKey, rawVal] of Object.entries(raw)) {
            const mapped = COL[norm(rawKey)];
            if (mapped) {
              rawMap[mapped] = rawVal;
              row[mapped] = toStr(rawVal);
            }
          }

          // ── Container number is the only required field ──────────────────────
          const ctrNum = row.containerNumber?.trim().toUpperCase() ?? "";

          // Skip blank rows
          if (!ctrNum) { skipped++; continue; }

          // Skip example/hint rows: the template ships with a hint row (row 2) that
          // says "Required — used to match" and two example data rows (MSKU…/TCNU…).
          // Detect any row whose container-number cell is obviously descriptive text.
          const knownExamples = new Set(["MSKU1234567", "TCNU9876543"]);
          if (knownExamples.has(ctrNum)) { skipped++; continue; }
          const lowerCtr = ctrNum.toLowerCase();
          if (
            lowerCtr.includes("required") ||
            lowerCtr.includes("used to match") ||
            lowerCtr.includes("container #") ||
            lowerCtr.includes("yyyy-mm-dd") ||
            lowerCtr.startsWith("e.g")
          ) { skipped++; continue; }

          const match = byNumber.get(ctrNum);
          if (!match) {
            notFound++;
            errors.push(`Row ${rowNum}: "${ctrNum}" not found in system`);
            continue;
          }

          const updateData: Record<string, any> = {};

          // ── Status (optional, case-insensitive) ─────────────────────────────
          const statusVal = toOptStr(rawMap.status);
          if (statusVal) {
            const canonical = STATUS_CANONICAL[statusVal.toLowerCase()];
            if (!canonical) {
              errors.push(`Row ${rowNum} (${ctrNum}): invalid status "${statusVal}" — valid values: ${Object.values(STATUS_CANONICAL).join(", ")}`);
              skipped++;
              continue;
            }
            updateData.status = canonical;
          }

          // ── Optional text fields: 0 / "0" treated as blank ──────────────────
          const numberPlate = toOptStr(rawMap.numberPlate);
          if (numberPlate) updateData.numberPlate = numberPlate;

          const transporter = toOptStr(rawMap.transporter);
          if (transporter) updateData.transporter = transporter;

          const trackingLocation = toOptStr(rawMap.trackingLocation);
          if (trackingLocation) updateData.trackingLocation = trackingLocation;

          const agent = toOptStr(rawMap.agent);
          if (agent) updateData.agent = agent;

          const trackingDescription = toOptStr(rawMap.trackingDescription);
          if (trackingDescription) updateData.trackingDescription = trackingDescription;

          const trackingLink = toOptStr(rawMap.trackingLink);
          if (trackingLink) updateData.trackingLink = trackingLink;

          const trackingCarrierHint = toOptStr(rawMap.trackingCarrierHint);
          if (trackingCarrierHint) updateData.trackingCarrierHint = trackingCarrierHint;

          const shopName = toOptStr(rawMap.shopName);
          if (shopName) updateData.shopName = shopName;

          // ── Date fields: serial numbers + blanks safely handled ──────────────
          const etaDate = toDateStr(rawMap.eta);
          if (etaDate) updateData.eta = etaDate;

          const borderDate = toDateStr(rawMap.borderDate);
          if (borderDate) updateData.borderDate = borderDate;

          const docsSentDate = toDateStr(rawMap.docsSentDate);
          if (docsSentDate) updateData.docsSentDate = docsSentDate;

          // ── Numeric money fields: 0 is a valid value ─────────────────────────
          if (rawMap.dutyFee !== undefined && rawMap.dutyFee !== "") {
            const n = parseFloat(String(rawMap.dutyFee));
            if (!isNaN(n)) updateData.dutyFee = n.toString();
          }
          if (rawMap.transportFee !== undefined && rawMap.transportFee !== "") {
            const n = parseFloat(String(rawMap.transportFee));
            if (!isNaN(n)) updateData.transportFee = n.toString();
          }

          // ── Freight status (optional) ─────────────────────────────────────────
          const freightStatus = toOptStr(rawMap.freightStatus);
          if (freightStatus && VALID_FREIGHT.has(freightStatus)) {
            updateData.freightStatus = freightStatus;
          }

          // ── Docs Received: YES/Y/1/true → true, NO/N/0/false/blank → false ───
          if (rawMap.docReceived !== undefined) {
            const v = String(rawMap.docReceived).trim().toLowerCase();
            if (v === "yes" || v === "y" || v === "true" || v === "1") {
              updateData.docReceived = true;
            } else if (v === "no" || v === "n" || v === "false" || v === "0" || v === "") {
              updateData.docReceived = false;
            }
          }

          // ── Tracking enabled ─────────────────────────────────────────────────
          if (rawMap.trackingEnabled !== undefined && rawMap.trackingEnabled !== "") {
            const v = String(rawMap.trackingEnabled).trim().toLowerCase();
            if (v === "yes" || v === "y" || v === "true" || v === "1" || v === "on") {
              updateData.trackingEnabled = true;
            } else if (v === "no" || v === "n" || v === "false" || v === "0" || v === "off") {
              updateData.trackingEnabled = false;
            }
          }

          // When ETA is set via import, mark it as manual so ParcelsApp doesn't overwrite it immediately
          if (updateData.eta) updateData.etaSource = "manual";

          if (Object.keys(updateData).length === 0) {
            errors.push(`Row ${rowNum} (${ctrNum}): no fields to update — fill in at least one column besides Container # (Status, ETA, Location, etc.)`);
            skipped++;
            continue;
          }

          await db.update(containers).set(updateData).where(eq(containers.id, match.id));
          updated++;
        }

        res.json({ updated, skipped, notFound, errors });
      } catch (err: any) {
        console.error("[GIT import excel]", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── Stock Transfer WhatsApp Settings ────────────────────────────────────────

  app.get("/api/git/transfer-wa-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getAllCompanyTransferWaSettings, getWaSettings } = await import("../services/whatsappService");
      const [companies, main] = await Promise.all([getAllCompanyTransferWaSettings(), getWaSettings()]);
      res.json({
        companies,
        hasCredentials: !!(main?.instanceId && main?.apiToken),
        waEnabled:      main?.enabled ?? false,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/git/transfer-wa-settings/:companyId", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req: Request, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid companyId" });
      const { groupChatId = "" } = req.body;
      const { setCompanyTransferWaGroupChatId } = await import("../services/whatsappService");
      await setCompanyTransferWaGroupChatId(companyId, String(groupChatId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Agent Duty WhatsApp Settings ─────────────────────────────────────────────

  app.get("/api/git/agent-duty-wa-settings", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getAgentDutyWaCredentials, getWaSettings } = await import("../services/whatsappService");
      const [settings, main] = await Promise.all([getAgentDutyWaCredentials(), getWaSettings()]);
      res.json({
        groups:         settings?.groups ?? {},
        hasCredentials: !!(main?.instanceId && main?.apiToken),
        waEnabled:      main?.enabled ?? false,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/git/agent-duty-wa-settings", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req: Request, res: Response) => {
    try {
      const { groups = {} } = req.body;
      const { updateAgentDutyWaGroups } = await import("../services/whatsappService");
      await updateAgentDutyWaGroups(groups);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/git/send-agent-duty-whatsapp", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req: Request, res: Response) => {
    try {
      const { imageBase64, agentName, fileName } = req.body ?? {};
      if (!imageBase64 || !agentName) {
        return res.status(400).json({ message: "imageBase64 and agentName are required." });
      }
      const { getAgentDutyWaCredentials, sendWhatsAppFileToChatId } = await import("../services/whatsappService");
      const settings = await getAgentDutyWaCredentials();
      if (!settings) return res.status(400).json({ message: "WhatsApp not configured." });
      const groupChatId = settings.groups[agentName] ?? settings.groups[agentName.toLowerCase()] ?? null;
      if (!groupChatId) {
        return res.status(400).json({ message: `No WhatsApp group configured for agent "${agentName}". Configure it in Settings → Agent Duty WA.` });
      }
      if (!settings.instanceId || !settings.apiToken) {
        return res.status(400).json({ message: "WhatsApp credentials not configured." });
      }
      if (!settings.enabled) {
        return res.status(400).json({ message: "WhatsApp sending is disabled." });
      }
      const base64Data = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const today = new Date().toISOString().substring(0, 10);
      const finalFileName = String(fileName || `AgentDuty_${agentName}_${today}.png`);
      const caption = "";
      const result = await sendWhatsAppFileToChatId(groupChatId, buffer, finalFileName, caption, "image/png");
      if (!result.success) return res.status(500).json({ message: result.error || "Failed to send" });
      res.json({ ok: true, message: `Sent to WhatsApp group for ${agentName}.` });
    } catch (err: any) {
      console.error("[AgentDutyWA] send error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Containers WhatsApp Settings ────────────────────────────────────────────

  app.get("/api/git/containers-wa-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getContainersWaSettings, getWaSettings } = await import("../services/whatsappService");
      const [settings, main] = await Promise.all([getContainersWaSettings(), getWaSettings()]);
      res.json({
        groupChatId:     settings?.groupChatId     ?? "",
        scheduleEnabled: settings?.scheduleEnabled ?? false,
        scheduleHour:    settings?.scheduleHour    ?? 8,
        lastSentAt:      settings?.lastSentAt      ?? null,
        hasCredentials:  !!(main?.instanceId && main?.apiToken),
        waEnabled:       main?.enabled             ?? false,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/git/containers-wa-settings", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req: Request, res: Response) => {
    try {
      const { groupChatId = "", scheduleEnabled = false, scheduleHour = 8 } = req.body;
      const { updateContainersWaSettings } = await import("../services/whatsappService");
      await updateContainersWaSettings(String(groupChatId), Boolean(scheduleEnabled), Number(scheduleHour));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Send containers table to WhatsApp ───────────────────────────────────────

  app.post("/api/git/send-containers-whatsapp", requireAuth, requireRole("Admin", "Developer", "Owner"), async (req: Request, res: Response) => {
    try {
      const { imageBase64, fileName } = req.body ?? {};
      const { getContainersWaSettings, sendWhatsAppFileToChatId } = await import("../services/whatsappService");
      const settings = await getContainersWaSettings();

      if (!settings?.groupChatId) {
        return res.status(400).json({ message: "No WhatsApp group configured. Go to Settings → Containers WhatsApp to configure it." });
      }
      if (!settings.instanceId || !settings.apiToken) {
        return res.status(400).json({ message: "WhatsApp credentials not configured." });
      }
      if (!settings.enabled) {
        return res.status(400).json({ message: "WhatsApp sending is disabled." });
      }

      let buffer: Buffer;
      let finalFileName: string;
      let mimeType: string;
      const today = new Date().toISOString().substring(0, 10);

      if (imageBase64) {
        const base64Data = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");
        buffer       = Buffer.from(base64Data, "base64");
        finalFileName = String(fileName || `Containers_${today}.png`);
        mimeType      = "image/png";
      } else {
        const { generateContainersPdf } = await import("../helpers/generateContainersPdf");
        const pdf    = await generateContainersPdf();
        buffer       = pdf.buffer;
        finalFileName = `Containers_${today}.pdf`;
        mimeType      = "application/pdf";
      }

      const caption = "";
      const result  = await sendWhatsAppFileToChatId(settings.groupChatId, buffer, finalFileName, caption, mimeType);
      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send" });
      }
      res.json({ ok: true, message: "Sent to WhatsApp group." });
    } catch (err: any) {
      console.error("[ContainersWA] send error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Agent notes (per-company, per-agent, shared across all users) ─────────
  app.get("/api/git/agent-note/:companyId/:agentName", requireAuth, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      const agentName = req.params.agentName;
      const row = await db.execute(
        sql`SELECT note FROM git_agent_notes WHERE company_id = ${companyId} AND agent_name = ${agentName} LIMIT 1`
      );
      const note = (row.rows[0] as any)?.note ?? "";
      res.json({ note });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/git/agent-note/:companyId/:agentName", requireAuth, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      const agentName = req.params.agentName;
      const note: string = (req.body.note ?? "").trim();
      await db.execute(
        sql`INSERT INTO git_agent_notes (company_id, agent_name, note, updated_at)
            VALUES (${companyId}, ${agentName}, ${note}, now())
            ON CONFLICT (company_id, agent_name) DO UPDATE SET note = ${note}, updated_at = now()`
      );
      res.json({ ok: true, note });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Agent manual adjustment entries (per-company, per-agent) ──────────────
  app.get("/api/git/agent-adjustments/:companyId/:agentName", requireAuth, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      const agentName = req.params.agentName;
      const result = await db.execute(
        sql`SELECT id, description, amount, type, created_at
            FROM git_agent_adjustments
            WHERE company_id = ${companyId} AND agent_name = ${agentName}
            ORDER BY created_at ASC`
      );
      res.json(result.rows.map((r: any) => ({
        id: r.id,
        description: r.description,
        amount: parseFloat(r.amount),
        type: r.type,
        createdAt: r.created_at,
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/git/agent-adjustments/:companyId/:agentName", requireAuth, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      const agentName = req.params.agentName;
      const description: string = (req.body.description ?? "").trim();
      const amount = parseFloat(req.body.amount);
      const type: string = req.body.type;
      if (!description) return res.status(400).json({ message: "Description is required." });
      if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: "Amount must be a positive number." });
      if (!["debit", "credit"].includes(type)) return res.status(400).json({ message: "Type must be 'debit' or 'credit'." });
      const result = await db.execute(
        sql`INSERT INTO git_agent_adjustments (company_id, agent_name, description, amount, type)
            VALUES (${companyId}, ${agentName}, ${description}, ${amount}, ${type})
            RETURNING id, description, amount, type, created_at`
      );
      const r = result.rows[0] as any;
      res.json({ id: r.id, description: r.description, amount: parseFloat(r.amount), type: r.type, createdAt: r.created_at });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/git/agent-adjustments/:companyId/:agentName/:id", requireAuth, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      const agentName = req.params.agentName;
      const id = parseInt(req.params.id, 10);
      await db.execute(
        sql`DELETE FROM git_agent_adjustments
            WHERE id = ${id} AND company_id = ${companyId} AND agent_name = ${agentName}`
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
