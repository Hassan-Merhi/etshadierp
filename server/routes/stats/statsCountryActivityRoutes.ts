import type { Express } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";

export function registerStatsCountryActivityRoutes(app: Express) {
  /**
   * GET /api/stats/country-activity
   * Returns per-ERP-company, per-day counts of:
   *   - offloaded containers (containers.offload_date)
   *   - purchases created   (purchase_orders.created_at cast to date)
   * for the last `days` calendar days (default 14, max 90).
   *
   * No company filter — returns all ERP companies the authenticated
   * user's session can see (all active ERP companies).
   */
  app.get("/api/stats/country-activity", requireAuth, async (_req: any, res: any) => {
    try {
      const rawDays = parseInt((_req.query.days as string) || "14");
      const days = Math.min(Math.max(rawDays, 1), 90);

      // ── 1. Active ERP companies ──────────────────────────────────────────
      const companiesResult = await pool.query<{
        id: number;
        name: string;
        code: string;
      }>(`
        SELECT id, name, code
        FROM companies
        WHERE company_type = 'erp'
          AND active = true
        ORDER BY name ASC
      `);
      const companies = companiesResult.rows;
      const companyIds = companies.map((c) => c.id);

      if (companyIds.length === 0) {
        return res.json({ companies: [], days });
      }

      // Build a date series for the last N days (most recent first)
      // We use generate_series to ensure days with 0 activity appear.
      const dateSeriesSQL = `
        SELECT gs::date AS day
        FROM generate_series(
          current_date - INTERVAL '${days - 1} days',
          current_date,
          INTERVAL '1 day'
        ) AS gs
        ORDER BY day DESC
      `;

      // ── 2. Offloaded containers per company per day ──────────────────────
      const offloadsResult = await pool.query<{
        company_id: number;
        day: string;
        cnt: string;
      }>(`
        SELECT
          c.company_id,
          c.offload_date::date AS day,
          COUNT(*)::text        AS cnt
        FROM containers c
        WHERE c.company_id = ANY($1::int[])
          AND c.offload_date >= current_date - INTERVAL '${days - 1} days'
          AND c.offload_date IS NOT NULL
        GROUP BY c.company_id, c.offload_date::date
      `, [companyIds]);

      // ── 3. Purchases per company per day ─────────────────────────────────
      const purchasesResult = await pool.query<{
        company_id: number;
        day: string;
        cnt: string;
      }>(`
        SELECT
          po.company_id,
          po.created_at::date AS day,
          COUNT(*)::text       AS cnt
        FROM purchase_orders po
        WHERE po.company_id = ANY($1::int[])
          AND po.created_at >= current_date - INTERVAL '${days - 1} days'
        GROUP BY po.company_id, po.created_at::date
      `, [companyIds]);

      // ── 4. Build per-company lookup maps ─────────────────────────────────
      type DayMap = Map<string, { offloads: number; purchases: number }>;
      const companyDayMap = new Map<number, DayMap>();
      for (const c of companies) {
        companyDayMap.set(c.id, new Map());
      }

      const ensureDay = (companyId: number, day: string) => {
        const m = companyDayMap.get(companyId)!;
        if (!m.has(day)) m.set(day, { offloads: 0, purchases: 0 });
        return m.get(day)!;
      };

      for (const row of offloadsResult.rows) {
        const entry = ensureDay(row.company_id, row.day);
        entry.offloads = parseInt(row.cnt);
      }
      for (const row of purchasesResult.rows) {
        const entry = ensureDay(row.company_id, row.day);
        entry.purchases = parseInt(row.cnt);
      }

      // ── 5. Build date spine (all N days) ────────────────────────────────
      const datesResult = await pool.query<{ day: string }>(dateSeriesSQL);
      const dateSeries = datesResult.rows.map((r) => r.day.substring(0, 10)); // YYYY-MM-DD

      // ── 6. Assemble response ─────────────────────────────────────────────
      const result = companies.map((c) => {
        const dayMap = companyDayMap.get(c.id)!;
        const dailyData = dateSeries.map((day) => {
          const entry = dayMap.get(day) ?? { offloads: 0, purchases: 0 };
          return { date: day, offloads: entry.offloads, purchases: entry.purchases };
        });

        const totalOffloads = dailyData.reduce((s, d) => s + d.offloads, 0);
        const totalPurchases = dailyData.reduce((s, d) => s + d.purchases, 0);

        return {
          id: c.id,
          name: c.name,
          code: c.code,
          totalOffloads,
          totalPurchases,
          days: dailyData,
        };
      });

      // Sort: companies with any activity first
      result.sort((a, b) => {
        const aActive = a.totalOffloads + a.totalPurchases;
        const bActive = b.totalOffloads + b.totalPurchases;
        if (bActive !== aActive) return bActive - aActive;
        return a.name.localeCompare(b.name);
      });

      res.json({ companies: result, days, dateSeries });
    } catch (err: any) {
      console.error("GET /api/stats/country-activity error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch country activity" });
    }
  });
}
