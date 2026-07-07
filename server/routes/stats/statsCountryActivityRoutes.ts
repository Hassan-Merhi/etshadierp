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
      const companyIds = companies.map((c) => Number(c.id));

      if (companyIds.length === 0) {
        return res.json({ companies: [], days, startDate: startDateStr, endDate: endDateStr, dateSeries: [] });
      }

      // Helper: normalize any date value from pg to a YYYY-MM-DD string
      const toDateKey = (raw: any): string => {
        if (!raw) return "";
        if (raw instanceof Date) return raw.toISOString().substring(0, 10);
        if (typeof raw === "string") return raw.substring(0, 10);
        return String(raw).substring(0, 10);
      };

      type ContainerEntry         = { id: number; containerNumber: string; supplierCode: string | null; locationName: string | null };
      type ImportedContainerEntry = { id: number; containerNumber: string; supplierCode: string | null; shopName: string | null };
      type LocationEntry          = { locationId: number; locationName: string; count: number };
      type DayEntry               = { offloads: number; purchases: number; locations: LocationEntry[]; containers: ContainerEntry[]; importedContainers: ImportedContainerEntry[] };
      type DayMap                 = Map<string, DayEntry>;

      const companyDayMap = new Map<number, DayMap>();
      for (const c of companies) companyDayMap.set(Number(c.id), new Map<string, DayEntry>());

      const ensureDay = (rawCompanyId: any, day: string): DayEntry | null => {
        const companyId = Number(rawCompanyId);
        const m = companyDayMap.get(companyId);
        if (!m) return null;
        if (!m.has(day)) m.set(day, { offloads: 0, purchases: 0, locations: [], containers: [], importedContainers: [] });
        return m.get(day)!;
      };

      // ── 2. Offloaded containers per company per day (with container details) ──
      try {
        const companyIdList = companyIds.join(",");

        // Aggregate with container details via json_agg
        const offloadsResult = await pool.query<{
          company_id: string;
          day: any;
          cnt: string;
          containers: any;
        }>(`
          SELECT
            c.company_id::text,
            co.offloaded_at::date AS day,
            COUNT(*)::text        AS cnt,
            json_agg(
              json_build_object(
                'id',              c.id,
                'containerNumber', COALESCE(c.container_number, ''),
                'supplierCode',    s.code,
                'locationName',    l.name
              )
              ORDER BY c.container_number
            ) AS containers
          FROM container_offloads co
          JOIN containers c ON c.id = co.container_id
          LEFT JOIN suppliers s ON s.id = c.supplier_id
          LEFT JOIN locations l ON l.id = co.location_id
          WHERE c.company_id IN (${companyIdList})
            AND co.offloaded_at::date BETWEEN $1::date AND $2::date
          GROUP BY c.company_id, co.offloaded_at::date
        `, [startDateStr, endDateStr]);

        for (const row of offloadsResult.rows) {
          const entry = ensureDay(row.company_id, toDateKey(row.day));
          if (entry) {
            entry.offloads = parseInt(row.cnt);
            const rawContainers = typeof row.containers === "string"
              ? JSON.parse(row.containers)
              : row.containers;
            if (Array.isArray(rawContainers)) {
              entry.containers = rawContainers.map((c: any) => ({
                id:              Number(c.id),
                containerNumber: c.containerNumber || "",
                supplierCode:    c.supplierCode ?? null,
                locationName:    c.locationName ?? null,
              }));
            }
          }
        }

        // Location breakdown
        try {
          const locResult = await pool.query<{
            company_id: string;
            day: any;
            location_id: string;
            location_name: string;
            cnt: string;
          }>(`
            SELECT
              c.company_id::text,
              co.offloaded_at::date AS day,
              co.location_id::text,
              l.name                AS location_name,
              COUNT(*)::text        AS cnt
            FROM container_offloads co
            JOIN containers c ON c.id = co.container_id
            JOIN locations l  ON l.id  = co.location_id
            WHERE c.company_id IN (${companyIdList})
              AND co.offloaded_at::date BETWEEN $1::date AND $2::date
            GROUP BY c.company_id, co.offloaded_at::date, co.location_id, l.name
            ORDER BY co.offloaded_at::date DESC, COUNT(*) DESC
          `, [startDateStr, endDateStr]);

          for (const row of locResult.rows) {
            const entry = ensureDay(row.company_id, toDateKey(row.day));
            if (entry) {
              entry.locations.push({
                locationId:   parseInt(row.location_id),
                locationName: row.location_name,
                count:        parseInt(row.cnt),
              });
            }
          }
        } catch (_locErr: any) {
          console.error("[country-activity] location breakdown failed (non-fatal):", _locErr.message);
        }
      } catch (_offloadErr: any) {
        console.error("[country-activity] offloads query failed (non-fatal):", _offloadErr.message);
      }

      // ── 3. Containers imported per company per day ────────────────────────
      try {
        const companyIdList = companyIds.join(",");
        const purchasesResult = await pool.query<{
          company_id: string;
          day: any;
          cnt: string;
          containers: any;
        }>(`
          SELECT
            c.company_id::text,
            c.created_at::date AS day,
            COUNT(*)::text     AS cnt,
            json_agg(
              json_build_object(
                'id',              c.id,
                'containerNumber', COALESCE(c.container_number, ''),
                'supplierCode',    s.code,
                'shopName',        c.shop_name
              )
              ORDER BY c.container_number
            ) AS containers
          FROM containers c
          LEFT JOIN suppliers s ON s.id = c.supplier_id
          WHERE c.company_id IN (${companyIdList})
            AND c.created_at::date BETWEEN $1::date AND $2::date
          GROUP BY c.company_id, c.created_at::date
        `, [startDateStr, endDateStr]);

        for (const row of purchasesResult.rows) {
          const entry = ensureDay(row.company_id, toDateKey(row.day));
          if (entry) {
            entry.purchases = parseInt(row.cnt);
            const rawContainers = typeof row.containers === "string"
              ? JSON.parse(row.containers)
              : row.containers;
            if (Array.isArray(rawContainers)) {
              entry.importedContainers = rawContainers.map((c: any) => ({
                id:              Number(c.id),
                containerNumber: c.containerNumber || "",
                supplierCode:    c.supplierCode ?? null,
                shopName:        c.shopName ?? null,
              }));
            }
          }
        }
      } catch (_poErr: any) {
        console.error("[country-activity] containers (imports) query failed (non-fatal):", _poErr.message);
      }

      // ── 4. Build date spine ──────────────────────────────────────────────
      let dateSeries: string[] = [];
      try {
        const datesResult = await pool.query<{ day: any }>(`
          SELECT gs::date AS day
          FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS gs
          ORDER BY day DESC
        `, [startDateStr, endDateStr]);
        dateSeries = datesResult.rows.map((r) => toDateKey(r.day));
      } catch (_dsErr: any) {
        console.error("[country-activity] generate_series failed, using JS fallback:", _dsErr.message);
        const cur = new Date(endDateStr + "T00:00:00");
        const start = new Date(startDateStr + "T00:00:00");
        while (cur >= start) {
          dateSeries.push(cur.toISOString().substring(0, 10));
          cur.setDate(cur.getDate() - 1);
        }
      }

      // ── 5. Assemble response ─────────────────────────────────────────────
      const result = companies.map((c) => {
        const dayMap = companyDayMap.get(Number(c.id));
        const dailyData = dateSeries.map((day) => {
          const entry = dayMap?.get(day) ?? { offloads: 0, purchases: 0, locations: [], containers: [], importedContainers: [] };
          return {
            date:               day,
            offloads:           entry.offloads,
            purchases:          entry.purchases,
            locations:          entry.locations,
            containers:         entry.containers,
            importedContainers: entry.importedContainers,
          };
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
