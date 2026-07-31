/**
 * GIT routes - Read-only GIT reports: agent/duty balances, container lists, summaries, at-port and truck location.
 *
 * Registered by ./index.ts in the same order as the original single file;
 * Express resolves first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth, requireRole } from "../../auth";
import { containers, companies, userCompanyRoles } from "../../../shared/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  resolveGitCompanyScope,
  fetchActiveContainers,
  loadCompanyNames,
  enrichContainers,
  applyGitFilters,
  buildSummary,
} from "../../lib/gitHelpers";
import type { GitFilterQuery, EnrichedContainer } from "../../lib/gitHelpers";
import { buildAgentsForCompany } from "./_helpers";

export function registerGitReportRoutes(app: Express) {
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
  app.get("/api/git/agent-duty-summary", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;
      const userId: string = (req.user as any).id;
      const role: string = (req.user as any).role;
      const isAdminOrDev = role === "Admin" || role === "Developer";

      const wantsAll = req.query.allCompanies === "true";
      const requestedId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : undefined;

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
        const nameMap: Record<number, string> = Object.fromEntries(companyRows.map((c) => [c.id, c.name]));

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
            .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, requestedId)))
            .limit(1);
          if (access.length === 0) {
            return res.status(403).json({ message: "Access denied to this company" });
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
      logger.error("[gitRoutes] agent-duty-summary error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Shared inner helper ────────────────────────────────────────────────────
  // Resolves scope, fetches+enriches active containers, applies query filters,
  // then calls the route-specific shaper function. Read-only: zero mutations.

  async function handleGitListing(
    req: Request,
    res: Response,
    preFilter?: (rows: EnrichedContainer[]) => EnrichedContainer[]
  ): Promise<void> {
    try {
      const userId: string = (req.user as any).id;
      const role: string = (req.user as any).role;
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;

      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId
      );
      if ("error" in scope) {
        res.status(scope.status).json({ message: scope.error });
        return;
      }

      const companyIds = scope.mode === "all" ? scope.companyIds : [scope.companyId];

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
      logger.error("[gitRoutes] listing error:", { error: err });
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
  app.get("/api/git/containers", requireAuth, requireRole("Admin", "Owner"), (req, res) => handleGitListing(req, res));

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
  app.get("/api/git/summary", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const userId: string = (req.user as any).id;
      const role: string = (req.user as any).role;
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;

      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId
      );
      if ("error" in scope) {
        return res.status(scope.status).json({ message: scope.error });
      }

      const companyIds = scope.mode === "all" ? scope.companyIds : [scope.companyId];

      const [raw, nameMap] = await Promise.all([fetchActiveContainers(companyIds), loadCompanyNames(companyIds)]);

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

      const companyName = nameMap[scope.companyId] ?? `Company ${scope.companyId}`;
      return res.json({
        asOf,
        mode: "single",
        companyId: scope.companyId,
        companyName,
        summary: buildSummary(filtered),
      });
    } catch (err) {
      logger.error("[gitRoutes] summary error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  /**
   * GET /api/git/at-port
   *
   * Active containers whose status is exactly "At Port".
   * All query params from /api/git/containers are supported on top of the
   * pre-filter (e.g. ?agent=NAHLI further narrows within At Port containers).
   *
   * Read-only. No mutations.
   */
  app.get("/api/git/at-port", requireAuth, requireRole("Admin", "Owner"), (req, res) =>
    handleGitListing(req, res, (rows) => rows.filter((r) => r.status === "At Port"))
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
  app.get("/api/git/truck-location", requireAuth, requireRole("Admin", "Owner"), (req, res) =>
    handleGitListing(req, res, (rows) => rows.filter((r) => !!(r.numberPlate ?? "").trim()))
  );
}
