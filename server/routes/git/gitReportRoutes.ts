/**
 * GIT routes - Read-only GIT reports: agent/duty balances, container lists, summaries, at-port and truck location.
 *
 * Registered by ./index.ts in the same order as the original single file;
 * Express resolves first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { logger } from "../../lib/logger";
import { requireAuth, requireRole } from "../../auth";
import {
  resolveGitCompanyScope,
  fetchActiveContainers,
  loadCompanyNames,
  enrichContainers,
  applyGitFilters,
  buildSummary,
} from "../../lib/gitHelpers";
import type { GitFilterQuery, EnrichedContainer } from "../../lib/gitHelpers";
import {
  applyGitTableFilters,
  buildGitFacets,
  buildGitTableSummary,
  parseGitPagination,
  sortGitRows,
  toGitCompactRow,
  type GitListingQuery,
} from "./gitListingProfiles";
import { buildAgentsForCompany } from "./_helpers";

export function registerGitReportRoutes(app: Express) {
  /**
   * GET /api/git/agent-duty-summary
   *
   * Returns per-agent FIFO balance allocation for the Agent/Duty report.
   *
   * Access:
   *   Admin / Owner / Developer → explicitly assigned companies only
   *   Owner              → only companies in user_company_roles
   *   Manager / POS / Normal User → 403
   *
   * Query params:
   *   companyId=<n>       single explicitly assigned company
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
      const userId = String((req.user as any).id);
      const role = String((req.session as any)?.currentRole ?? (req.user as any).role ?? "");
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;
      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | string[] | undefined>,
        sessionCompanyId,
      );
      if ("error" in scope) {
        return res.status(scope.status).json({ message: scope.error, code: scope.code });
      }

      const asOf = new Date().toISOString();
      if (scope.mode === "all") {
        const nameMap = await loadCompanyNames(scope.companyIds);
        const sections = await Promise.all(
          scope.companyIds.map(async (companyId) => ({
            companyId,
            companyName: nameMap[companyId] ?? `Company ${companyId}`,
            agents: await buildAgentsForCompany(companyId),
          })),
        );
        sections.sort((left, right) => left.companyId - right.companyId);
        return res.json({ asOf, mode: "all", companies: sections });
      }

      const nameMap = await loadCompanyNames([scope.companyId]);
      return res.json({
        asOf,
        mode: "single",
        companyId: scope.companyId,
        companyName: nameMap[scope.companyId] ?? `Company ${scope.companyId}`,
        agents: await buildAgentsForCompany(scope.companyId),
      });
    } catch (err) {
      logger.error("[gitRoutes] agent-duty-summary error:", { error: err });
      return res.status(500).json({ message: "Internal server error", code: "GIT_REPORT_FAILED" });
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
      const role = String((req.session as any)?.currentRole ?? (req.user as any).role ?? "");
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;

      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId
      );
      if ("error" in scope) {
        res.status(scope.status).json({ message: scope.error, code: scope.code });
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

      const listingQuery = req.query as GitListingQuery;
      const facets = buildGitFacets(enriched);
      const filtered = sortGitRows(applyGitTableFilters(enriched, listingQuery), listingQuery.sort);
      const summary = buildGitTableSummary(filtered);
      const explicitFull = listingQuery.all === "true" || listingQuery.profile === "full";
      const { page, pageSize } = parseGitPagination(listingQuery);
      const totalPages = filtered.length === 0 ? 0 : Math.ceil(filtered.length / pageSize);
      const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
      const safeOffset = (safePage - 1) * pageSize;
      const selectedRows = explicitFull ? filtered : filtered.slice(safeOffset, safeOffset + pageSize);
      const containers = explicitFull ? selectedRows : selectedRows.map(toGitCompactRow);
      const asOf = new Date().toISOString();
      const pageMeta = explicitFull
        ? { page: 1, pageSize: filtered.length, totalPages: filtered.length > 0 ? 1 : 0, hasMore: false }
        : { page: safePage, pageSize, totalPages, hasMore: safePage < totalPages };

      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
      if (scope.mode === "all") {
        res.json({
          asOf,
          mode: "all",
          total: filtered.length,
          containers,
          facets,
          summary,
          ...pageMeta,
        });
      } else {
        const companyName = nameMap[scope.companyId] ?? `Company ${scope.companyId}`;
        res.json({
          asOf,
          mode: "single",
          companyId: scope.companyId,
          companyName,
          total: filtered.length,
          containers,
          facets,
          summary,
          ...pageMeta,
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
   * Access: Admin / Owner / Developer, restricted to explicit company memberships
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


  app.get("/api/git/containers/:id", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const containerId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(containerId) || containerId <= 0) {
        return res.status(400).json({ message: "Invalid container ID" });
      }
      const userId: string = (req.user as any).id;
      const role = String((req.session as any)?.currentRole ?? (req.user as any).role ?? "");
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;
      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId
      );
      if ("error" in scope) return res.status(scope.status).json({ message: scope.error, code: scope.code });
      const companyIds = scope.mode === "all" ? scope.companyIds : [scope.companyId];
      const [rows, nameMap] = await Promise.all([
        fetchActiveContainers(companyIds, { includeOffloaded: true, containerId }),
        loadCompanyNames(companyIds),
      ]);
      const container = enrichContainers(rows, nameMap)[0];
      if (!container) return res.status(404).json({ message: "Container not found" });
      res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=15");
      return res.json(container);
    } catch (err) {
      logger.error("[gitRoutes] container detail error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

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
      const role = String((req.session as any)?.currentRole ?? (req.user as any).role ?? "");
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;

      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId
      );
      if ("error" in scope) {
        return res.status(scope.status).json({ message: scope.error, code: scope.code });
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
