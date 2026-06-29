import type { Express } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";

export function registerStatsCountryActivityRoutes(app: Express) {
  app.get("/api/stats/country-activity", requireAuth, async (_req: any, res: any) => {
    try {
      let startDateStr: string;
      let endDateStr: string;
      let days: number;

      if (_req.query.startDate && _req.query.endDate) {
        startDateStr = _req.query.startDate as string;
        endDateStr   = _req.query.endDate   as string;
        const start = new Date(startDateStr);
        const end   = new Date(endDateStr);
        days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      } else {
        const rawDays = parseInt((_req.query.days as string) || "14");
        days = Math.min(Math.max(rawDays, 1), 90);
        const today = new Date();
        endDateStr   = today.toISOString().substring(0, 10);
        const start  = new Date(today);
        start.setDate(start.getDate() - (days - 1));
        startDateStr = start.toISOString().substring(0, 10);
      }

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
        return res.json({ companies: [], days, startDate: startDateStr, endDate: endDateStr, dateSeries: [] });
      }

      const toDateKey = (raw: any): string =>
        typeof raw === "string" ? raw.substring(0, 10) : (raw as Date).toISOString().substring(0, 10);

      type LocationEntry = { locationId: number; locationName: string; count: number };
      type DayEntry = { offloads: number; purchases: number; locations: LocationEntry[] };
      type DayMap = Map<string, DayEntry>;

      const companyDayMap = new Map<number, DayMap>();
      for (const c of companies) companyDayMap.set(c.id, new Map());

      const ensureDay = (companyId: number, day: string): DayEntry => {
        const m = companyDayMap.get(companyId)!;
        if (!m.has(day)) m.set(day, { offloads: 0, purchases: 0, locations: [] });
        return m.get(day)!;
      };

      // ── 2. Offloaded containers per company per day ──────────────────────
      // Use container_offloads table (actual offload event records).
      // Falls back silently if the table doesn't exist on this deployment.
      try {
        const offloadsResult = await pool.query<{
          company_id: number;
          day: string;
          cnt: string;
        }>(`
          SELECT
            c.company_id,
            co.offloaded_at::date AS day,
            COUNT(*)::text        AS cnt
          FROM container_offloads co
          JOIN containers c ON c.id = co.container_id
          WHERE c.company_id = ANY($1::int[])
            AND co.offloaded_at::date BETWEEN $2::date AND $3::date
          GROUP BY c.company_id, co.offloaded_at::date
        `, [companyIds, startDateStr, endDateStr]);

        for (const row of offloadsResult.rows) {
          const entry = ensureDay(row.company_id, toDateKey(row.day));
          entry.offloads = parseInt(row.cnt);
        }

        // Location breakdown — inner query, also fallback-safe
        try {
          const locResult = await pool.query<{
            company_id: number;
            day: string;
            location_id: number;
            location_name: string;
            cnt: string;
          }>(`
            SELECT
              c.company_id,
              co.offloaded_at::date AS day,
              co.location_id,
              l.name                AS location_name,
              COUNT(*)::text        AS cnt
            FROM container_offloads co
            JOIN containers c ON c.id = co.container_id
            JOIN locations l  ON l.id  = co.location_id
            WHERE c.company_id = ANY($1::int[])
              AND co.offloaded_at::date BETWEEN $2::date AND $3::date
            GROUP BY c.company_id, co.offloaded_at::date, co.location_id, l.name
            ORDER BY co.offloaded_at::date DESC, COUNT(*) DESC
          `, [companyIds, startDateStr, endDateStr]);

          for (const row of locResult.rows) {
            const entry = ensureDay(row.company_id, toDateKey(row.day));
            entry.locations.push({
              locationId: row.location_id,
              locationName: row.location_name,
              count: parseInt(row.cnt),
            });
          }
        } catch (_locErr: any) {
          console.error("[country-activity] location breakdown failed (non-fatal):", _locErr.message);
        }
      } catch (_offloadErr: any) {
        console.error("[country-activity] offloads query failed (non-fatal):", _offloadErr.message);
      }

      // ── 3. Purchases (POs imported) per company per day ──────────────────
      try {
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
            AND po.created_at::date BETWEEN $2::date AND $3::date
          GROUP BY po.company_id, po.created_at::date
        `, [companyIds, startDateStr, endDateStr]);

        for (const row of purchasesResult.rows) {
          const entry = ensureDay(row.company_id, toDateKey(row.day));
          entry.purchases = parseInt(row.cnt);
        }
      } catch (_poErr: any) {
        console.error("[country-activity] purchases query failed (non-fatal):", _poErr.message);
      }

      // ── 4. Build date spine ──────────────────────────────────────────────
      const datesResult = await pool.query<{ day: string }>(`
        SELECT gs::date AS day
        FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS gs
        ORDER BY day DESC
      `, [startDateStr, endDateStr]);
      const dateSeries = datesResult.rows.map((r) => toDateKey(r.day));

      // ── 5. Assemble response ─────────────────────────────────────────────
      const result = companies.map((c) => {
        const dayMap = companyDayMap.get(c.id)!;
        const dailyData = dateSeries.map((day) => {
          const entry = dayMap.get(day) ?? { offloads: 0, purchases: 0, locations: [] };
          return { date: day, offloads: entry.offloads, purchases: entry.purchases, locations: entry.locations };
        });

        const totalOffloads  = dailyData.reduce((s, d) => s + d.offloads,  0);
        const totalPurchases = dailyData.reduce((s, d) => s + d.purchases, 0);

        return { id: c.id, name: c.name, code: c.code, totalOffloads, totalPurchases, days: dailyData };
      });

      result.sort((a, b) => {
        const aActive = a.totalOffloads + a.totalPurchases;
        const bActive = b.totalOffloads + b.totalPurchases;
        if (bActive !== aActive) return bActive - aActive;
        return a.name.localeCompare(b.name);
      });

      res.json({ companies: result, days, startDate: startDateStr, endDate: endDateStr, dateSeries });
    } catch (err: any) {
      console.error("GET /api/stats/country-activity error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch country activity" });
    }
  });
}
