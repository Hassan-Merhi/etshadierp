import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import {
  intercompanyAccountLinks,
  intercompanyLinkRecipients,
  intercompanyPaymentRequests,
  vouchers,
  voucherEntries,
  companies,
  ledgerAccounts,
  users,
} from "@shared/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

// ── Helper: fire-and-forget intercompany notification trigger ────────────────
// Call after a voucher is successfully saved. Checks if any ledger entry in
// the new voucher matches a source account in intercompany_account_links.
// Never throws — errors are logged and swallowed so the voucher save succeeds.
export async function triggerIntercompanyNotifications(
  companyId: number,
  voucherId: number,
  voucherNumber: string,
  voucherDate: string,
  amount: string,
  description: string | null,
  entryLedgerAccountIds: (number | null)[],
) {
  try {
    const ledgerIds = entryLedgerAccountIds.filter((id): id is number => id !== null && id !== undefined);
    if (ledgerIds.length === 0) return;

    // Find any intercompany links where source matches this company + one of the ledger accounts
    const links = await db
      .select()
      .from(intercompanyAccountLinks)
      .where(
        and(
          eq(intercompanyAccountLinks.sourceCompanyId, companyId),
          eq(intercompanyAccountLinks.active, true),
          inArray(intercompanyAccountLinks.sourceLedgerAccountId, ledgerIds),
        ),
      );

    if (links.length === 0) return;

    for (const link of links) {
      // Insert one pending request per matching link
      await db.insert(intercompanyPaymentRequests).values({
        linkId: link.id,
        fromCompanyId: companyId,
        fromVoucherId: voucherId,
        fromVoucherNumber: voucherNumber,
        fromVoucherDate: voucherDate,
        amount,
        description: description || null,
        status: "pending",
      });
    }
  } catch (err: any) {
    console.error("[IntercompanyNotif] trigger failed (non-fatal):", err?.message);
  }
}

