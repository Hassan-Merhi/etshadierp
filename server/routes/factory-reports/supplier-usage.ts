/**
 * factoryReportRoutes: FactorySupplierUsageReport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { getClientDate } from "../../lib/dateUtils";
import { sqlArray } from "../../lib/sqlArray";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  factorySuppliers,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryBales,
  companies,
} from "@shared/schema";
import { getUserHideAllCosts } from "../factory/_helpers";
import { generateEmptyExcel, generateEmptyPdf, generateExcel, generatePdf, writeDaybookEntry } from "./_helpers";

export function registerFactorySupplierUsageReportRoutes(app: Express, requireAuth: RequestHandler, db: any) {
  app.post("/api/factory/reports/supplier-usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const hideAllCosts = await getUserHideAllCosts(req);
      const { companyId, supplierId, startDate, endDate, format } = req.body;

      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }
      if (format !== "pdf" && format !== "excel") {
        return res.status(400).json({ message: "format must be 'pdf' or 'excel'" });
      }

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const containerConditions = [eq(factoryContainers.companyId, companyId)];
      if (supplierId) {
        containerConditions.push(eq(factoryContainers.supplierId, supplierId));
      }

      const allContainers = await db
        .select()
        .from(factoryContainers)
        .where(and(...containerConditions));

      const containerIds = allContainers.map((c: any) => c.id);

      if (containerIds.length === 0) {
        if (format === "pdf") {
          return generateEmptyPdf(res, company.name, startDate, endDate);
        } else {
          return generateEmptyExcel(res, company.name, startDate, endDate);
        }
      }

      const allRawStock = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const relevantRawStock = allRawStock.filter((rs: any) => containerIds.includes(rs.containerId));

      const allMixSources = await db
        .select({
          id: factoryMixBatchSources.id,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          containerId: factoryMixBatchSources.containerId,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          createdAt: factoryMixBatchSources.createdAt,
        })
        .from(factoryMixBatchSources)
        .where(sql`${factoryMixBatchSources.containerId} = ANY(${sqlArray(containerIds)})`);

      const allMixBatches = await db.select().from(factoryMixBatches).where(eq(factoryMixBatches.companyId, companyId));

      const mixBatchMap = new Map();
      for (const mb of allMixBatches) {
        mixBatchMap.set(mb.id, mb);
      }

      const allBales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId))
        .orderBy(desc(factoryBales.createdAt));

      const suppliers = await db.select().from(factorySuppliers).where(eq(factorySuppliers.companyId, companyId));

      const supplierMap = new Map();
      for (const s of suppliers) {
        supplierMap.set(s.id, s);
      }

      const containerMap = new Map();
      for (const c of allContainers) {
        containerMap.set(c.id, c);
      }

      const mixBatchIdsByContainer = new Map<number, Set<number>>();
      for (const src of allMixSources) {
        if (src.containerId) {
          if (!mixBatchIdsByContainer.has(src.containerId)) {
            mixBatchIdsByContainer.set(src.containerId, new Set());
          }
          mixBatchIdsByContainer.get(src.containerId)!.add(src.mixBatchId);
        }
      }

      const supplierSummaries = [];
      const supplierGroups = new Map<number, unknown[]>();

      for (const container of allContainers) {
        const sid = container.supplierId || 0;
        if (!supplierGroups.has(sid)) {
          supplierGroups.set(sid, []);
        }
        supplierGroups.get(sid)!.push(container);
      }

      for (const [sid, sContainers] of Array.from(supplierGroups.entries())) {
        const supplier = supplierMap.get(sid);
        const supplierName = supplier ? supplier.name : `Unknown (ID: ${sid})`;
        const sContainerIds = sContainers.map((c: any) => c.id);

        const sRawStock = relevantRawStock.filter((rs: any) => sContainerIds.includes(rs.containerId));

        let openingReceivedKg = 0;
        let openingUsedKg = 0;
        let periodPurchasedKg = 0;
        let totalCostPerKg = 0;
        let costCount = 0;

        for (const rs of sRawStock) {
          const rsDate = rs.offloadedAt
            ? new Date(rs.offloadedAt).toISOString().split("T")[0]
            : rs.createdAt
              ? new Date(rs.createdAt).toISOString().split("T")[0]
              : startDate;

          const receivedKg = parseFloat(rs.receivedKg || "0");
          const usedKg = parseFloat(rs.usedKg || "0");
          const cpk = parseFloat(rs.costPerKgUsd) || parseFloat(rs.costPerKg) || 0;

          if (rsDate < startDate) {
            openingReceivedKg += receivedKg;
            openingUsedKg += usedKg;
          } else if (rsDate >= startDate && rsDate <= endDate) {
            periodPurchasedKg += receivedKg;
          }

          if (cpk > 0) {
            totalCostPerKg += cpk;
            costCount++;
          }
        }

        const sMixSources = allMixSources.filter((ms: any) => sContainerIds.includes(ms.containerId));

        let periodUsedKg = 0;
        for (const ms of sMixSources) {
          const mb = mixBatchMap.get(ms.mixBatchId);
          if (mb) {
            const mbDate = mb.createdAt ? new Date(mb.createdAt).toISOString().split("T")[0] : "";
            if (mbDate >= startDate && mbDate <= endDate) {
              periodUsedKg += parseFloat(ms.weightKg || "0");
            }
          }
        }

        const sMixBatchIds = new Set<number>();
        for (const cid of sContainerIds) {
          const mbIds = mixBatchIdsByContainer.get(cid);
          if (mbIds) {
            mbIds.forEach((id: number) => sMixBatchIds.add(id));
          }
        }

        const sBales = allBales.filter((b: any) => b.mixBatchId && sMixBatchIds.has(b.mixBatchId));

        const periodBales = sBales.filter((b: any) => {
          const bDate = b.finalizedAt
            ? new Date(b.finalizedAt).toISOString().split("T")[0]
            : b.createdAt
              ? new Date(b.createdAt).toISOString().split("T")[0]
              : "";
          return bDate >= startDate && bDate <= endDate;
        });

        const totalBales = periodBales.length;
        const openingBalance = openingReceivedKg - openingUsedKg;
        const remaining = openingBalance + periodPurchasedKg - periodUsedKg;
        const avgCostPerKg = costCount > 0 ? totalCostPerKg / costCount : 0;
        const totalCost = periodPurchasedKg * avgCostPerKg;
        const costPerBale = totalBales > 0 ? totalCost / totalBales : 0;

        supplierSummaries.push({
          supplierId: sid,
          supplierName,
          openingBalance,
          totalPurchasedKg: periodPurchasedKg,
          totalUsedKg: periodUsedKg,
          remaining,
          avgCostPerKg,
          costPerBale,
          totalBales,
          totalCost,
          bales: periodBales,
        });
      }

      const baleBreakdown = [];
      for (const summary of supplierSummaries) {
        for (const bale of summary.bales) {
          const mixSources = allMixSources.filter((ms: any) => ms.mixBatchId === bale.mixBatchId);
          const materials = mixSources.map((ms: any) => {
            const container = containerMap.get(ms.containerId);
            return {
              containerId: ms.containerId,
              containerNumber: container ? container.containerNumber : `C-${ms.containerId}`,
              weightKg: parseFloat(ms.weightKg || "0"),
              costPerKg: parseFloat(ms.costPerKg || "0"),
              totalCost: parseFloat(ms.totalCost || "0"),
            };
          });

          baleBreakdown.push({
            baleId: bale.id,
            baleCode: bale.baleCode,
            referenceNumber: bale.referenceNumber,
            productName: bale.productName || bale.baleCode,
            supplierName: summary.supplierName,
            weightKg: parseFloat(bale.weightKg || "0"),
            costPerKg: parseFloat(bale.costPerKg || "0"),
            totalCost: parseFloat(bale.totalCost || "0"),
            date: bale.finalizedAt
              ? new Date(bale.finalizedAt).toISOString().split("T")[0]
              : bale.createdAt
                ? new Date(bale.createdAt).toISOString().split("T")[0]
                : "",
            materials,
          });
        }
      }

      if (format === "pdf") {
        await generatePdf(res, company.name, startDate, endDate, supplierSummaries, baleBreakdown, hideAllCosts);
      } else {
        await generateExcel(
          res,
          company.name,
          startDate,
          endDate,
          supplierSummaries,
          baleBreakdown,
          allMixSources,
          containerMap,
          supplierMap,
          hideAllCosts
        );
      }

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "REPORT_GENERATED",
        description: `Supplier Usage Report (${format.toUpperCase()}) – ${startDate} to ${endDate}${supplierId ? ` – ${supplierMap.get(supplierId)?.name || `Supplier #${supplierId}`}` : " – All Suppliers"}`,
        metaJson: JSON.stringify({ format, startDate, endDate, supplierId: supplierId || null }),
      });
    } catch (error: unknown) {
      logger.error("Error generating supplier usage report:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
