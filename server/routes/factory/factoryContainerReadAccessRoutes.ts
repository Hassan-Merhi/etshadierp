import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  containerDocuments,
  containerDocumentTypes,
  containerFreight,
  containerFreightPayments,
  factoryContainers,
} from "@shared/schema";

function resolveFactoryCompanyId(req: any): number | null {
  const raw = req.session?.factoryCompanyId || req.session?.currentCompanyId;
  const companyId = Number(raw);
  return Number.isInteger(companyId) && companyId > 0 ? companyId : null;
}

function parsePositiveId(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function ownsFactoryContainer(containerId: number, companyId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: factoryContainers.id })
    .from(factoryContainers)
    .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Registers the factory-container document/freight read routes before the legacy
 * docs module. The legacy ownership helper checks the ERP `containers` table,
 * even though these endpoints receive IDs from `factory_containers`; valid
 * factory records were therefore rejected with 403.
 */
export function registerFactoryContainerReadAccessRoutes(app: Express) {
  app.get("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = resolveFactoryCompanyId(req);
      const containerId = parsePositiveId(req.params.containerId);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!containerId) return res.status(400).json({ message: "Invalid container ID" });
      if (!(await ownsFactoryContainer(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const rawDocs = await db
        .select()
        .from(containerDocuments)
        .where(and(eq(containerDocuments.containerId, containerId), eq(containerDocuments.companyId, companyId)));
      const docTypes = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      const requiredTypes = docTypes.filter((docType: any) => docType.isRequired);
      const uploadedTypeIds = new Set(rawDocs.map((doc: any) => doc.docTypeId));

      const documents = rawDocs.map((doc: any) => ({
        ...doc,
        fileData: undefined,
        isGhost: !doc.storageKey && !doc.fileData,
      }));

      return res.json({
        documents,
        docTypes,
        completeness: {
          total: requiredTypes.length,
          uploaded: requiredTypes.filter((docType: any) => uploadedTypeIds.has(docType.id)).length,
          complete: requiredTypes.every((docType: any) => uploadedTypeIds.has(docType.id)),
        },
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = resolveFactoryCompanyId(req);
      const containerId = parsePositiveId(req.params.containerId);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!containerId) return res.status(400).json({ message: "Invalid container ID" });
      if (!(await ownsFactoryContainer(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const freightRows = await db
        .select()
        .from(containerFreight)
        .where(and(eq(containerFreight.containerId, containerId), eq(containerFreight.companyId, companyId)));

      if (freightRows.length === 0) return res.json([]);

      const freightIds = freightRows.map((row: any) => row.id);
      const payments = await db
        .select()
        .from(containerFreightPayments)
        .where(
          and(
            eq(containerFreightPayments.companyId, companyId),
            inArray(containerFreightPayments.containerFreightId, freightIds)
          )
        );

      const paymentsByFreight = new Map<number, any[]>();
      for (const payment of payments) {
        const existing = paymentsByFreight.get(payment.containerFreightId) ?? [];
        existing.push(payment);
        paymentsByFreight.set(payment.containerFreightId, existing);
      }

      return res.json(
        freightRows.map((freight: any) => {
          const freightPayments = paymentsByFreight.get(freight.id) ?? [];
          const totalPaid = freightPayments.reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
          const freightAmount = Number(freight.freightAmount);
          const computedStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
          return { ...freight, payments: freightPayments, totalPaid, computedStatus };
        })
      );
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });
}
