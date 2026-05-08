import type { Express } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  containers,
  ledgerAccounts,
  voucherEntries,
  vouchers,
  agentDeclarantMappings,
} from "../../shared/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

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

// ─── Route registration ───────────────────────────────────────────────────────

export function registerGitRoutes(app: Express) {
  /**
   * GET /api/git/agent-duty-summary
   *
   * Returns per-agent FIFO balance allocation for the Agent/Duty report.
   * Access: Admin, Owner, Developer only.
   * Manager, POS, Normal User → 403.
   *
   * Query params:
   *   companyId (optional, Admin/Developer only — falls back to session company)
   *
   * Read-only. No vouchers, containers, or accounting records are modified.
   */
  app.get(
    "/api/git/agent-duty-summary",
    requireAuth,
    requireRole("Admin", "Owner"),
    async (req, res) => {
      try {
        const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;
        const isAdminOrDev =
          req.user?.role === "Admin" || req.user?.role === "Developer";
        const requestedId = req.query.companyId
          ? parseInt(req.query.companyId as string, 10)
          : undefined;
        const companyId =
          isAdminOrDev && requestedId ? requestedId : sessionCompanyId;

        if (!companyId) {
          return res.status(400).json({ message: "Company ID required" });
        }

        const asOf = new Date().toISOString();

        // ── 1. Fetch all containers for this company with a non-null/non-zero duty fee ──
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
              eq(containers.companyId, companyId),
              isNotNull(containers.agent),
              isNotNull(containers.dutyFee),
              sql`${containers.agent} <> ''`,
              sql`CAST(${containers.dutyFee} AS NUMERIC) > 0`
            )
          );

        if (rawContainers.length === 0) {
          return res.json({ asOf, agents: [] });
        }

        // ── 2. Unique agent names ──
        const uniqueAgents = [
          ...new Set(rawContainers.map((r) => r.agent!.trim()).filter(Boolean)),
        ];

        // ── 3. Load active mapping records ──
        const allMappings = await db
          .select()
          .from(agentDeclarantMappings)
          .where(eq(agentDeclarantMappings.active, true));

        // ── 4. Load all ledger accounts for this company (non-deleted) ──
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
              eq(ledgerAccounts.companyId, companyId),
              isNull(ledgerAccounts.deletedAt)
            )
          );

        // ── 5. Agent → ledger account resolution ──
        // Priority: exact mapping name → alias → fuzzy account name match
        function resolveAgent(agentName: string): {
          accountId: number | null;
          accountName: string | null;
          confidence: "exact" | "fuzzy" | "unmapped";
        } {
          const norm = agentName.trim().toLowerCase();

          // Pass 1 — exact agent_name in mappings
          const byName = allMappings.find(
            (m) => m.agentName.trim().toLowerCase() === norm
          );
          if (byName?.ledgerAccountId) {
            const acc = allLedgerAccts.find((a) => a.id === byName.ledgerAccountId);
            if (acc)
              return { accountId: acc.id, accountName: acc.name, confidence: "exact" };
          }

          // Pass 2 — alias match
          const byAlias = allMappings.find((m) =>
            (m.aliases as string[]).some(
              (al) => al.trim().toLowerCase() === norm
            )
          );
          if (byAlias?.ledgerAccountId) {
            const acc = allLedgerAccts.find((a) => a.id === byAlias.ledgerAccountId);
            if (acc)
              return { accountId: acc.id, accountName: acc.name, confidence: "exact" };
          }

          // Pass 3 — fuzzy match on ledger account name
          const fuzzy = allLedgerAccts.find((acc) => {
            const an = acc.name.trim().toLowerCase();
            return an.includes(norm) || norm.includes(an);
          });
          if (fuzzy)
            return {
              accountId: fuzzy.id,
              accountName: fuzzy.name,
              confidence: "fuzzy",
            };

          return { accountId: null, accountName: null, confidence: "unmapped" };
        }

        // ── 6. Ledger balance for a given account ──
        // Pattern mirrors the existing reports route balance calculation.
        // Dr entries increase the balance, Cr entries decrease it.
        // optional = false filters out system/adjustment vouchers.
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
                eq(vouchers.companyId, companyId),
                eq(vouchers.optional, false)
              )
            );

          for (const e of entries) {
            balance +=
              parseFloat(e.debitAmount || "0") -
              parseFloat(e.creditAmount || "0");
          }

          return balance;
        }

        // ── 7. Build per-agent summary ──
        const agents = await Promise.all(
          uniqueAgents.map(async (agentName) => {
            const resolution = resolveAgent(agentName);

            // All containers for this agent
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

            const containerDutyTotal = agentContainers.reduce(
              (s, r) => s + r.dutyFee,
              0
            );
            const offloadedDutyTotal = offloadedContainers.reduce(
              (s, r) => s + r.dutyFee,
              0
            );

            // Ledger balance
            let ledgerBalance: number | null = null;
            if (resolution.accountId !== null) {
              ledgerBalance = await getLedgerBalance(resolution.accountId);
            }

            // Warnings
            const warnings: WarningCode[] = [];
            if (resolution.confidence === "fuzzy") warnings.push("fuzzy_match");
            if (resolution.confidence === "unmapped")
              warnings.push("no_account_linked");

            // FIFO allocation
            let clearedRows: AllocatedRow[] = [];
            let partialRows: AllocatedRow[] = [];
            let openRows: AllocatedRow[] = [];
            let clearedByPayments = 0;
            let openBalance: number | null = null;

            if (ledgerBalance !== null) {
              if (ledgerBalance < 0) {
                warnings.push("credit_overpaid");
                // No allocation walk for negative balance
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
                // Normal FIFO path
                const result = fifoAllocate(offloadedContainers, ledgerBalance);
                clearedRows = result.clearedRows;
                partialRows = result.partialRows;
                openRows = result.openRows;
                clearedByPayments =
                  clearedRows.reduce((s, r) => s + r.clearedAmount, 0) +
                  partialRows.reduce((s, r) => s + r.clearedAmount, 0);
                openBalance = ledgerBalance;

                // Sanity check: sum of remaining should equal ledger balance
                const openSum =
                  openRows.reduce((s, r) => s + r.remainingAmount, 0) +
                  partialRows.reduce((s, r) => s + r.remainingAmount, 0);
                if (Math.abs(openSum - ledgerBalance) > 0.01) {
                  warnings.push("allocation_gap");
                }
              }
            }

            const activePreviewRows: PreviewRow[] = activeContainers.map(
              (r) => ({
                id: r.id,
                containerNumber: r.containerNumber,
                companyId: r.companyId,
                numberPlate: r.numberPlate,
                borderDate: r.borderDate,
                transporter: r.transporter,
                location: r.location,
                dutyFee: r.dutyFee,
                status: r.status,
              })
            );

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
              asOf,
            };
          })
        );

        return res.json({ asOf, agents });
      } catch (err) {
        console.error("[gitRoutes] agent-duty-summary error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );
}
