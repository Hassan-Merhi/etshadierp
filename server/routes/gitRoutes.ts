import type { Express, Request, Response } from "express";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type WarningCode =
  | "no_open_balance"
  | "credit_overpaid"
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
}

// ─── Container statuses treated as "offloaded / completed" ───────────────────
// These are included in the official FIFO balance allocation.
// All other statuses (OTW, At Port, etc.) go to activePreviewRows.
const OFFLOADED_STATUSES = new Set(["Offloaded", "Closed", "Completed"]);

// ─── FIFO allocation ─────────────────────────────────────────────────────────
// Sort offloaded rows oldest→newest, then walk consuming clearedByPayments.
// Returns three buckets: clearedRows, partialRows (0 or 1), openRows.

function fifoAllocate(
  offloadedRows: ContainerRow[],
  ledgerBalance: number
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
  let toConsume = Math.max(offloadedDutyTotal - ledgerBalance, 0);

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
    })
    .from(containers)
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
  const allLedgerAccts = await db
    .select({
      id: ledgerAccounts.id,
      name: ledgerAccounts.name,
      openingBalance: ledgerAccounts.openingBalance,
      openingBalanceSide: ledgerAccounts.openingBalanceSide,
    })
    .from(ledgerAccounts)
    .where(
      and(eq(ledgerAccounts.companyId, cid), isNull(ledgerAccounts.deletedAt))
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

    let balance = parseFloat(acct.openingBalance || "0");
    if (acct.openingBalanceSide === "Cr") balance = -balance;

    const entries = await db
      .select({
        debitAmount: voucherEntries.debitAmount,
        creditAmount: voucherEntries.creditAmount,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(
        and(
          eq(voucherEntries.ledgerAccountId, accountId),
          eq(vouchers.companyId, cid),
          eq(vouchers.optional, false)
        )
      );

    for (const e of entries) {
      balance += parseFloat(e.debitAmount || "0") - parseFloat(e.creditAmount || "0");
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
        if (ledgerBalance < 0) {
          warnings.push("credit_overpaid");
          clearedRows = offloadedContainers.map((r) => ({
            ...r,
            clearedAmount: r.dutyFee,
            remainingAmount: 0,
            allocationStatus: "Cleared" as AllocStatus,
          }));
          clearedByPayments = offloadedDutyTotal;
          openBalance = ledgerBalance;
        } else if (ledgerBalance === 0) {
          warnings.push("no_open_balance");
          clearedRows = offloadedContainers.map((r) => ({
            ...r,
            clearedAmount: r.dutyFee,
            remainingAmount: 0,
            allocationStatus: "Cleared" as AllocStatus,
          }));
          clearedByPayments = offloadedDutyTotal;
          openBalance = 0;
        } else if (ledgerBalance > offloadedDutyTotal) {
          warnings.push("ledger_exceeds_containers");
          openRows = offloadedContainers.map((r) => ({
            ...r,
            clearedAmount: 0,
            remainingAmount: r.dutyFee,
            allocationStatus: "Open" as AllocStatus,
          }));
          clearedByPayments = 0;
          openBalance = ledgerBalance;
        } else {
          const result = fifoAllocate(offloadedContainers, ledgerBalance);
          clearedRows = result.clearedRows;
          partialRows = result.partialRows;
          openRows = result.openRows;
          clearedByPayments =
            clearedRows.reduce((s, r) => s + r.clearedAmount, 0) +
            partialRows.reduce((s, r) => s + r.clearedAmount, 0);
          openBalance = ledgerBalance;

          const openSum =
            openRows.reduce((s, r) => s + r.remainingAmount, 0) +
            partialRows.reduce((s, r) => s + r.remainingAmount, 0);
          if (Math.abs(openSum - ledgerBalance) > 0.01) {
            warnings.push("allocation_gap");
          }
        }
      }

      const activePreviewRows: PreviewRow[] = activeContainers.map((r) => ({
        id: r.id,
        containerNumber: r.containerNumber,
        companyId: r.companyId,
        numberPlate: r.numberPlate,
        borderDate: r.borderDate,
        transporter: r.transporter,
        location: r.location,
        dutyFee: r.dutyFee,
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
}
