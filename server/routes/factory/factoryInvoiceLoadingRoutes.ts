import { parseId, parseOptionalId } from "../../lib/parseId";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  customerOrders,
  customerOrderBales,
  customerOrderLines,
  customerProformas,
  customerProformaLines,
  customers,
  factoryBales,
  factoryInvoiceLoadingSessions,
  factoryInvoiceLoadingBales,
  locations,
} from "@shared/schema";
import { syncProformaReservations } from "./_stockReservationHelper";
import { eq, and, or, inArray, not, sql, ne } from "drizzle-orm";

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCompanyId(req: any): number | null {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId || null;
}

function buildExportFilename(parts: (string | null | undefined)[], ext: string): string {
  const safe = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) =>
      p
        .replace(/[\\/*?:[\]<>|]/g, "")
        .replace(/\s+/g, "_")
        .trim()
    )
    .filter((p) => p.length > 0);
  const base = safe.join("_") || "export";
  return ext ? `${base}.${ext}` : base;
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
      destination: customerOrders.destination,
      customerName: customers.legalName,
      customerCode: customers.code,
    })
    .from(customerOrders)
    .leftJoin(customers, eq(customerOrders.customerId, customers.id))
    .where(and(eq(customerOrders.id, invoiceId), eq(customerOrders.companyId, companyId)));

  if (!invoiceRow) return null;

  // 2. Invoice lines
  const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, invoiceId));

  // 3. Invoice bales (exact bale membership — the official list)
  // Use SELECT * so this query succeeds even when newer columns (bale_reference,
  // article_code, bale_name, price_used, location_id) are temporarily absent from
  // the production table.  A Drizzle-generated SELECT that names those columns
  // fails at parse time with "column X does not exist", which would break the
  // entire loading page.  SELECT * returns whatever exists; JS defaults fill gaps.
  const _invoiceBalesRawResult = await db.execute(
    sql`SELECT * FROM customer_order_bales WHERE order_id = ${invoiceId}`
  );
  const _invoiceBalesRows: any[] = (_invoiceBalesRawResult as any).rows ?? (_invoiceBalesRawResult as unknown as any[]);
  const invoiceBalesRaw = _invoiceBalesRows.map((r: any) => ({
    id: r.id as number,
    baleId: r.bale_id as number,
    baleReference: String(r.bale_reference ?? ""),
    articleCode: r.article_code != null ? String(r.article_code) : null,
    baleName: r.bale_name != null ? String(r.bale_name) : null,
    weight: r.weight,
    priceUsed: String(r.price_used ?? "0"),
  }));

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
    .where(
      and(
        eq(factoryInvoiceLoadingSessions.invoiceId, invoiceId),
        eq(factoryInvoiceLoadingSessions.companyId, companyId)
      )
    )
    .orderBy(factoryInvoiceLoadingSessions.startedAt);

  // 5. All loading bale rows for ACTIVE (non-cancelled) sessions only
  const activeSessions = sessions.filter((s) => s.status !== "CANCELLED");
  const activeSessionIds = activeSessions.map((s) => s.id);

  let loadedBaleRows: Array<{
    id: number;
    sessionId: number;
    baleId: number;
    baleReference: string;
    articleCode: string | null;
    productName: string | null;
    weightKg: string;
    scannedAt: Date;
    scannedByName: string | null;
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
  // Only count bales that are in the invoice's official bale list (not overloaded extras).
  // loadedBaleIdSet may include bales scanned in overloading scenarios that are not
  // part of this invoice; using .size directly would inflate alreadyLoaded and shrink
  // remaining incorrectly (e.g. 18 not loaded – 7 overloaded = 11 instead of 18).
  const totalInvoiceBales = invoiceBalesRaw.length || invoiceRow.totalQtyBales || 0;
  const invoiceBaleIdSet = new Set(invoiceBalesRaw.map((b) => b.baleId));
  const totalAlreadyLoaded = [...loadedBaleIdSet].filter((id) => invoiceBaleIdSet.has(id)).length;
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

      const invoiceId = parseId(req.params.invoiceId);

      if (invoiceId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const activeSessionId = req.query.sessionId ? (parseOptionalId(req.query.sessionId) ?? undefined) : undefined;

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

      const invoiceId = parseId(req.params.invoiceId);

      if (invoiceId === null) return res.status(400).json({ message: "Invalid id" });
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
        .where(
          and(
            eq(factoryInvoiceLoadingSessions.invoiceId, invoiceId),
            eq(factoryInvoiceLoadingSessions.companyId, companyId)
          )
        );

      const activeSessions = activeSessionRows.filter(async () => true); // all sessions
      if (activeSessions.length > 0) {
        const activeIds = activeSessions.map((s) => s.id);
        const [loadedCount] = await db
          .select({ count: sql<number>`COUNT(DISTINCT ${factoryInvoiceLoadingBales.baleId})` })
          .from(factoryInvoiceLoadingBales)
          .innerJoin(
            factoryInvoiceLoadingSessions,
            eq(factoryInvoiceLoadingBales.sessionId, factoryInvoiceLoadingSessions.id)
          )
          .where(
            and(
              eq(factoryInvoiceLoadingBales.invoiceId, invoiceId),
              ne(factoryInvoiceLoadingSessions.status, "CANCELLED")
            )
          );

        const loaded = Number(loadedCount?.count || 0);
        if (loaded >= invoiceBales.length) {
          return res
            .status(400)
            .json({ message: "This invoice is fully loaded — all bales have been assigned to loading sessions" });
        }
      }

      // Create session
      const userId = req.user?.id ?? null;
      const username = req.user?.username ?? "";
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

      const sessionId = parseId(req.params.sessionId);

      if (sessionId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const { barcode } = req.body;
      if (!barcode || !barcode.trim()) return res.status(400).json({ message: "Barcode is required" });

      const scanCode = barcode.trim();
      const scanLower = scanCode.toLowerCase();

      // Validate session
      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(
          and(eq(factoryInvoiceLoadingSessions.id, sessionId), eq(factoryInvoiceLoadingSessions.companyId, companyId))
        );

      if (!session) return res.status(404).json({ message: "Loading session not found" });
      if (session.status === "COMPLETED")
        return res.status(400).json({ message: "This loading session is already completed" });
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
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            not(inArray(factoryBales.status, ["DELETED", "REMOVED"])),
            or(
              sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
              sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`
            )
          )
        )
        .limit(5);

      if (baleMatches.length === 0) {
        return res.status(400).json({ message: `Bale "${scanCode}" not found in this company's inventory` });
      }

      const bale = baleMatches[0];

      // Validate bale belongs to this exact invoice (via customer_order_bales).
      // Only select the two core columns (order_id, bale_id) that have always
      // existed — avoiding parse-time failures when newer columns are absent.
      const _linkResult = await db.execute(
        sql`SELECT bale_id FROM customer_order_bales WHERE order_id = ${invoiceId} AND bale_id = ${bale.id} LIMIT 1`
      );
      const _linkRows: any[] = (_linkResult as any).rows ?? (_linkResult as unknown as any[]);
      const invoiceBaleLink = _linkRows.length > 0 ? { baleId: _linkRows[0].bale_id as number } : undefined;

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
          eq(factoryInvoiceLoadingBales.sessionId, factoryInvoiceLoadingSessions.id)
        )
        .where(
          and(
            eq(factoryInvoiceLoadingBales.invoiceId, invoiceId),
            eq(factoryInvoiceLoadingBales.baleId, bale.id),
            ne(factoryInvoiceLoadingSessions.status, "CANCELLED")
          )
        )
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
      const userId = req.user?.id ?? null;
      const username = req.user?.username ?? "";

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
  app.delete(
    "/api/factory/invoice-loading-sessions/:sessionId/bales/:baleId",
    requireAuth,
    async (req: any, res: any) => {
      try {
        const companyId = getCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const sessionId = parseId(req.params.sessionId);

        if (sessionId === null) return res.status(400).json({ message: "Invalid id" });
        const baleId = parseId(req.params.baleId);
        if (baleId === null) return res.status(400).json({ message: "Invalid id" });
        if (isNaN(sessionId) || isNaN(baleId)) return res.status(400).json({ message: "Invalid ID" });

        const [session] = await db
          .select()
          .from(factoryInvoiceLoadingSessions)
          .where(
            and(eq(factoryInvoiceLoadingSessions.id, sessionId), eq(factoryInvoiceLoadingSessions.companyId, companyId))
          );

        if (!session) return res.status(404).json({ message: "Session not found" });
        if (session.status === "CANCELLED")
          return res.status(400).json({ message: "Cannot remove bales from a cancelled session" });

        const deleted = await db
          .delete(factoryInvoiceLoadingBales)
          .where(
            and(
              eq(factoryInvoiceLoadingBales.sessionId, sessionId),
              eq(factoryInvoiceLoadingBales.baleId, baleId),
              eq(factoryInvoiceLoadingBales.companyId, companyId)
            )
          )
          .returning();

        if (deleted.length === 0) return res.status(404).json({ message: "Bale not found in this session" });

        const summary = await buildLoadingSummary(session.invoiceId, companyId, sessionId);
        res.json({ removed: deleted[0], summary });
      } catch (error: any) {
        console.error("remove bale error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // POST /api/factory/invoice-loading-sessions/:sessionId/complete
  app.post("/api/factory/invoice-loading-sessions/:sessionId/complete", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseId(req.params.sessionId);

      if (sessionId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(
          and(eq(factoryInvoiceLoadingSessions.id, sessionId), eq(factoryInvoiceLoadingSessions.companyId, companyId))
        );

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

      const sessionId = parseId(req.params.sessionId);

      if (sessionId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(
          and(eq(factoryInvoiceLoadingSessions.id, sessionId), eq(factoryInvoiceLoadingSessions.companyId, companyId))
        );

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

  // ── Export helpers ─────────────────────────────────────────────────────────

  /** Apply a solid fill to a cell */
  function cellFill(cell: any, argb: string) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }
  /** Apply thin borders to all four sides of a cell */
  function cellBorder(cell: any) {
    const s = { style: "thin", color: { argb: "FFD1D5DB" } };
    cell.border = { top: s, left: s, bottom: s, right: s };
  }
  /** Style a section-header row (dark navy bg, white bold) */
  function sectionHeader(ws: any, rowNum: number, value: string, cols: number) {
    const row = ws.getRow(rowNum);
    const cell = row.getCell(1);
    cell.value = value;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cellFill(cell, "FF1E3A5F");
    ws.mergeCells(rowNum, 1, rowNum, cols);
    row.height = 20;
  }
  /** Style a column-header row (light blue bg, dark blue bold) */
  function colHeaders(ws: any, rowNum: number, headers: string[]) {
    const row = ws.getRow(rowNum);
    headers.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FF1E40AF" }, size: 10 };
      cellFill(cell, "FFDBEAFE");
      cellBorder(cell);
      cell.alignment = { horizontal: i > 1 ? "right" : "left", vertical: "middle" };
    });
    row.height = 16;
  }
  /** Style a data cell */
  function dataCell(
    cell: any,
    value: any,
    opts: { bold?: boolean; color?: string; align?: string; fill?: string } = {}
  ) {
    cell.value = value;
    cell.font = { bold: opts.bold ?? false, color: { argb: opts.color ?? "FF111827" }, size: 10 };
    cell.alignment = { horizontal: (opts.align ?? "left") as any, vertical: "middle" };
    if (opts.fill) cellFill(cell, opts.fill);
    cellBorder(cell);
  }

  // ── Export endpoints ───────────────────────────────────────────────────────

  // GET /api/factory/invoices/:invoiceId/loading-report/export/excel
  app.get("/api/factory/invoices/:invoiceId/loading-report/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const invoiceId = parseId(req.params.invoiceId);

      if (invoiceId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const summary = await buildLoadingSummary(invoiceId, companyId);
      if (!summary) return res.status(404).json({ message: "Invoice not found" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "HMD International Group";
      wb.created = new Date();

      const inv = summary.invoice;
      const loadedBales = summary.invoiceBales.filter((b) => b.loaded);
      const remainingBales = summary.invoiceBales.filter((b) => !b.loaded);

      // ── Sheet 1: Summary ──
      const ws1 = wb.addWorksheet("Summary");
      ws1.columns = [
        { width: 18 },
        { width: 32 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 20 },
        { width: 20 },
      ];

      // Title
      ws1.mergeCells("A1:G1");
      const titleCell = ws1.getCell("A1");
      titleCell.value = "INVOICE LOADING REPORT";
      titleCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
      cellFill(titleCell, "FF1E3A5F");
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws1.getRow(1).height = 28;

      // Meta block
      ws1.getRow(2).height = 6;
      const meta = [
        ["Invoice", inv.invoiceNumber || `#${inv.id}`, "Customer", inv.customerName || ""],
        ["Date", inv.orderDate || "", "Status", inv.status || ""],
      ];
      let r = 3;
      meta.forEach((row) => {
        [0, 2].forEach((ci, idx) => {
          const lc = ws1.getRow(r).getCell(ci + 1);
          lc.value = row[ci];
          lc.font = { bold: true, color: { argb: "FF6B7280" }, size: 10 };
          lc.alignment = { horizontal: "right" };
          const vc = ws1.getRow(r).getCell(ci + 2);
          vc.value = row[ci + 1];
          vc.font = { bold: true, size: 10 };
        });
        ws1.getRow(r).height = 16;
        r++;
      });

      // Totals block
      ws1.getRow(r).height = 8;
      r++;
      const totalsRow = ws1.getRow(r);
      const totalDefs = [
        { label: "INVOICE BALES", val: summary.totals.invoiceBales, fill: "FFE0E7FF", fc: "FF3730A3" },
        { label: "LOADED", val: summary.totals.alreadyLoaded, fill: "FFD1FAE5", fc: "FF065F46" },
        {
          label: "REMAINING",
          val: summary.totals.remaining,
          fill: summary.totals.remaining === 0 ? "FFD1FAE5" : "FFFEF3C7",
          fc: summary.totals.remaining === 0 ? "FF065F46" : "FFB45309",
        },
      ];
      totalDefs.forEach((td, i) => {
        ws1.mergeCells(r, i * 2 + 1, r, i * 2 + 2);
        const hc = ws1.getRow(r).getCell(i * 2 + 1);
        hc.value = td.label;
        hc.font = { bold: true, color: { argb: "FF6B7280" }, size: 9 };
        cellFill(hc, td.fill);
        hc.alignment = { horizontal: "center" };
      });
      totalsRow.height = 16;
      r++;
      const valsRow = ws1.getRow(r);
      totalDefs.forEach((td, i) => {
        ws1.mergeCells(r, i * 2 + 1, r, i * 2 + 2);
        const vc = ws1.getRow(r).getCell(i * 2 + 1);
        vc.value = td.val;
        vc.font = { bold: true, color: { argb: td.fc }, size: 20 };
        cellFill(vc, td.fill);
        vc.alignment = { horizontal: "center", vertical: "middle" };
      });
      valsRow.height = 32;
      r++;

      // Summary by article
      ws1.getRow(r).height = 8;
      r++;
      sectionHeader(ws1, r, "SUMMARY BY ARTICLE", 6);
      r++;
      colHeaders(ws1, r, ["Article Code", "Product Name", "Invoice Qty", "Loaded", "Remaining", "Progress"]);
      r++;
      summary.lines.forEach((l, i) => {
        const pct = l.invoiceQty > 0 ? Math.round((l.alreadyLoaded / l.invoiceQty) * 100) : 0;
        const fillColor = l.remaining === 0 ? "FFF0FDF4" : i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
        const row = ws1.getRow(r);
        dataCell(row.getCell(1), l.articleCode, { fill: fillColor });
        dataCell(row.getCell(2), l.productName, { fill: fillColor });
        dataCell(row.getCell(3), l.invoiceQty, { align: "right", fill: fillColor });
        dataCell(row.getCell(4), l.alreadyLoaded, {
          align: "right",
          fill: fillColor,
          color: "FF065F46",
          bold: l.alreadyLoaded > 0,
        });
        dataCell(row.getCell(5), l.remaining, {
          align: "right",
          fill: fillColor,
          color: l.remaining === 0 ? "FF065F46" : "FFB45309",
          bold: true,
        });
        dataCell(row.getCell(6), `${pct}%`, {
          align: "right",
          fill: fillColor,
          color: pct === 100 ? "FF065F46" : "FF6B7280",
        });
        row.height = 15;
        r++;
      });

      // Loading sessions
      ws1.getRow(r).height = 8;
      r++;
      sectionHeader(ws1, r, "LOADING SESSIONS", 7);
      r++;
      colHeaders(ws1, r, ["Session #", "Status", "Truck No", "Driver", "Started", "Completed", "Bales"]);
      r++;
      summary.sessions.forEach((s, i) => {
        const fill = i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
        const row = ws1.getRow(r);
        dataCell(row.getCell(1), `#${s.id}`, { fill });
        const sc = row.getCell(2);
        sc.value = s.status;
        sc.font = {
          bold: true,
          size: 10,
          color: { argb: s.status === "COMPLETED" ? "FF065F46" : s.status === "CANCELLED" ? "FF6B7280" : "FF1D4ED8" },
        };
        cellFill(sc, fill);
        cellBorder(sc);
        dataCell(row.getCell(3), s.truckNo || "—", { fill });
        dataCell(row.getCell(4), s.driverName || "—", { fill });
        dataCell(row.getCell(5), s.startedAt ? new Date(s.startedAt).toLocaleString() : "", { fill });
        dataCell(row.getCell(6), s.completedAt ? new Date(s.completedAt).toLocaleString() : "—", { fill });
        dataCell(row.getCell(7), s.totalBales, { align: "right", bold: true, fill });
        row.height = 15;
        r++;
      });

      // ── Sheet 2: Loaded Bales ──
      const ws2 = wb.addWorksheet("Loaded Bales");
      ws2.columns = [
        { width: 6 },
        { width: 20 },
        { width: 16 },
        { width: 32 },
        { width: 14 },
        { width: 12 },
        { width: 24 },
      ];
      sectionHeader(ws2, 1, `LOADED BALES  (${loadedBales.length} of ${summary.totals.invoiceBales})`, 7);
      colHeaders(ws2, 2, [
        "#",
        "Bale Reference",
        "Article Code",
        "Product Name",
        "Weight (kg)",
        "Session",
        "Loaded At",
      ]);
      loadedBales.forEach((b, i) => {
        const row = ws2.getRow(i + 3);
        const fill = i % 2 === 0 ? "FFF0FDF4" : "FFFAFFFE";
        dataCell(row.getCell(1), i + 1, { align: "right", fill });
        dataCell(row.getCell(2), b.baleReference, { fill });
        dataCell(row.getCell(3), b.articleCode || "", { fill });
        dataCell(row.getCell(4), b.productName || "", { fill });
        dataCell(row.getCell(5), parseFloat(b.weightKg || "0").toFixed(3), { align: "right", fill });
        dataCell(row.getCell(6), b.loadedSessionId ? `#${b.loadedSessionId}` : "", { align: "center", fill });
        dataCell(row.getCell(7), b.loadedAt ? new Date(b.loadedAt).toLocaleString() : "", { fill });
        row.height = 15;
      });
      // Total weight row
      if (loadedBales.length > 0) {
        const tr = ws2.getRow(loadedBales.length + 3);
        ws2.mergeCells(loadedBales.length + 3, 1, loadedBales.length + 3, 4);
        dataCell(tr.getCell(1), `Total: ${loadedBales.length} bales`, { bold: true, fill: "FFDBEAFE" });
        dataCell(tr.getCell(5), loadedBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3), {
          bold: true,
          align: "right",
          fill: "FFDBEAFE",
        });
        tr.height = 16;
      }

      // ── Sheet 3: Remaining Bales ──
      const ws3 = wb.addWorksheet("Remaining Bales");
      ws3.columns = [{ width: 6 }, { width: 20 }, { width: 16 }, { width: 32 }, { width: 14 }];
      sectionHeader(ws3, 1, `REMAINING BALES TO LOAD  (${remainingBales.length} bales)`, 5);
      if (remainingBales.length === 0) {
        ws3.mergeCells("A2:E2");
        const dc = ws3.getCell("A2");
        dc.value = "All bales have been loaded.";
        dc.font = { bold: true, color: { argb: "FF065F46" }, size: 11 };
        cellFill(dc, "FFD1FAE5");
        dc.alignment = { horizontal: "center" };
        ws3.getRow(2).height = 24;
      } else {
        colHeaders(ws3, 2, ["#", "Bale Reference", "Article Code", "Product Name", "Weight (kg)"]);
        remainingBales.forEach((b, i) => {
          const row = ws3.getRow(i + 3);
          const fill = i % 2 === 0 ? "FFFEF3C7" : "FFFFFBEB";
          dataCell(row.getCell(1), i + 1, { align: "right", fill });
          dataCell(row.getCell(2), b.baleReference, { bold: true, fill });
          dataCell(row.getCell(3), b.articleCode || "", { fill });
          dataCell(row.getCell(4), b.productName || "", { fill });
          dataCell(row.getCell(5), parseFloat(b.weightKg || "0").toFixed(3), { align: "right", fill });
          row.height = 15;
        });
        // Total row
        const tr = ws3.getRow(remainingBales.length + 3);
        ws3.mergeCells(remainingBales.length + 3, 1, remainingBales.length + 3, 4);
        dataCell(tr.getCell(1), `Total: ${remainingBales.length} bales remaining`, { bold: true, fill: "FFFEF3C7" });
        dataCell(tr.getCell(5), remainingBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3), {
          bold: true,
          align: "right",
          fill: "FFFEF3C7",
        });
        tr.height = 16;
      }

      const filename = buildExportFilename([inv.containerNumber, inv.customerName, inv.destination], "xlsx");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.end(await wb.xlsx.writeBuffer());
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

      const invoiceId = parseId(req.params.invoiceId);

      if (invoiceId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const summary = await buildLoadingSummary(invoiceId, companyId);
      if (!summary) return res.status(404).json({ message: "Invoice not found" });

      const inv = summary.invoice;
      const remainingBales = summary.invoiceBales.filter((b) => !b.loaded);
      const loadedBales = summary.invoiceBales.filter((b) => b.loaded);

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Loading Report - ${inv.invoiceNumber || "#" + inv.id}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px 24px; color: #111827; background: #fff; }
  .header { background: #1e3a5f; color: #fff; padding: 12px 16px; border-radius: 4px; margin-bottom: 14px; }
  .header h1 { font-size: 16px; font-weight: 700; letter-spacing: 0.5px; }
  .header p { font-size: 10px; opacity: 0.75; margin-top: 2px; }
  .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; padding: 6px 10px; }
  .meta-box .lbl { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; }
  .meta-box .val { font-weight: 700; font-size: 11px; margin-top: 2px; }
  .totals { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 14px; }
  .total-box { border-radius: 4px; padding: 10px; text-align: center; }
  .total-box .num { font-size: 28px; font-weight: 800; line-height: 1; }
  .total-box .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 3px; }
  .total-all { background: #e0e7ff; color: #3730a3; }
  .total-loaded { background: #d1fae5; color: #065f46; }
  .total-remaining { background: #fef3c7; color: #b45309; }
  .total-remaining.done { background: #d1fae5; color: #065f46; }
  .section-title { background: #1e3a5f; color: #fff; font-size: 10px; font-weight: 700; padding: 5px 8px; letter-spacing: 0.5px; margin-top: 12px; margin-bottom: 0; border-radius: 3px 3px 0 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #dbeafe; color: #1e40af; font-size: 9px; font-weight: 700; padding: 5px 7px; border: 1px solid #bfdbfe; text-align: left; }
  th.r { text-align: right; }
  td { padding: 4px 7px; border: 1px solid #e5e7eb; font-size: 10px; }
  td.r { text-align: right; }
  tr:nth-child(even) td { background: #f8fafc; }
  .loaded-row td { background: #f0fdf4; }
  .remaining-row td { background: #fffbeb; }
  .total-row td { background: #dbeafe; font-weight: 700; }
  .status-completed { color: #065f46; font-weight: 700; }
  .status-open { color: #1d4ed8; font-weight: 700; }
  .status-cancelled { color: #6b7280; }
  .badge-loaded { color: #065f46; font-weight: 700; }
  .badge-pending { color: #b45309; font-weight: 700; }
  .all-done { background: #d1fae5; color: #065f46; padding: 8px 12px; border-radius: 3px; font-weight: 700; text-align: center; margin-bottom: 12px; }
  @media print { @page { margin: 12mm; } .section-title { break-after: avoid; } }
</style></head><body>

<div class="header">
  <h1>INVOICE LOADING REPORT</h1>
  <p>Generated ${new Date().toLocaleString()}</p>
</div>

<div class="meta-grid">
  <div class="meta-box"><div class="lbl">Invoice</div><div class="val">${inv.invoiceNumber || "#" + inv.id}</div></div>
  <div class="meta-box"><div class="lbl">Customer</div><div class="val">${inv.customerName || "—"}</div></div>
  <div class="meta-box"><div class="lbl">Date</div><div class="val">${inv.orderDate || "—"}</div></div>
  <div class="meta-box"><div class="lbl">Status</div><div class="val">${inv.status || "—"}</div></div>
</div>

<div class="totals">
  <div class="total-box total-all"><div class="num">${summary.totals.invoiceBales}</div><div class="lbl">Invoice Bales</div></div>
  <div class="total-box total-loaded"><div class="num">${summary.totals.alreadyLoaded}</div><div class="lbl">Loaded</div></div>
  <div class="total-box total-remaining${summary.totals.remaining === 0 ? " done" : ""}"><div class="num">${summary.totals.remaining}</div><div class="lbl">Remaining</div></div>
</div>

<div class="section-title">SUMMARY BY ARTICLE</div>
<table>
  <tr><th>Article Code</th><th>Product Name</th><th class="r">Invoice Qty</th><th class="r">Loaded</th><th class="r">Remaining</th><th class="r">Progress</th></tr>
  ${summary.lines
    .map((l) => {
      const pct = l.invoiceQty > 0 ? Math.round((l.alreadyLoaded / l.invoiceQty) * 100) : 0;
      return `<tr${l.remaining === 0 ? ' class="loaded-row"' : ""}><td>${l.articleCode}</td><td>${l.productName || ""}</td><td class="r">${l.invoiceQty}</td><td class="r">${l.alreadyLoaded}</td><td class="r ${l.remaining === 0 ? "badge-loaded" : "badge-pending"}">${l.remaining}</td><td class="r">${pct}%</td></tr>`;
    })
    .join("")}
</table>

<div class="section-title">LOADING SESSIONS (${summary.sessions.length})</div>
<table>
  <tr><th>#</th><th>Status</th><th>Truck</th><th>Driver</th><th>Started</th><th>Completed</th><th class="r">Bales</th></tr>
  ${summary.sessions.map((s, i) => `<tr><td>${i + 1}</td><td class="status-${s.status.toLowerCase()}">${s.status}</td><td>${s.truckNo || "—"}</td><td>${s.driverName || "—"}</td><td>${s.startedAt ? new Date(s.startedAt).toLocaleString() : ""}</td><td>${s.completedAt ? new Date(s.completedAt).toLocaleString() : "—"}</td><td class="r">${s.totalBales}</td></tr>`).join("")}
</table>

<div class="section-title">LOADED BALES (${loadedBales.length})</div>
<table>
  <tr><th>#</th><th>Bale Reference</th><th>Article Code</th><th>Product Name</th><th class="r">Weight (kg)</th><th class="r">Session</th></tr>
  ${loadedBales.map((b, i) => `<tr class="loaded-row"><td>${i + 1}</td><td>${b.baleReference}</td><td>${b.articleCode || ""}</td><td>${b.productName || ""}</td><td class="r">${parseFloat(b.weightKg || "0").toFixed(3)}</td><td class="r">${b.loadedSessionId ? "#" + b.loadedSessionId : ""}</td></tr>`).join("")}
  <tr class="total-row"><td colspan="4">Total loaded</td><td class="r">${loadedBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3)}</td><td class="r">${loadedBales.length} bales</td></tr>
</table>

<div class="section-title">REMAINING BALES TO LOAD (${remainingBales.length})</div>
${
  remainingBales.length === 0
    ? `<div class="all-done">All bales have been loaded.</div>`
    : `<table>
  <tr><th>#</th><th>Bale Reference</th><th>Article Code</th><th>Product Name</th><th class="r">Weight (kg)</th></tr>
  ${remainingBales.map((b, i) => `<tr class="remaining-row"><td>${i + 1}</td><td>${b.baleReference}</td><td>${b.articleCode || ""}</td><td>${b.productName || ""}</td><td class="r">${parseFloat(b.weightKg || "0").toFixed(3)}</td></tr>`).join("")}
  <tr class="total-row"><td colspan="4">Total remaining</td><td class="r">${remainingBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3)} kg · ${remainingBales.length} bales</td></tr>
</table>`
}

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

      const sessionId = parseId(req.params.sessionId);

      if (sessionId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(
          and(eq(factoryInvoiceLoadingSessions.id, sessionId), eq(factoryInvoiceLoadingSessions.companyId, companyId))
        );

      if (!session) return res.status(404).json({ message: "Session not found" });

      const [sessionBalesRaw, invoice, invoiceSummary] = await Promise.all([
        db
          .select()
          .from(factoryInvoiceLoadingBales)
          .where(
            and(
              eq(factoryInvoiceLoadingBales.sessionId, sessionId),
              eq(factoryInvoiceLoadingBales.companyId, companyId)
            )
          )
          .orderBy(factoryInvoiceLoadingBales.scannedAt),
        db
          .select({
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            customerName: customers.legalName,
            containerNumber: customerOrders.containerNumber,
            destination: customerOrders.destination,
          })
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, session.invoiceId))
          .then((r) => r[0]),
        buildLoadingSummary(session.invoiceId, companyId, sessionId),
      ]);

      const remainingBales = invoiceSummary?.invoiceBales.filter((b) => !b.loaded) ?? [];

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "HMD International Group";

      // ── Sheet 1: Session ──
      const ws = wb.addWorksheet("Session");
      ws.columns = [
        { width: 6 },
        { width: 22 },
        { width: 16 },
        { width: 32 },
        { width: 14 },
        { width: 26 },
        { width: 18 },
      ];

      // Title
      ws.mergeCells("A1:G1");
      const tc = ws.getCell("A1");
      tc.value = `LOADING SESSION #${session.id}`;
      tc.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
      cellFill(tc, "FF1E3A5F");
      tc.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 28;

      // Meta info
      ws.getRow(2).height = 6;
      const metaItems = [
        ["Invoice", invoice?.invoiceNumber || `#${session.invoiceId}`, "Customer", invoice?.customerName || ""],
        ["Status", session.status, "Truck No", session.truckNo || "—"],
        ["Driver", session.driverName || "—", "Notes", session.notes || "—"],
        [
          "Started",
          session.startedAt ? new Date(session.startedAt).toLocaleString() : "",
          "Completed",
          session.completedAt ? new Date(session.completedAt).toLocaleString() : "—",
        ],
        [
          "Scanned this session",
          sessionBalesRaw.length.toString(),
          "Remaining overall",
          remainingBales.length.toString(),
        ],
      ];
      let r = 3;
      metaItems.forEach((row) => {
        [0, 2].forEach((ci) => {
          const lc = ws.getRow(r).getCell(ci + 1);
          lc.value = row[ci];
          lc.font = { bold: true, color: { argb: "FF6B7280" }, size: 10 };
          lc.alignment = { horizontal: "right" };
          const vc = ws.getRow(r).getCell(ci + 2);
          vc.value = row[ci + 1];
          vc.font = { bold: true, size: 10 };
        });
        ws.getRow(r).height = 16;
        r++;
      });

      // Scanned bales
      ws.getRow(r).height = 8;
      r++;
      sectionHeader(ws, r, `SCANNED BALES (${sessionBalesRaw.length})`, 7);
      r++;
      colHeaders(ws, r, [
        "#",
        "Bale Reference",
        "Article Code",
        "Product Name",
        "Weight (kg)",
        "Scanned At",
        "Scanned By",
      ]);
      r++;
      sessionBalesRaw.forEach((b, i) => {
        const row = ws.getRow(r);
        const fill = i % 2 === 0 ? "FFF0FDF4" : "FFFAFFFE";
        dataCell(row.getCell(1), i + 1, { align: "right", fill });
        dataCell(row.getCell(2), b.baleReference, { bold: true, fill });
        dataCell(row.getCell(3), b.articleCode || "", { fill });
        dataCell(row.getCell(4), b.productName || "", { fill });
        dataCell(row.getCell(5), parseFloat(b.weightKg || "0").toFixed(3), { align: "right", fill });
        dataCell(row.getCell(6), b.scannedAt ? new Date(b.scannedAt).toLocaleString() : "", { fill });
        dataCell(row.getCell(7), b.scannedByName || "", { fill });
        row.height = 15;
        r++;
      });
      // Total row
      if (sessionBalesRaw.length > 0) {
        const tr = ws.getRow(r);
        ws.mergeCells(r, 1, r, 4);
        dataCell(tr.getCell(1), `Total: ${sessionBalesRaw.length} bales`, { bold: true, fill: "FFDBEAFE" });
        dataCell(tr.getCell(5), sessionBalesRaw.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3), {
          bold: true,
          align: "right",
          fill: "FFDBEAFE",
        });
        tr.height = 16;
        r++;
      }

      // Remaining bales
      ws.getRow(r).height = 8;
      r++;
      sectionHeader(ws, r, `REMAINING BALES TO LOAD (${remainingBales.length})`, 5);
      r++;
      if (remainingBales.length === 0) {
        ws.mergeCells(r, 1, r, 5);
        const dc = ws.getRow(r).getCell(1);
        dc.value = "All bales have been loaded.";
        dc.font = { bold: true, color: { argb: "FF065F46" }, size: 10 };
        cellFill(dc, "FFD1FAE5");
        dc.alignment = { horizontal: "center" };
        ws.getRow(r).height = 20;
      } else {
        colHeaders(ws, r, ["#", "Bale Reference", "Article Code", "Product Name", "Weight (kg)"]);
        r++;
        remainingBales.forEach((b, i) => {
          const row = ws.getRow(r);
          const fill = i % 2 === 0 ? "FFFEF3C7" : "FFFFFBEB";
          dataCell(row.getCell(1), i + 1, { align: "right", fill });
          dataCell(row.getCell(2), b.baleReference, { bold: true, fill });
          dataCell(row.getCell(3), b.articleCode || "", { fill });
          dataCell(row.getCell(4), b.productName || "", { fill });
          dataCell(row.getCell(5), parseFloat(b.weightKg || "0").toFixed(3), { align: "right", fill });
          row.height = 15;
          r++;
        });
        const tr = ws.getRow(r);
        ws.mergeCells(r, 1, r, 4);
        dataCell(tr.getCell(1), `Total remaining: ${remainingBales.length} bales`, { bold: true, fill: "FFFEF3C7" });
        dataCell(tr.getCell(5), remainingBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3), {
          bold: true,
          align: "right",
          fill: "FFFEF3C7",
        });
        tr.height = 16;
      }

      const filename = buildExportFilename(
        [invoice?.containerNumber, invoice?.customerName, invoice?.destination],
        "xlsx"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.end(await wb.xlsx.writeBuffer());
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/invoice-loading-sessions/:sessionId/export/pdf
  app.get("/api/factory/invoice-loading-sessions/:sessionId/export/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessionId = parseId(req.params.sessionId);

      if (sessionId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const [session] = await db
        .select()
        .from(factoryInvoiceLoadingSessions)
        .where(
          and(eq(factoryInvoiceLoadingSessions.id, sessionId), eq(factoryInvoiceLoadingSessions.companyId, companyId))
        );

      if (!session) return res.status(404).json({ message: "Session not found" });

      const [sessionBales, invoice, invoiceSummary] = await Promise.all([
        db
          .select()
          .from(factoryInvoiceLoadingBales)
          .where(
            and(
              eq(factoryInvoiceLoadingBales.sessionId, sessionId),
              eq(factoryInvoiceLoadingBales.companyId, companyId)
            )
          )
          .orderBy(factoryInvoiceLoadingBales.scannedAt),
        db
          .select({
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            customerName: customers.legalName,
            containerNumber: customerOrders.containerNumber,
            destination: customerOrders.destination,
          })
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, session.invoiceId))
          .then((r) => r[0]),
        buildLoadingSummary(session.invoiceId, companyId, sessionId),
      ]);

      const remainingBales = invoiceSummary?.invoiceBales.filter((b) => !b.loaded) ?? [];

      const pdfTitle = buildExportFilename([invoice?.containerNumber, invoice?.customerName, invoice?.destination], "");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${pdfTitle || `Loading Session #${session.id}`}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px 24px; color: #111827; }
  .header { background: #1e3a5f; color: #fff; padding: 12px 16px; border-radius: 4px; margin-bottom: 14px; }
  .header h1 { font-size: 15px; font-weight: 700; }
  .header p { font-size: 9px; opacity: 0.7; margin-top: 2px; }
  .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 12px; }
  .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; padding: 5px 8px; }
  .meta-box .lbl { font-size: 8px; color: #6b7280; text-transform: uppercase; }
  .meta-box .val { font-weight: 700; font-size: 10px; margin-top: 1px; }
  .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .total-box { border-radius: 3px; padding: 8px; text-align: center; }
  .total-box .num { font-size: 24px; font-weight: 800; line-height: 1; }
  .total-box .lbl { font-size: 8px; text-transform: uppercase; margin-top: 2px; }
  .t-scanned { background: #d1fae5; color: #065f46; }
  .t-remaining { background: #fef3c7; color: #b45309; }
  .t-remaining.done { background: #d1fae5; color: #065f46; }
  .section-title { background: #1e3a5f; color: #fff; font-size: 9px; font-weight: 700; padding: 4px 8px; letter-spacing: 0.5px; margin-top: 10px; border-radius: 3px 3px 0 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #dbeafe; color: #1e40af; font-size: 8px; font-weight: 700; padding: 4px 6px; border: 1px solid #bfdbfe; }
  th.r { text-align: right; }
  td { padding: 3px 6px; border: 1px solid #e5e7eb; font-size: 10px; }
  td.r { text-align: right; }
  tr:nth-child(even) td { background: #f8fafc; }
  .scanned-row td { background: #f0fdf4; }
  .remaining-row td { background: #fffbeb; }
  .total-row td { background: #dbeafe; font-weight: 700; font-size: 10px; }
  .all-done { background: #d1fae5; color: #065f46; padding: 7px; border-radius: 3px; font-weight: 700; text-align: center; margin-bottom: 10px; font-size: 10px; }
  @media print { @page { margin: 12mm; } }
</style></head><body>

<div class="header">
  <h1>LOADING SESSION #${session.id}</h1>
  <p>Generated ${new Date().toLocaleString()}</p>
</div>

<div class="meta-grid">
  <div class="meta-box"><div class="lbl">Invoice</div><div class="val">${invoice?.invoiceNumber || "#" + session.invoiceId}</div></div>
  <div class="meta-box"><div class="lbl">Customer</div><div class="val">${invoice?.customerName || "—"}</div></div>
  <div class="meta-box"><div class="lbl">Truck No</div><div class="val">${session.truckNo || "—"}</div></div>
  <div class="meta-box"><div class="lbl">Driver</div><div class="val">${session.driverName || "—"}</div></div>
  <div class="meta-box"><div class="lbl">Status</div><div class="val">${session.status}</div></div>
  <div class="meta-box"><div class="lbl">Started</div><div class="val">${session.startedAt ? new Date(session.startedAt).toLocaleString() : "—"}</div></div>
  <div class="meta-box"><div class="lbl">Completed</div><div class="val">${session.completedAt ? new Date(session.completedAt).toLocaleString() : "—"}</div></div>
  <div class="meta-box"><div class="lbl">Notes</div><div class="val">${session.notes || "—"}</div></div>
</div>

<div class="totals">
  <div class="total-box t-scanned"><div class="num">${sessionBales.length}</div><div class="lbl">Scanned This Session</div></div>
  <div class="total-box t-remaining${remainingBales.length === 0 ? " done" : ""}"><div class="num">${remainingBales.length}</div><div class="lbl">Remaining Overall</div></div>
</div>

<div class="section-title">SCANNED BALES (${sessionBales.length})</div>
<table>
  <tr><th>#</th><th>Bale Reference</th><th>Article Code</th><th>Product Name</th><th class="r">Weight (kg)</th><th>Scanned At</th></tr>
  ${sessionBales.map((b, i) => `<tr class="scanned-row"><td>${i + 1}</td><td>${b.baleReference}</td><td>${b.articleCode || ""}</td><td>${b.productName || ""}</td><td class="r">${parseFloat(b.weightKg || "0").toFixed(3)}</td><td>${b.scannedAt ? new Date(b.scannedAt).toLocaleString() : ""}</td></tr>`).join("")}
  <tr class="total-row"><td colspan="4">Total</td><td class="r">${sessionBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3)}</td><td>${sessionBales.length} bales</td></tr>
</table>

<div class="section-title">REMAINING BALES TO LOAD (${remainingBales.length})</div>
${
  remainingBales.length === 0
    ? `<div class="all-done">All bales for this invoice have been loaded.</div>`
    : `<table>
  <tr><th>#</th><th>Bale Reference</th><th>Article Code</th><th>Product Name</th><th class="r">Weight (kg)</th></tr>
  ${remainingBales.map((b, i) => `<tr class="remaining-row"><td>${i + 1}</td><td>${b.baleReference}</td><td>${b.articleCode || ""}</td><td>${b.productName || ""}</td><td class="r">${parseFloat(b.weightKg || "0").toFixed(3)}</td></tr>`).join("")}
  <tr class="total-row"><td colspan="4">Total remaining</td><td class="r">${remainingBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0).toFixed(3)} kg · ${remainingBales.length} bales</td></tr>
</table>`
}

</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/invoices/:invoiceId/create-remaining-proforma
  // Creates a new proforma with all lines that still have remaining (unloaded) bales.
  app.post("/api/factory/invoices/:invoiceId/create-remaining-proforma", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const invoiceId = parseId(req.params.invoiceId);
      if (invoiceId === null) return res.status(400).json({ message: "Invalid invoice ID" });

      const summary = await buildLoadingSummary(invoiceId, companyId);
      if (!summary) return res.status(404).json({ message: "Invoice not found" });

      const pendingLines = summary.lines.filter((l) => l.remaining > 0);
      if (pendingLines.length === 0) {
        return res.status(400).json({ message: "No remaining bales — all lines are fully loaded." });
      }

      const inv = summary.invoice;
      const invoiceLabel = inv.invoiceNumber || `Order #${inv.id}`;
      const today = new Date().toISOString().slice(0, 10);
      const proformaName = `Remaining - ${invoiceLabel} - ${today}`;

      const result = await db.transaction(async (tx: any) => {
        const [proforma] = await tx
          .insert(customerProformas)
          .values({
            companyId,
            customerId: inv.customerId,
            name: proformaName,
            isActive: true,
          })
          .returning();

        // Build lines from the original invoice order lines
        const originalLines = summary.lines;
        const lineValues = pendingLines.map((pl) => {
          const orig = originalLines.find((l) => l.articleCode === pl.articleCode);
          return {
            proformaId: proforma.id,
            articleCode: pl.articleCode,
            productName: pl.productName,
            quantity: pl.remaining,
            pricePerBale: orig?.pricePerBale ?? "0",
            productionPricePerBale: "0",
            pricingMode: "per_bale" as const,
            pricePerKg: null as string | null,
          };
        });

        await tx.insert(customerProformaLines).values(lineValues);
        return proforma;
      });

      // Sync reservations outside transaction
      await syncProformaReservations(db, companyId, result.id).catch(() => {});

      res.json({ proformaId: result.id, proformaName });
    } catch (error: any) {
      console.error("create-remaining-proforma error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
