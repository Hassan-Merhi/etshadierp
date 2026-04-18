import { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql } from "drizzle-orm";

export function registerProductionPlannerRoutes(app: Express) {
  const getCompanyId = (req: any): number | null =>
    (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId || null;

  // ── GET plan for a date ──────────────────────────────────────────────────────
  app.get("/api/factory/production-planner/:date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date } = req.params;

      const plans = await db.execute(sql`
        SELECT id, plan_date, category_ids, notes
        FROM factory_production_plans
        WHERE company_id = ${companyId} AND plan_date = ${date}
      `);
      const planRows: any[] = Array.isArray(plans) ? plans : (plans as any).rows ?? [];
      const plan = planRows[0] ?? null;

      if (!plan) return res.json({ plan: null, entries: [], actuals: {} });

      const planId = Number(plan.id);

      const entryResult = await db.execute(sql`
        SELECT e.id, e.worker_id AS "workerId", w.full_name AS "workerName",
               e.role, e.target_bales AS "targetBales"
        FROM factory_production_plan_entries e
        JOIN factory_workers w ON w.id = e.worker_id
        WHERE e.plan_id = ${planId}
        ORDER BY
          CASE e.role WHEN 'TEAM_LEADER' THEN 1 WHEN 'HELPER' THEN 2 ELSE 3 END,
          w.full_name
      `);
      const entries: any[] = Array.isArray(entryResult) ? entryResult : (entryResult as any).rows ?? [];

      const workerIds = entries.map((e: any) => Number(e.workerId));
      const categoryIds: number[] = JSON.parse(plan.category_ids || "[]");

      let actuals: Record<number, number> = {};
      if (workerIds.length > 0) {
        // Resolve worker category IDs → worker IDs for the team filter
        let teamWorkerFilter = sql``;
        let skipActuals = false;
        if (categoryIds.length > 0) {
          const wcResult = await db.execute(sql`
            SELECT worker_ids FROM factory_worker_categories
            WHERE company_id = ${companyId}
              AND id = ANY(ARRAY[${sql.raw(categoryIds.join(","))}]::integer[])
          `);
          const wcRows: any[] = Array.isArray(wcResult) ? wcResult : (wcResult as any).rows ?? [];
          const teamWorkerIds = wcRows.flatMap((r: any) => {
            const ids = r.worker_ids;
            if (Array.isArray(ids)) return ids.map(Number);
            try { return JSON.parse(ids || "[]").map(Number); } catch { return []; }
          });
          if (teamWorkerIds.length > 0) {
            teamWorkerFilter = sql`AND fb.finalized_by = ANY(ARRAY[${sql.raw(teamWorkerIds.join(","))}]::integer[])`;
          } else {
            skipActuals = true;
          }
        }

        if (!skipActuals) {
          const actualResult = await db.execute(sql`
            SELECT fb.finalized_by AS worker_id, COUNT(*)::integer AS bale_count
            FROM factory_bales fb
            WHERE fb.company_id = ${companyId}
              AND fb.stock_entry_date = ${date}
              AND fb.finalized_by = ANY(ARRAY[${sql.raw(workerIds.join(","))}]::integer[])
              AND fb.status IN ('IN_STOCK','SOLD','RESERVED_FOR_ORDER','DISPATCHED','FINALIZED')
              ${teamWorkerFilter}
            GROUP BY fb.finalized_by
          `);
          const actualRows: any[] = Array.isArray(actualResult) ? actualResult : (actualResult as any).rows ?? [];
          for (const row of actualRows) {
            actuals[Number(row.worker_id)] = Number(row.bale_count);
          }
        }
      }

      res.json({
        plan: {
          id: planId,
          planDate: String(plan.plan_date),
          categoryIds,
          notes: plan.notes ?? "",
        },
        entries,
        actuals,
      });
    } catch (e: any) {
      console.error("[ProductionPlanner] GET error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST — upsert plan for a date ───────────────────────────────────────────
  app.post("/api/factory/production-planner/:date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date } = req.params;
      const { notes, categoryIds, entries } = req.body as {
        notes?: string;
        categoryIds?: number[];
        entries?: { workerId: number; role: string; targetBales: number }[];
      };

      const catJson = JSON.stringify(categoryIds ?? []);

      await db.execute(sql`
        INSERT INTO factory_production_plans (company_id, plan_date, category_ids, notes)
        VALUES (${companyId}, ${date}, ${catJson}, ${notes ?? null})
        ON CONFLICT (company_id, plan_date)
        DO UPDATE SET category_ids = EXCLUDED.category_ids, notes = EXCLUDED.notes
      `);

      const planResult = await db.execute(sql`
        SELECT id FROM factory_production_plans
        WHERE company_id = ${companyId} AND plan_date = ${date}
      `);
      const planRows: any[] = Array.isArray(planResult) ? planResult : (planResult as any).rows ?? [];
      const planId = Number(planRows[0].id);

      await db.execute(sql`DELETE FROM factory_production_plan_entries WHERE plan_id = ${planId}`);

      if (entries && entries.length > 0) {
        for (const entry of entries) {
          const role = ["TEAM_LEADER", "HELPER", "WORKER"].includes(entry.role) ? entry.role : "WORKER";
          await db.execute(sql`
            INSERT INTO factory_production_plan_entries (plan_id, worker_id, role, target_bales)
            VALUES (${planId}, ${entry.workerId}, ${role}, ${entry.targetBales ?? 0})
          `);
        }
      }

      res.json({ message: "Plan saved successfully" });
    } catch (e: any) {
      console.error("[ProductionPlanner] POST error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET — copy previous day's plan entries ──────────────────────────────────
  app.get("/api/factory/production-planner/:date/copy-previous", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date } = req.params;

      const prevResult = await db.execute(sql`
        SELECT id, plan_date, category_ids, notes
        FROM factory_production_plans
        WHERE company_id = ${companyId} AND plan_date < ${date}
        ORDER BY plan_date DESC LIMIT 1
      `);
      const prevRows: any[] = Array.isArray(prevResult) ? prevResult : (prevResult as any).rows ?? [];
      if (!prevRows[0]) return res.json({ entries: [], categoryIds: [], fromDate: null });

      const prevPlanId = Number(prevRows[0].id);

      const entryResult = await db.execute(sql`
        SELECT e.worker_id AS "workerId", w.full_name AS "workerName", e.role, e.target_bales AS "targetBales"
        FROM factory_production_plan_entries e
        JOIN factory_workers w ON w.id = e.worker_id
        WHERE e.plan_id = ${prevPlanId}
        ORDER BY CASE e.role WHEN 'TEAM_LEADER' THEN 1 WHEN 'HELPER' THEN 2 ELSE 3 END, w.full_name
      `);
      const entries: any[] = Array.isArray(entryResult) ? entryResult : (entryResult as any).rows ?? [];

      res.json({
        entries,
        categoryIds: JSON.parse(prevRows[0].category_ids || "[]"),
        notes: prevRows[0].notes ?? "",
        fromDate: String(prevRows[0].plan_date),
      });
    } catch (e: any) {
      console.error("[ProductionPlanner] copy-previous error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE plan for a date ──────────────────────────────────────────────────
  app.delete("/api/factory/production-planner/:date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date } = req.params;

      const planResult = await db.execute(sql`
        SELECT id FROM factory_production_plans
        WHERE company_id = ${companyId} AND plan_date = ${date}
      `);
      const planRows: any[] = Array.isArray(planResult) ? planResult : (planResult as any).rows ?? [];
      if (planRows[0]) {
        const planId = Number(planRows[0].id);
        await db.execute(sql`DELETE FROM factory_production_plan_entries WHERE plan_id = ${planId}`);
        await db.execute(sql`DELETE FROM factory_production_plans WHERE id = ${planId}`);
      }

      res.json({ message: "Plan deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
