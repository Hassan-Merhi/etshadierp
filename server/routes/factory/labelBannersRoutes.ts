/**
 * labelBannersRoutes.ts
 * Manages label banner color slots — both the color metadata (DB) and the
 * custom banner images (stored in the database as base64 data URLs).
 *
 * Strategy:
 *  - Color metadata AND custom images live in label_design_colors table.
 *  - Default images in client/public/labels/hmd-{slug}.jpg are served by
 *    Vite/static. Custom replacements are stored in the image_data column.
 *  - GET /labels/hmd-:slug.jpg queries the DB; if imageData is set it
 *    decodes and streams the bytes; otherwise calls next() to fall through
 *    to Vite static serving.
 *  - labelHtml.ts never needs changing — it derives the URL from the slug.
 */

import multer from "multer";
import { db } from "../../db";
import { labelDesignColors } from "../../../shared/schema";
import { eq, asc } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG or WEBP images are allowed"));
  },
});

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function rowInfo(row: { imageData: string | null; imageUpdatedAt: Date | null }): { hasCustom: boolean; lastModified: number | null } {
  return {
    hasCustom: !!row.imageData,
    lastModified: row.imageUpdatedAt ? row.imageUpdatedAt.getTime() : null,
  };
}

export function registerLabelBannersRoutes(app: any, requireAuth: any) {
  // ── Serve custom banner image from DB when present, else fall through ────────
  app.get("/labels/hmd-:slug.jpg", async (req: any, res: any, next: any) => {
    const { slug } = req.params;
    if (!/^[a-z0-9-]+$/.test(slug)) return next();
    try {
      const [row] = await db
        .select({ imageData: labelDesignColors.imageData })
        .from(labelDesignColors)
        .where(eq(labelDesignColors.slug, slug));
      if (row?.imageData) {
        // imageData is stored as a data URL: "data:<mime>;base64,<data>"
        const match = row.imageData.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          const mimeType = match[1];
          const buffer = Buffer.from(match[2], "base64");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Content-Type", mimeType);
          return res.send(buffer);
        }
      }
    } catch {
      /* fall through to static on DB error */
    }
    next();
  });

  // ── GET /api/factory/label-design-colors — full list with image status ──────
  app.get("/api/factory/label-design-colors", requireAuth, async (_req: any, res: any) => {
    try {
      const colors = await db.select().from(labelDesignColors).orderBy(asc(labelDesignColors.sortOrder), asc(labelDesignColors.createdAt));
      res.json(colors.map(c => ({ ...c, imageData: undefined, ...rowInfo(c) })));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/factory/label-banners — legacy compat (same data) ─────────────
  app.get("/api/factory/label-banners", requireAuth, async (_req: any, res: any) => {
    try {
      const colors = await db.select().from(labelDesignColors).orderBy(asc(labelDesignColors.sortOrder), asc(labelDesignColors.createdAt));
      res.json(colors.map(c => ({ slot: c.slug, ...rowInfo(c) })));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/factory/label-design-colors — create new color (+ image) ─────
  app.post("/api/factory/label-design-colors", requireAuth, (req: any, res: any) => {
    upload.single("image")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: err.message });

      const { label, colorHex, slug: slugOverride } = req.body;
      if (!label || !colorHex) {
        return res.status(400).json({ message: "label and colorHex are required" });
      }

      const slug = slugOverride ? String(slugOverride).toLowerCase().trim() : slugify(String(label));
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        return res.status(400).json({ message: "Invalid slug — use lowercase letters, digits and hyphens only" });
      }

      try {
        const existing = await db.select({ id: labelDesignColors.id }).from(labelDesignColors).where(eq(labelDesignColors.slug, slug));
        if (existing.length > 0) {
          return res.status(409).json({ message: `A color with slug "${slug}" already exists` });
        }

        const all = await db.select({ sortOrder: labelDesignColors.sortOrder }).from(labelDesignColors).orderBy(asc(labelDesignColors.sortOrder));
        const nextOrder = all.length > 0 ? (all[all.length - 1].sortOrder ?? 0) + 1 : 0;

        let imageData: string | undefined;
        let imageUpdatedAt: Date | undefined;
        if (req.file) {
          imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
          imageUpdatedAt = new Date();
        }

        const [row] = await db.insert(labelDesignColors).values({
          slug,
          label: String(label),
          colorHex: String(colorHex),
          sortOrder: nextOrder,
          isDefault: false,
          ...(imageData ? { imageData, imageUpdatedAt } : {}),
        }).returning();

        res.json({ ...row, imageData: undefined, ...rowInfo(row) });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    });
  });

  // ── PATCH /api/factory/label-design-colors/:slug — update label and/or hex ─
  app.patch("/api/factory/label-design-colors/:slug", requireAuth, async (req: any, res: any) => {
    const { slug } = req.params;
    const { label, colorHex } = req.body;
    if (!label && !colorHex) return res.status(400).json({ message: "Nothing to update" });

    try {
      const updates: Record<string, string> = {};
      if (label) updates.label = String(label);
      if (colorHex) updates.colorHex = String(colorHex);

      const [updated] = await db.update(labelDesignColors).set(updates).where(eq(labelDesignColors.slug, slug)).returning();
      if (!updated) return res.status(404).json({ message: "Color not found" });
      res.json({ ...updated, imageData: undefined, ...rowInfo(updated) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE /api/factory/label-design-colors/:slug — remove custom color ────
  app.delete("/api/factory/label-design-colors/:slug", requireAuth, async (req: any, res: any) => {
    const { slug } = req.params;
    try {
      const [row] = await db.select().from(labelDesignColors).where(eq(labelDesignColors.slug, slug));
      if (!row) return res.status(404).json({ message: "Color not found" });
      if (row.isDefault) return res.status(400).json({ message: "Built-in colors cannot be deleted" });

      await db.delete(labelDesignColors).where(eq(labelDesignColors.slug, slug));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/factory/label-banners/:slug — upload/replace banner image ────
  app.post("/api/factory/label-banners/:slug", requireAuth, (req: any, res: any) => {
    const { slug } = req.params;
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ message: "Invalid slug" });

    upload.single("image")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: err.message });
      if (!req.file) return res.status(400).json({ message: "No image uploaded" });

      try {
        const rows = await db.select({ id: labelDesignColors.id }).from(labelDesignColors).where(eq(labelDesignColors.slug, slug));
        if (rows.length === 0) return res.status(404).json({ message: "Color not found" });

        const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        const imageUpdatedAt = new Date();

        await db.update(labelDesignColors)
          .set({ imageData, imageUpdatedAt })
          .where(eq(labelDesignColors.slug, slug));

        console.log(`[LabelBanners] "${slug}" updated in DB (${req.file.size} bytes)`);
        res.json({ slot: slug, hasCustom: true, lastModified: imageUpdatedAt.getTime() });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    });
  });

  // ── DELETE /api/factory/label-banners/:slug — revert to default image ──────
  app.delete("/api/factory/label-banners/:slug", requireAuth, async (req: any, res: any) => {
    const { slug } = req.params;
    try {
      await db.update(labelDesignColors)
        .set({ imageData: null, imageUpdatedAt: null })
        .where(eq(labelDesignColors.slug, slug));
      console.log(`[LabelBanners] "${slug}" reverted to default`);
      res.json({ slot: slug, hasCustom: false, lastModified: null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
