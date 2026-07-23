import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { factoryContacts } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";

function getCompanyId(req: Request): number | null {
  const s = (req as any).session;
  return s?.factoryCompanyId || s?.currentCompanyId || null;
}

const contactBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.string().optional().nullable(),
  numbers: z
    .array(z.object({ label: z.string(), number: z.string() }))
    .default([]),
  notes: z.string().optional().nullable(),
});

export function registerFactoryContactRoutes(app: Express) {
  // LIST
  app.get("/api/factory/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select()
        .from(factoryContacts)
        .where(eq(factoryContacts.companyId, companyId))
        .orderBy(asc(factoryContacts.name));

      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // CREATE
  app.post("/api/factory/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = contactBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const [row] = await db
        .insert(factoryContacts)
        .values({ companyId, ...parsed.data })
        .returning();

      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // UPDATE
  app.patch("/api/factory/contacts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const parsed = contactBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const [row] = await db
        .update(factoryContacts)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(factoryContacts.id, id), eq(factoryContacts.companyId, companyId)))
        .returning();

      if (!row) return res.status(404).json({ message: "Contact not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE
  app.delete("/api/factory/contacts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      await db
        .delete(factoryContacts)
        .where(and(eq(factoryContacts.id, id), eq(factoryContacts.companyId, companyId)));

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