export function registerIntercompanyNotificationRoutes(app: Express) {
  // ── GET /api/intercompany-links ─────────────────────────────────────────────
  app.get("/api/intercompany-links", requireAuth, async (req, res) => {
    try {
      const links = await db
        .select({
          id: intercompanyAccountLinks.id,
          label: intercompanyAccountLinks.label,
          sourceCompanyId: intercompanyAccountLinks.sourceCompanyId,
          destCompanyId: intercompanyAccountLinks.destCompanyId,
          sourceLedgerAccountId: intercompanyAccountLinks.sourceLedgerAccountId,
          destLedgerAccountId: intercompanyAccountLinks.destLedgerAccountId,
          active: intercompanyAccountLinks.active,
          createdAt: intercompanyAccountLinks.createdAt,
          sourceCompanyName: companies.name,
          sourceLedgerName: ledgerAccounts.name,
        })
        .from(intercompanyAccountLinks)
        .leftJoin(companies, eq(companies.id, intercompanyAccountLinks.sourceCompanyId))
        .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, intercompanyAccountLinks.sourceLedgerAccountId))
        .orderBy(desc(intercompanyAccountLinks.createdAt));

      // Enrich with dest company and dest ledger names
      const allCompanies = await db.select({ id: companies.id, name: companies.name }).from(companies);
      const allAccounts = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, companyId: ledgerAccounts.companyId }).from(ledgerAccounts);
      const companyMap = new Map(allCompanies.map(c => [c.id, c.name]));
      const accountMap = new Map(allAccounts.map(a => [a.id, a.name]));

      const enriched = links.map(l => ({
        ...l,
        destCompanyName: companyMap.get(l.destCompanyId) ?? "Unknown",
        destLedgerName: accountMap.get(l.destLedgerAccountId) ?? "Unknown",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/intercompany-links/:id/recipients ──────────────────────────────
  app.get("/api/intercompany-links/:id/recipients", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      if (isNaN(linkId)) return res.status(400).json({ message: "Invalid ID" });

      const rows = await db
        .select({
          id: intercompanyLinkRecipients.id,
          userId: intercompanyLinkRecipients.userId,
          username: users.username,
        })
        .from(intercompanyLinkRecipients)
        .leftJoin(users, eq(users.id, intercompanyLinkRecipients.userId))
        .where(eq(intercompanyLinkRecipients.linkId, linkId));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/intercompany-links ────────────────────────────────────────────
  app.post("/api/intercompany-links", requireAuth, async (req, res) => {
    try {
      const { label, sourceCompanyId, sourceLedgerAccountId, destCompanyId, destLedgerAccountId, recipientUserIds = [] } = req.body;
      if (!sourceCompanyId || !sourceLedgerAccountId || !destCompanyId || !destLedgerAccountId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const [link] = await db.insert(intercompanyAccountLinks).values({
        label: label || null,
        sourceCompanyId,
        sourceLedgerAccountId,
        destCompanyId,
        destLedgerAccountId,
        active: true,
      }).returning();

      if (Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
        await db.insert(intercompanyLinkRecipients).values(
          recipientUserIds.map((uid: string) => ({ linkId: link.id, userId: uid }))
        );
      }

      res.json(link);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PUT /api/intercompany-links/:id ─────────────────────────────────────────
  app.put("/api/intercompany-links/:id", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      if (isNaN(linkId)) return res.status(400).json({ message: "Invalid ID" });

      const { label, sourceCompanyId, sourceLedgerAccountId, destCompanyId, destLedgerAccountId, active, recipientUserIds } = req.body;

      const [updated] = await db.update(intercompanyAccountLinks)
        .set({
          ...(label !== undefined ? { label } : {}),
          ...(sourceCompanyId !== undefined ? { sourceCompanyId } : {}),
          ...(sourceLedgerAccountId !== undefined ? { sourceLedgerAccountId } : {}),
          ...(destCompanyId !== undefined ? { destCompanyId } : {}),
          ...(destLedgerAccountId !== undefined ? { destLedgerAccountId } : {}),
          ...(active !== undefined ? { active } : {}),
        })
        .where(eq(intercompanyAccountLinks.id, linkId))
        .returning();

      if (!updated) return res.status(404).json({ message: "Link not found" });

      if (Array.isArray(recipientUserIds)) {
        await db.delete(intercompanyLinkRecipients).where(eq(intercompanyLinkRecipients.linkId, linkId));
        if (recipientUserIds.length > 0) {
          await db.insert(intercompanyLinkRecipients).values(
            recipientUserIds.map((uid: string) => ({ linkId, userId: uid }))
          );
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── DELETE /api/intercompany-links/:id ──────────────────────────────────────
  app.delete("/api/intercompany-links/:id", requireAuth, async (req, res) => {
    try {
      const linkId = parseInt(req.params.id);
      if (isNaN(linkId)) return res.status(400).json({ message: "Invalid ID" });
      await db.delete(intercompanyAccountLinks).where(eq(intercompanyAccountLinks.id, linkId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/intercompany-requests/pending-count ────────────────────────────
  // Returns number of pending requests addressed to the logged-in user
  app.get("/api/intercompany-requests/pending-count", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.json({ count: 0 });

      // Find link IDs this user is a recipient of
      const recipientLinks = await db
        .select({ linkId: intercompanyLinkRecipients.linkId })
        .from(intercompanyLinkRecipients)
        .where(eq(intercompanyLinkRecipients.userId, userId));

      if (recipientLinks.length === 0) return res.json({ count: 0 });

      const linkIds = recipientLinks.map(r => r.linkId);
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(intercompanyPaymentRequests)
        .where(
          and(
            eq(intercompanyPaymentRequests.status, "pending"),
            inArray(intercompanyPaymentRequests.linkId, linkIds),
          ),
        );

      res.json({ count: row?.count ?? 0 });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/intercompany-requests ──────────────────────────────────────────
  // Returns requests for the current user (optionally filter by status)
  app.get("/api/intercompany-requests", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.json([]);

      const statusFilter = req.query.status as string | undefined;

      const recipientLinks = await db
        .select({ linkId: intercompanyLinkRecipients.linkId })
        .from(intercompanyLinkRecipients)
        .where(eq(intercompanyLinkRecipients.userId, userId));

      if (recipientLinks.length === 0) return res.json([]);
      const linkIds = recipientLinks.map(r => r.linkId);

      const requestRows = await db
        .select()
        .from(intercompanyPaymentRequests)
        .where(
          and(
            inArray(intercompanyPaymentRequests.linkId, linkIds),
            ...(statusFilter ? [eq(intercompanyPaymentRequests.status, statusFilter)] : []),
          ),
        )
        .orderBy(desc(intercompanyPaymentRequests.createdAt));

      // Enrich with company names, link info
      const allLinks = await db.select().from(intercompanyAccountLinks);
      const allCompanies = await db.select({ id: companies.id, name: companies.name }).from(companies);
      const allAccounts = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, companyId: ledgerAccounts.companyId }).from(ledgerAccounts);
      const allUsers = await db.select({ id: users.id, username: users.username }).from(users);

      const linkMap = new Map(allLinks.map(l => [l.id, l]));
      const companyMap = new Map(allCompanies.map(c => [c.id, c.name]));
      const accountMap = new Map(allAccounts.map(a => [a.id, { name: a.name, companyId: a.companyId }]));
      const userMap = new Map(allUsers.map(u => [u.id, u.username]));

      const enriched = requestRows.map(r => {
        const link = linkMap.get(r.linkId);
        return {
          ...r,
          fromCompanyName: companyMap.get(r.fromCompanyId) ?? "Unknown",
          destCompanyName: link ? (companyMap.get(link.destCompanyId) ?? "Unknown") : "Unknown",
          destCompanyId: link?.destCompanyId,
          linkDestLedgerAccountId: link?.destLedgerAccountId,
          linkDestLedgerName: link ? (accountMap.get(link.destLedgerAccountId)?.name ?? "Unknown") : "Unknown",
          approvedByUsername: r.approvedByUserId ? (userMap.get(r.approvedByUserId) ?? r.approvedByUserId) : null,
          chosenAccountName: r.destLedgerAccountId ? (accountMap.get(r.destLedgerAccountId)?.name ?? null) : null,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/vouchers/:id/intercompany-status ───────────────────────────────
  app.get("/api/vouchers/:id/intercompany-status", requireAuth, async (req, res) => {
    try {
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) return res.json([]);

      const requests = await db
        .select()
        .from(intercompanyPaymentRequests)
        .where(eq(intercompanyPaymentRequests.fromVoucherId, voucherId));

      if (requests.length === 0) return res.json([]);

      const allLinks = await db.select().from(intercompanyAccountLinks);
      const allCompanies = await db.select({ id: companies.id, name: companies.name }).from(companies);
      const allUsers = await db.select({ id: users.id, username: users.username }).from(users);

      const linkMap = new Map(allLinks.map(l => [l.id, l]));
      const companyMap = new Map(allCompanies.map(c => [c.id, c.name]));
      const userMap = new Map(allUsers.map(u => [u.id, u.username]));

      const enriched = requests.map(r => {
        const link = linkMap.get(r.linkId);
        return {
          ...r,
          destCompanyName: link ? (companyMap.get(link.destCompanyId) ?? "Unknown") : "Unknown",
          approvedByUsername: r.approvedByUserId ? (userMap.get(r.approvedByUserId) ?? r.approvedByUserId) : null,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/intercompany-requests/:id/approve ─────────────────────────────
  app.post("/api/intercompany-requests/:id/approve", requireAuth, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      if (isNaN(requestId)) return res.status(400).json({ message: "Invalid ID" });

      const userId = req.session.userId!;
      const { destLedgerAccountId } = req.body;
      if (!destLedgerAccountId) return res.status(400).json({ message: "Please select an account" });

      const [request] = await db
        .select()
        .from(intercompanyPaymentRequests)
        .where(eq(intercompanyPaymentRequests.id, requestId));
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(400).json({ message: "Request is already " + request.status });

      // Verify this user is a recipient of the link
      const [recipient] = await db
        .select()
        .from(intercompanyLinkRecipients)
        .where(
          and(
            eq(intercompanyLinkRecipients.linkId, request.linkId),
            eq(intercompanyLinkRecipients.userId, userId),
          ),
        );
      if (!recipient) return res.status(403).json({ message: "You are not authorised to approve this request" });

      const [link] = await db
        .select()
        .from(intercompanyAccountLinks)
        .where(eq(intercompanyAccountLinks.id, request.linkId));
      if (!link) return res.status(404).json({ message: "Link not found" });

      const destCompanyId = link.destCompanyId;
      const voucherNumber = `IC-RCPT-${Date.now()}`;
      const today = new Date().toISOString().slice(0, 10);

      // Create Receipt voucher in dest company
      // DR: chosen account (cash/bank received)
      // CR: link.destLedgerAccountId (the "from company" intercompany account in dest)
      const [createdVoucher] = await db.insert(vouchers).values({
        companyId: destCompanyId,
        voucherNumber,
        voucherType: "Receipt",
        voucherDate: request.fromVoucherDate,
        description: `Intercompany receipt from ${request.fromCompanyId} - ${request.fromVoucherNumber}`,
        totalAmount: request.amount,
        optional: false,
        sourceModule: "ERP",
      }).returning();

      await db.insert(voucherEntries).values([
        {
          voucherId: createdVoucher.id,
          ledgerAccountId: destLedgerAccountId,
          debitAmount: request.amount,
          creditAmount: "0",
          narration: `Intercompany receipt - ${request.fromVoucherNumber}`,
        },
        {
          voucherId: createdVoucher.id,
          ledgerAccountId: link.destLedgerAccountId,
          debitAmount: "0",
          creditAmount: request.amount,
          narration: `Intercompany - ${request.fromVoucherNumber}`,
        },
      ]);

      // Mark request as approved
      await db.update(intercompanyPaymentRequests)
        .set({
          status: "approved",
          destLedgerAccountId,
          destVoucherId: createdVoucher.id,
          approvedByUserId: userId,
          approvedAt: new Date(),
        })
        .where(eq(intercompanyPaymentRequests.id, requestId));

      res.json({ success: true, voucherId: createdVoucher.id, voucherNumber });
    } catch (err: any) {
      console.error("[IC approve]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/intercompany-requests/:id/dismiss ─────────────────────────────
  app.post("/api/intercompany-requests/:id/dismiss", requireAuth, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      if (isNaN(requestId)) return res.status(400).json({ message: "Invalid ID" });

      const userId = req.session.userId!;
      const { note } = req.body;

      const [request] = await db
        .select()
        .from(intercompanyPaymentRequests)
        .where(eq(intercompanyPaymentRequests.id, requestId));
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(400).json({ message: "Request is already " + request.status });

      const [recipient] = await db
        .select()
        .from(intercompanyLinkRecipients)
        .where(
          and(
            eq(intercompanyLinkRecipients.linkId, request.linkId),
            eq(intercompanyLinkRecipients.userId, userId),
          ),
        );
      if (!recipient) return res.status(403).json({ message: "You are not authorised to dismiss this request" });

      await db.update(intercompanyPaymentRequests)
        .set({
          status: "dismissed",
          approvedByUserId: userId,
          approvedAt: new Date(),
          dismissNote: note || null,
        })
        .where(eq(intercompanyPaymentRequests.id, requestId));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
