import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  customerOrders,
  customerOrderBales,
  customerOrderLines,
  customers,
  factoryBales,
  factoryInvoiceLoadingSessions,
  factoryInvoiceLoadingBales,
  locations,
} from "@shared/schema";
import { eq, and, or, inArray, sql, ne } from "drizzle-orm";

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCompanyId(req: any): number | null {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId || null;
}

/**
 * Build a full loading summary for an invoice.
 * "loaded" counts only OPEN and COMPLETED sessions — CANCELLED sessions are excluded.
 */
async function buildLoadingSummary(invoiceId: number, companyId: number, activeSessionId?: number) {
  // 1. Invoice + customer
  const [invoiceRow] = await db
    .select({
      id: customerOrders.id,
      companyId: customerOrders.companyId,
      customerId: customerOrders.customerId,
      invoiceNumber: customerOrders.invoiceNumber,
      orderDate: customerOrders.orderDate,
      status: customerOrders.status,
      totalQtyBales: customerOrders.totalQtyBales,
      grandTotal: customerOrders.grandTotal,
      containerNumber: customerOrders.containerNumber,
      customerName: customers.legalName,
      customerCode: customers.code,
    })
    .from(customerOrders)
    .leftJoin(customers, eq(customerOrders.customerId, customers.id))
    .where(and(eq(customerOrders.id, invoiceId), eq(customerOrders.companyId, companyId)));

  if (!invoiceRow) return null;

  // 2. Invoice lines
  const lines = await db
    .select()
    .from(customerOrderLines)
    .where(eq(customerOrderLines.orderId, invoiceId));

  // 3. Invoice bales (exact bale membership — the official list)
  const invoiceBalesRaw = await db
    .select({
      id: customerOrderBales.id,
      baleId: customerOrderBales.baleId,
      baleReference: customerOrderBales.baleReference,
      articleCode: customerOrderBales.articleCode,
      baleName: customerOrderBales.baleName,
      weight: customerOrderBales.weight,
      priceUsed: customerOrderBales.priceUsed,
    })
    .from(customerOrderBales)
    .where(eq(customerOrderBales.orderId, invoiceId));

  // 4. All loading sessions for this invoice
  const sessions = await db
    .select({
      id: factoryInvoiceLoadingSessions.id,
      status: factoryInvoiceLoadingSessions.status,
      truckNo: factoryInvoiceLoadingSessions.truckNo,
      driverName: factoryInvoiceLoadingSessions.driverName,
      notes: factoryInvoiceLoadingSessions.notes,
      startedAt: factoryInvoiceLoadingSessions.startedAt,
      completedAt: factoryInvoiceLoadingSessions.completedAt,
      cancelledAt: factoryInvoiceLoadingSessions.cancelledAt,
      createdByName: factoryInvoiceLoadingSessions.createdByName,
    })
    .from(factoryInvoiceLoadingSessions)
    .where(and(
      eq(factoryInvoiceLoadingSessions.invoiceId, invoiceId),
      eq(factoryInvoiceLoadingSessions.companyId, companyId),
    ))
    .orderBy(factoryInvoiceLoadingSessions.startedAt);

  // 5. All loading bale rows for ACTIVE (non-cancelled) sessions only
  const activeSessions = sessions.filter((s) => s.status !== "CANCELLED");
  const activeSessionIds = activeSessions.map((s) => s.id);

  let loadedBaleRows: Array<{
    id: number; sessionId: number; baleId: number; baleReference: string;
    articleCode: string | null; productName: string | null; weightKg: string;
    scannedAt: Date; scannedByName: string | null;
  }> = [];
  if (activeSessionIds.length > 0) {
    loadedBaleRows = await db
      .select({
        id: factoryInvoiceLoadingBales.id,
        sessionId: factoryInvoiceLoadingBales.sessionId,
        baleId: factoryInvoiceLoadingBales.baleId,
        baleReference: factoryInvoiceLoadingBales.baleReference,
        articleCode: factoryInvoiceLoadingBales.articleCode,
        productName: factoryInvoiceLoadingBales.productName,
        weightKg: factoryInvoiceLoadingBales.weightKg,
        scannedAt: factoryInvoiceLoadingBales.scannedAt,
        scannedByName: factoryInvoiceLoadingBales.scannedByName,
      })
      .from(factoryInvoiceLoadingBales)
      .where(inArray(factoryInvoiceLoadingBales.sessionId, activeSessionIds));
  }

  // 6. Also get all bale rows for each session (including cancelled) for per-session totals
  const allSessionIds = sessions.map((s) => s.id);
  let allSessionBaleRows: Array<{ sessionId: number }> = [];
  if (allSessionIds.length > 0) {
    allSessionBaleRows = await db
      .select({ sessionId: factoryInvoiceLoadingBales.sessionId })
      .from(factoryInvoiceLoadingBales)
      .where(inArray(factoryInvoiceLoadingBales.sessionId, allSessionIds));
  }

  const sessionBaleCountMap = new Map<number, number>();
  for (const row of allSessionBaleRows) {
    sessionBaleCountMap.set(row.sessionId, (sessionBaleCountMap.get(row.sessionId) || 0) + 1);
  }

  // 7. Build per-line loaded/remaining
  const loadedBaleIdSet = new Set(loadedBaleRows.map((b) => b.baleId));
  const linesSummary = lines.map((line) => {
    const invoiceQty = line.qty || 0;
    const lineBales = invoiceBalesRaw.filter((b) => b.articleCode === line.articleCode);
    const alreadyLoaded = lineBales.filter((b) => loadedBaleIdSet.has(b.baleId)).length;
    const currentSession = activeSessionId
      ? loadedBaleRows.filter((b) => b.sessionId === activeSessionId && b.articleCode === line.articleCode).length
      : 0;
    return {
      lineId: line.id,
      articleCode: line.articleCode,
      productName: line.baleName,
      invoiceQty,
      invoiceWeight: Number(line.totalWeight || 0),
      alreadyLoaded,
      currentSessionLoaded: currentSession,
      remaining: invoiceQty - alreadyLoaded,
      pricePerBale: line.pricePerBale,
    };
  });

  // 8. Totals
  const totalInvoiceBales = invoiceBalesRaw.length || invoiceRow.totalQtyBales || 0;
  const totalAlreadyLoaded = loadedBaleIdSet.size;
  const totalRemaining = totalInvoiceBales - totalAlreadyLoaded;

  // 9. Per-session totals
  const sessionsWithTotals = sessions.map((s) => ({
    ...s,
    totalBales: sessionBaleCountMap.get(s.id) || 0,
  }));

  // 10. Invoice bales with loaded flag
  const invoiceBalesWithStatus = invoiceBalesRaw.map((b) => {
    const loadedRow = loadedBaleRows.find((lr) => lr.baleId === b.baleId);
    return {
      baleId: b.baleId,
      baleReference: b.baleReference,
      articleCode: b.articleCode,
      productName: b.baleName,
      weightKg: b.weight,
      priceUsed: b.priceUsed,
      loaded: !!loadedRow,
      loadedSessionId: loadedRow?.sessionId ?? null,
      loadedAt: loadedRow?.scannedAt ?? null,
    };
  });

  // 11. If there's an active session, return its scanned bales
  let currentSessionBales: typeof loadedBaleRows = [];
  if (activeSessionId) {
    currentSessionBales = loadedBaleRows.filter((b) => b.sessionId === activeSessionId);
  }

  return {
    invoice: invoiceRow,
    lines: linesSummary,
    totals: {
      invoiceBales: totalInvoiceBales,
      alreadyLoaded: totalAlreadyLoaded,
      remaining: totalRemaining,
    },
    sessions: sessionsWithTotals,
    invoiceBales: invoiceBalesWithStatus,
    currentSessionBales,
  };
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerFactoryInvoiceLoadingRoutes(app: Express) {

  // GET /api/factory/invoices/:invoiceId/loading-summary
  app.get("/api/factory/invoices/:invoiceId/loading-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const invoiceId = parseInt(req.params.invoiceId);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const activeSessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;

      const summary = await buildLoadingSummary(invoiceId, companyId, activeSessionId);
      if (!summary) return res.status(404).json({ message: "Invoice not found" });

      res.json(summary);
    } catch (error: any) {
      console.error("loading-summary error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/invoices/:invoiceId/loading-sessions
  app.post("/api/factory/invoices/:invoiceId/loading-sessions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const invoiceId = parseInt(req.params.invoiceId);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      // Validate invoice
      const [invoice] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, invoiceId), eq(customerOrders.companyId, companyId)));

      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status !== "FINALIZED") {
        return res.status(400).json({ message: "Only FINALIZED invoices can have loading sessions" });
      }

      // Check there are invoice bales
      const invoiceBales = await db
        .select({ baleId: customerOrderBales.baleId })
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, invoiceId));

      if (invoiceBales.length === 0) {
        return res.status(400).json({ message: "This invoice has no bales to load" });
      }

      // Check if invoice is fully loaded (all bales loaded in active sessions)
      const activeSessionRows = await db
        .select({ id: factoryInvoiceLoadingSessions.id })
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.invoiceId, invoiceId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      const activeSessions = activeSessionRows.filter(async () => true); // all sessions
      if (activeSessions.length > 0) {
        const activeIds = activeSessions.map((s) => s.id);
        const [loadedCount] = await db
          .select({ count: sql<number>`COUNT(DISTINCT ${factoryInvoiceLoadingBales.baleId})` })
          .from(factoryInvoiceLoadingBales)
          .innerJoin(
            factoryInvoiceLoadingSessions,
            eq(factoryInvoiceLoadingBales.sessionId, factoryInvoiceLoadingSessions.id),
          )
          .where(and(
            eq(factoryInvoiceLoadingBales.invoiceId, invoiceId),
            ne(factoryInvoiceLoadingSessions.status, "CANCELLED"),
          ));

        const loaded = Number(loadedCount?.count || 0);
        if (loaded >= invoiceBales.length) {
          return res.status(400).json({ message: "This invoice is fully loaded — all bales have been assigned to loading sessions" });
        }
      }

      // Create session
      const userId = (req.session as any).userId;
      const username = (req.session as any).username || req.user?.username || "";
      const { locationId, truckNo, driverName, notes } = req.body;

      const [session] = await db
        .insert(factoryInvoiceLoadingSessions)
        .values({
          companyId,
          invoiceId,
          customerId: invoice.customerId,
          locationId: locationId ? parseInt(locationId) : null,
          status: "OPEN",
          truckNo: truckNo || null,
          driverName: driverName || null,
          notes: notes || null,
          createdBy: userId || null,
          createdByName: username,
        })
        .returning();

      const summary = await buildLoadingSummary(invoiceId, companyId, session.id);
      res.status(201).json({ session, summary });
    } catch (error: any) {
      console.error("create loading session error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/invoice-loading-sessions/:sessionId/scan-bale
  app.post("/api/factory/invoice-loading-sessions/:sessionId/scan-bale", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const { barcode } = req.body;
      if (!barcode || !barcode.trim()) return res.status(400).json({ message: "Barcode is required" });

      const scanCode = barcode.trim();
      const scanLower = scanCode.toLowerCase();

      // Validate session
      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.id, sessionId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      if (!session) return res.status(404).json({ message: "Loading session not found" });
      if (session.status === "COMPLETED") return res.status(400).json({ message: "This loading session is already completed" });
      if (session.status === "CANCELLED") return res.status(400).json({ message: "This loading session is cancelled" });

      const invoiceId = session.invoiceId;

      // Validate invoice still finalized
      const [invoice] = await db
        .select({ id: customerOrders.id, status: customerOrders.status, companyId: customerOrders.companyId })
        .from(customerOrders)
        .where(and(eq(customerOrders.id, invoiceId), eq(customerOrders.companyId, companyId)));

      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status !== "FINALIZED") return res.status(400).json({ message: "Invoice is not finalized" });

      // Look up the scanned bale by referenceNumber or baleCode (case-insensitive)
      const baleMatches = await db
        .select({
          id: factoryBales.id,
          companyId: factoryBales.companyId,
          baleCode: factoryBales.baleCode,
          referenceNumber: factoryBales.referenceNumber,
          articleCode: factoryBales.articleCode,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
          ),
        ))
        .limit(5);

      if (baleMatches.length === 0) {
        return res.status(400).json({ message: `Bale "${scanCode}" not found in this company's inventory` });
      }

      const bale = baleMatches[0];

      // Validate bale belongs to this exact invoice (via customer_order_bales)
      const [invoiceBaleLink] = await db
        .select({ baleId: customerOrderBales.baleId, baleReference: customerOrderBales.baleReference })
        .from(customerOrderBales)
        .where(and(
          eq(customerOrderBales.orderId, invoiceId),
          eq(customerOrderBales.baleId, bale.id),
        ));

      if (!invoiceBaleLink) {
        // FALLBACK NOTE: If finalized invoices ever exist without exact customer_order_bales rows,
        // a fallback by articleCode could be used here. For now, we require exact bale membership.
        return res.status(400).json({
          message: `Bale "${scanCode}" (ref: ${bale.referenceNumber}) is not part of this invoice`,
        });
      }

      // Check this bale has NOT already been loaded in any ACTIVE (OPEN or COMPLETED) session for this invoice
      // CANCELLED sessions do not block re-scanning.
      const [alreadyLoaded] = await db
        .select({ id: factoryInvoiceLoadingBales.id, sessionId: factoryInvoiceLoadingBales.sessionId })
        .from(factoryInvoiceLoadingBales)
        .innerJoin(
          factoryInvoiceLoadingSessions,
          eq(factoryInvoiceLoadingBales.sessionId, factoryInvoiceLoadingSessions.id),
        )
        .where(and(
          eq(factoryInvoiceLoadingBales.invoiceId, invoiceId),
          eq(factoryInvoiceLoadingBales.baleId, bale.id),
          ne(factoryInvoiceLoadingSessions.status, "CANCELLED"),
        ))
        .limit(1);

      if (alreadyLoaded) {
        const isSameSession = alreadyLoaded.sessionId === sessionId;
        return res.status(400).json({
          message: isSameSession
            ? `Bale "${scanCode}" has already been scanned in this session`
            : `Bale "${scanCode}" was already loaded in a previous loading session`,
        });
      }

      // Insert
      const userId = (req.session as any).userId;
      const username = (req.session as any).username || "";

      const [loadingBale] = await db
        .insert(factoryInvoiceLoadingBales)
        .values({
          companyId,
          sessionId,
          invoiceId,
          baleId: bale.id,
          baleReference: bale.referenceNumber,
          articleCode: bale.articleCode || null,
          productName: bale.productName || null,
          weightKg: bale.weightKg,
          scannedBy: userId || null,
          scannedByName: username,
        })
        .returning();

      const summary = await buildLoadingSummary(invoiceId, companyId, sessionId);
      res.json({ loadingBale, bale, summary });
    } catch (error: any) {
      console.error("scan-bale error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/invoice-loading-sessions/:sessionId/bales/:baleId
  app.delete("/api/factory/invoice-loading-sessions/:sessionId/bales/:baleId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseInt(req.params.sessionId);
      const baleId = parseInt(req.params.baleId);
      if (isNaN(sessionId) || isNaN(baleId)) return res.status(400).json({ message: "Invalid ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.id, sessionId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.status !== "OPEN") return res.status(400).json({ message: "Can only remove bales from OPEN sessions" });

      const deleted = await db
        .delete(factoryInvoiceLoadingBales)
        .where(and(
          eq(factoryInvoiceLoadingBales.sessionId, sessionId),
          eq(factoryInvoiceLoadingBales.baleId, baleId),
          eq(factoryInvoiceLoadingBales.companyId, companyId),
        ))
        .returning();

      if (deleted.length === 0) return res.status(404).json({ message: "Bale not found in this session" });

      const summary = await buildLoadingSummary(session.invoiceId, companyId, sessionId);
      res.json({ removed: deleted[0], summary });
    } catch (error: any) {
      console.error("remove bale error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/invoice-loading-sessions/:sessionId/complete
  app.post("/api/factory/invoice-loading-sessions/:sessionId/complete", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.id, sessionId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.status !== "OPEN") return res.status(400).json({ message: "Session is not OPEN" });

      // Require at least 1 scanned bale
      const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(factoryInvoiceLoadingBales)
        .where(eq(factoryInvoiceLoadingBales.sessionId, sessionId));

      if (Number(countRow?.count || 0) === 0) {
        return res.status(400).json({ message: "Cannot complete a loading session with no scanned bales" });
      }

      const [updated] = await db
        .update(factoryInvoiceLoadingSessions)
        .set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(factoryInvoiceLoadingSessions.id, sessionId))
        .returning();

      const summary = await buildLoadingSummary(session.invoiceId, companyId, sessionId);
      res.json({ session: updated, summary });
    } catch (error: any) {
      console.error("complete session error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/invoice-loading-sessions/:sessionId/cancel
  app.post("/api/factory/invoice-loading-sessions/:sessionId/cancel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.id, sessionId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.status !== "OPEN") return res.status(400).json({ message: "Session is not OPEN" });

      // Keep bale rows for audit history — only mark session as CANCELLED
      const [updated] = await db
        .update(factoryInvoiceLoadingSessions)
        .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(factoryInvoiceLoadingSessions.id, sessionId))
        .returning();

      const summary = await buildLoadingSummary(session.invoiceId, companyId);
      res.json({ session: updated, summary });
    } catch (error: any) {
      console.error("cancel session error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Export endpoints ───────────────────────────────────────────────────────

  // GET /api/factory/invoices/:invoiceId/loading-report/export/excel
  app.get("/api/factory/invoices/:invoiceId/loading-report/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const invoiceId = parseInt(req.params.invoiceId);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const summary = await buildLoadingSummary(invoiceId, companyId);
      if (!summary) return res.status(404).json({ message: "Invoice not found" });

      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Sheet 1: Summary
      const summaryData = [
        ["Invoice Loading Report"],
        [],
        ["Invoice", summary.invoice.invoiceNumber || `#${summary.invoice.id}`],
        ["Customer", summary.invoice.customerName || ""],
        ["Date", summary.invoice.orderDate || ""],
        ["Status", summary.invoice.status || ""],
        ["Total Bales", summary.totals.invoiceBales],
        ["Loaded", summary.totals.alreadyLoaded],
        ["Remaining", summary.totals.remaining],
        [],
        ["Article Code", "Product", "Invoice Qty", "Loaded", "Remaining"],
        ...summary.lines.map((l) => [l.articleCode, l.productName, l.invoiceQty, l.alreadyLoaded, l.remaining]),
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      // Sheet 2: Sessions
      const sessionsData = [
        ["Session ID", "Status", "Truck No", "Driver", "Started", "Completed", "Total Bales"],
        ...summary.sessions.map((s) => [
          s.id, s.status, s.truckNo || "", s.driverName || "",
          s.startedAt ? new Date(s.startedAt).toLocaleString() : "",
          s.completedAt ? new Date(s.completedAt).toLocaleString() : "",
          s.totalBales,
        ]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(sessionsData);
      XLSX.utils.book_append_sheet(wb, ws2, "Sessions");

      // Sheet 3: All Loaded Bales
      const baleData = [
        ["Bale Reference", "Article Code", "Product Name", "Loaded", "Session ID"],
        ...summary.invoiceBales.map((b) => [
          b.baleReference, b.articleCode || "", b.productName || "",
          b.loaded ? "Yes" : "No", b.loadedSessionId || "",
        ]),
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(baleData);
      XLSX.utils.book_append_sheet(wb, ws3, "Bales");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const filename = `loading-report-${summary.invoice.invoiceNumber || invoiceId}.xlsx`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (error: any) {
      console.error("loading report excel error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/invoices/:invoiceId/loading-report/export/pdf
  app.get("/api/factory/invoices/:invoiceId/loading-report/export/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const invoiceId = parseInt(req.params.invoiceId);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const summary = await buildLoadingSummary(invoiceId, companyId);
      if (!summary) return res.status(404).json({ message: "Invoice not found" });

      const inv = summary.invoice;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Loading Report - ${inv.invoiceNumber || "#" + inv.id}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { margin-bottom: 16px; }
  .meta span { margin-right: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 11px; border: 1px solid #d1d5db; }
  td { padding: 5px 8px; border: 1px solid #e5e7eb; font-size: 11px; }
  tr:nth-child(even) td { background: #f9fafb; }
  .badge-loaded { color: #15803d; font-weight: 600; }
  .badge-pending { color: #6b7280; }
  .totals { display: flex; gap: 32px; margin-bottom: 16px; }
  .totals div { text-align: center; }
  .totals .num { font-size: 22px; font-weight: 700; }
  .totals .lbl { font-size: 11px; color: #6b7280; }
  @media print { @page { margin: 16mm; } }
</style>
</head><body>
<h1>Invoice Loading Report</h1>
<div class="meta">
  <span><b>Invoice:</b> ${inv.invoiceNumber || "#" + inv.id}</span>
  <span><b>Customer:</b> ${inv.customerName || ""}</span>
  <span><b>Date:</b> ${inv.orderDate || ""}</span>
  <span><b>Status:</b> ${inv.status || ""}</span>
</div>
<div class="totals">
  <div><div class="num">${summary.totals.invoiceBales}</div><div class="lbl">Invoice Bales</div></div>
  <div><div class="num" style="color:#15803d">${summary.totals.alreadyLoaded}</div><div class="lbl">Loaded</div></div>
  <div><div class="num" style="color:#d97706">${summary.totals.remaining}</div><div class="lbl">Remaining</div></div>
</div>
<h2>Summary by Article</h2>
<table><tr><th>Article Code</th><th>Product</th><th>Invoice Qty</th><th>Loaded</th><th>Remaining</th></tr>
${summary.lines.map((l) => `<tr><td>${l.articleCode}</td><td>${l.productName || ""}</td><td>${l.invoiceQty}</td><td>${l.alreadyLoaded}</td><td>${l.remaining}</td></tr>`).join("")}
</table>
<h2>Loading Sessions</h2>
<table><tr><th>#</th><th>Status</th><th>Truck</th><th>Driver</th><th>Started</th><th>Completed</th><th>Bales</th></tr>
${summary.sessions.map((s, i) => `<tr><td>${i + 1}</td><td>${s.status}</td><td>${s.truckNo || ""}</td><td>${s.driverName || ""}</td><td>${s.startedAt ? new Date(s.startedAt).toLocaleString() : ""}</td><td>${s.completedAt ? new Date(s.completedAt).toLocaleString() : ""}</td><td>${s.totalBales}</td></tr>`).join("")}
</table>
<h2>Bale Details</h2>
<table><tr><th>#</th><th>Reference</th><th>Article Code</th><th>Product</th><th>Status</th></tr>
${summary.invoiceBales.map((b, i) => `<tr><td>${i + 1}</td><td>${b.baleReference}</td><td>${b.articleCode || ""}</td><td>${b.productName || ""}</td><td class="${b.loaded ? "badge-loaded" : "badge-pending"}">${b.loaded ? "Loaded" : "Pending"}</td></tr>`).join("")}
</table>
</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/invoice-loading-sessions/:sessionId/export/excel
  app.get("/api/factory/invoice-loading-sessions/:sessionId/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.id, sessionId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      if (!session) return res.status(404).json({ message: "Session not found" });

      const sessionBales = await db
        .select()
        .from(factoryInvoiceLoadingBales)
        .where(and(
          eq(factoryInvoiceLoadingBales.sessionId, sessionId),
          eq(factoryInvoiceLoadingBales.companyId, companyId),
        ))
        .orderBy(factoryInvoiceLoadingBales.scannedAt);

      const [invoice] = await db
        .select({ invoiceNumber: customerOrders.invoiceNumber, orderDate: customerOrders.orderDate, customerName: customers.legalName })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(eq(customerOrders.id, session.invoiceId));

      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const headerData = [
        ["Session Loading Report"],
        [],
        ["Invoice", invoice?.invoiceNumber || `#${session.invoiceId}`],
        ["Customer", invoice?.customerName || ""],
        ["Session", `#${session.id}`],
        ["Status", session.status],
        ["Truck No", session.truckNo || ""],
        ["Driver", session.driverName || ""],
        ["Notes", session.notes || ""],
        ["Started", session.startedAt ? new Date(session.startedAt).toLocaleString() : ""],
        ["Completed", session.completedAt ? new Date(session.completedAt).toLocaleString() : ""],
        ["Total Bales", sessionBales.length],
        [],
        ["#", "Bale Reference", "Article Code", "Product Name", "Weight (kg)", "Scanned At", "Scanned By"],
        ...sessionBales.map((b, i) => [
          i + 1, b.baleReference, b.articleCode || "", b.productName || "",
          b.weightKg, b.scannedAt ? new Date(b.scannedAt).toLocaleString() : "", b.scannedByName || "",
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(headerData);
      XLSX.utils.book_append_sheet(wb, ws, "Session");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const filename = `loading-session-${session.id}.xlsx`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/invoice-loading-sessions/:sessionId/export/pdf
  app.get("/api/factory/invoice-loading-sessions/:sessionId/export/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(and(
          eq(factoryInvoiceLoadingSessions.id, sessionId),
          eq(factoryInvoiceLoadingSessions.companyId, companyId),
        ));

      if (!session) return res.status(404).json({ message: "Session not found" });

      const sessionBales = await db
        .select()
        .from(factoryInvoiceLoadingBales)
        .where(and(
          eq(factoryInvoiceLoadingBales.sessionId, sessionId),
          eq(factoryInvoiceLoadingBales.companyId, companyId),
        ))
        .orderBy(factoryInvoiceLoadingBales.scannedAt);

      const [invoice] = await db
        .select({ invoiceNumber: customerOrders.invoiceNumber, orderDate: customerOrders.orderDate, customerName: customers.legalName })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(eq(customerOrders.id, session.invoiceId));

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Loading Session #${session.id}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; margin-bottom: 16px; }
  .meta .row { display: contents; }
  .meta .lbl { color: #6b7280; font-size: 11px; }
  .meta .val { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 11px; border: 1px solid #d1d5db; }
  td { padding: 5px 8px; border: 1px solid #e5e7eb; font-size: 11px; }
  tr:nth-child(even) td { background: #f9fafb; }
  .total-row { font-weight: 700; background: #f3f4f6; }
  @media print { @page { margin: 16mm; } }
</style>
</head><body>
<h1>Loading Session #${session.id}</h1>
<div class="meta">
  <span class="lbl">Invoice</span><span class="val">${invoice?.invoiceNumber || "#" + session.invoiceId}</span>
  <span class="lbl">Customer</span><span class="val">${invoice?.customerName || ""}</span>
  <span class="lbl">Status</span><span class="val">${session.status}</span>
  <span class="lbl">Truck No</span><span class="val">${session.truckNo || "—"}</span>
  <span class="lbl">Driver</span><span class="val">${session.driverName || "—"}</span>
  <span class="lbl">Notes</span><span class="val">${session.notes || "—"}</span>
  <span class="lbl">Started</span><span class="val">${session.startedAt ? new Date(session.startedAt).toLocaleString() : ""}</span>
  <span class="lbl">Completed</span><span class="val">${session.completedAt ? new Date(session.completedAt).toLocaleString() : "—"}</span>
  <span class="lbl">Total Bales</span><span class="val">${sessionBales.length}</span>
</div>
<h2>Scanned Bales</h2>
<table>
  <tr><th>#</th><th>Bale Reference</th><th>Article Code</th><th>Product Name</th><th>Weight (kg)</th><th>Scanned At</th></tr>
  ${sessionBales.map((b, i) => `<tr><td>${i + 1}</td><td>${b.baleReference}</td><td>${b.articleCode || ""}</td><td>${b.productName || ""}</td><td>${b.weightKg}</td><td>${b.scannedAt ? new Date(b.scannedAt).toLocaleString() : ""}</td></tr>`).join("")}
  <tr class="total-row"><td colspan="4">Total</td><td>${sessionBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3)}</td><td>${sessionBales.length} bales</td></tr>
</table>
</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
