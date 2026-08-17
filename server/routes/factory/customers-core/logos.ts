/**
 * factoryCustomersRoutes: FactoryCustomerLogo endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { customers, customerLogos } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerFactoryCustomerLogoRoutes(app: Express) {
  // ── Customer Logos ──────────────────────────────────────────────────────────

  const customerLogoStorage = multer.diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      const dir = path.join(process.cwd(), "uploads", "customer-logos");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req: any, file: any, cb: any) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `cust-logo-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });

  const customerLogoUpload = multer({
    storage: customerLogoStorage,
    limits: { fileSize: 500 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) cb(null, true);
      else cb(new Error("Only PNG, JPG and WEBP images are allowed"));
    },
  });

  app.get("/api/factory/customers/:id/logos", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
      const logos = await db
        .select()
        .from(customerLogos)
        .where(
          and(
            eq(customerLogos.companyId, companyId),
            eq(customerLogos.customerId, customerId),
            eq(customerLogos.active, true)
          )
        )
        .orderBy(asc(customerLogos.createdAt));
      res.json(logos);
    } catch (e: unknown) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/factory/customers/:id/logos", requireAuth, (req: Request, res: Response) => {
    customerLogoUpload.single("image")(req, res, async (err: any) => {
      try {
        if (err) return res.status(400).json({ message: err.message });
        const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        if (!req.file) return res.status(400).json({ message: "No image uploaded" });
        const customerId = parseInt(req.params.id);
        if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
        const [cust] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
        if (!cust) return res.status(404).json({ message: "Customer not found" });
        const name = ((req.body.name || req.file.originalname.replace(/\.[^.]+$/, "")) as string).substring(0, 100);
        const [logo] = await db
          .insert(customerLogos)
          .values({
            companyId,
            customerId,
            name,
            filePath: req.file.filename,
            mimeType: req.file.mimetype,
            active: true,
          })
          .returning();
        res.status(201).json(logo);
      } catch (e: unknown) {
        res.status(500).json({ message: getErrorMessage(e) });
      }
    });
  });

  app.patch("/api/factory/customer-logos/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const logoId = parseInt(req.params.id);
      if (isNaN(logoId)) return res.status(400).json({ message: "Invalid logo ID" });
      const [existing] = await db
        .select()
        .from(customerLogos)
        .where(and(eq(customerLogos.id, logoId), eq(customerLogos.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Logo not found" });
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Name is required" });
      const [updated] = await db
        .update(customerLogos)
        .set({ name: name.trim().substring(0, 100), updatedAt: new Date() })
        .where(eq(customerLogos.id, logoId))
        .returning();
      res.json(updated);
    } catch (e: unknown) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/factory/customer-logos/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const logoId = parseInt(req.params.id);
      if (isNaN(logoId)) return res.status(400).json({ message: "Invalid logo ID" });
      const [existing] = await db
        .select()
        .from(customerLogos)
        .where(and(eq(customerLogos.id, logoId), eq(customerLogos.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Logo not found" });
      const [updated] = await db
        .update(customerLogos)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(customerLogos.id, logoId))
        .returning();
      res.json(updated);
    } catch (e: unknown) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/factory/customer-logos/:id/image", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const logoId = parseInt(req.params.id);
      if (isNaN(logoId)) return res.status(400).json({ message: "Invalid logo ID" });
      const [logo] = await db
        .select()
        .from(customerLogos)
        .where(and(eq(customerLogos.id, logoId), eq(customerLogos.companyId, companyId)));
      if (!logo) return res.status(404).json({ message: "Logo not found" });
      const filePath = path.join(process.cwd(), "uploads", "customer-logos", logo.filePath);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Image file not found" });
      res.setHeader("Content-Type", logo.mimeType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.sendFile(filePath);
    } catch (e: unknown) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // CUSTOMER PROFORMAS CRUD
  // ───────────────────────────────────────────────
}
