/**
 * labelBannersRoutes.ts
 * Manages label banner color slots — both the color metadata (DB) and the
 * custom banner images (filesystem).
 *
 * Strategy:
 *  - Color metadata lives in label_design_colors table (shared across users).
 *  - Banner images are PER-USER: each user can upload their own custom banner.
 *    Files live at uploads/label-banners/{userId}/hmd-{slug}.jpg.
 *  - GET /labels/user-:userId/hmd-:slug.jpg serves a user's custom image,
 *    falling through to Vite/static defaults if none exists.
 *  - The legacy /labels/hmd-:slug.jpg route is kept for backward compat
 *    (no custom file lookup — always falls through to static default).
 */

import path from "path";
import fs from "fs";
import multer from "multer";
import { db } from "../../db";
import { labelDesignColors } from "../../../shared/schema";
import { eq, asc } from "drizzle-orm";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "label-banners");

function userDir(userId: string): string {
  return path.join(UPLOAD_DIR, userId);
}

function ensureUserDir(userId: string): void {
  const dir = userDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureBaseDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function customPath(userId: string, slug: string): string {
  return path.join(userDir(userId), `hmd-${slug}.jpg`);
}

function fileInfo(userId: string, slug: string): { hasCustom: boolean; lastModified: number | null } {
  const p = customPath(userId, slug);
  const hasCustom = fs.existsSync(p);
  return { hasCustom, lastModified: hasCustom ? fs.statSync(p).mtimeMs : null };
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureBaseDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `tmp-label-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG or WEBP images are allowed"));
  },
});

export function registerLabelBannersRoutes(app: any, requireAuth: any) {
  // ── Serve per-user custom banner, fall back to static default ───────────────
  const STATIC_LABELS_DIR = path.join(process.cwd(), "client", "public", "labels");
  app.get("/labels/user-:userId/hmd-:slug.jpg", (req: any, res: any, next: any) => {
    const { userId, slug } = req.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(userId) || !/^[a-z0-9-]+$/.test(slug)) return next();
    const custom = customPath(userId, slug);
    if (fs.existsSync(custom)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "image/jpeg");
      return res.sendFile(custom);
    }
    // Fall back to the shared static default
    const defaultFile = path.join(STATIC_LABELS_DIR, `hmd-${slug}.jpg`);
    if (fs.existsSync(defaultFile)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Content-Type", "image/jpeg");
      return res.sendFile(defaultFile);
    }
    next();
  });

  // ── Legacy route — falls through to Vite static (no per-user lookup) ────────
  app.get("/labels/hmd-:slug.jpg", (_req: any, _res: any, next: any) => next());

  // ── GET /api/factory/label-design-colors — full list with per-user image status
  app.get("/api/factory/label-design-colors", requireAuth, async (req: any, res: any) => {
    try {
      const userId = String(req.session.userId ?? "");
      const colors = await db.select().from(labelDesignColors).orderBy(asc(labelDesignColors.sortOrder), asc(labelDesignColors.createdAt));
      res.json(colors.map(c => ({ ...c, ...fileInfo(userId, c.slug) })));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/factory/label-banners — legacy compat (same data) ─────────────
  app.get("/api/factory/label-banners", requireAuth, async (req: any, res: any) => {
    try {
      const userId = String(req.session.userId ?? "");
      const colors = await db.select().from(labelDesignColors).orderBy(asc(labelDesignColors.sortOrder), asc(labelDesignColors.createdAt));
      res.json(colors.map(c => ({ slot: c.slug, ...fileInfo(userId, c.slug) })));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/factory/label-design-colors — create new color (+ image) ─────
  app.post("/api/factory/label-design-colors", requireAuth, (req: any, res: any) => {
    upload.single("image")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: err.message });

      const userId = String(req.session.userId ?? "");
      const cleanTmp = () => {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
      };

      const { label, colorHex, slug: slugOverride } = req.body;
      if (!label || !colorHex) {
        cleanTmp();
        return res.status(400).json({ message: "label and colorHex are required" });
      }

      const slug = slugOverride ? String(slugOverride).toLowerCase().trim() : slugify(String(label));
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        cleanTmp();
        return res.status(400).json({ message: "Invalid slug — use lowercase letters, digits and hyphens only" });
      }

      try {
        const existing = await db.select({ id: labelDesignColors.id }).from(labelDesignColors).where(eq(labelDesignColors.slug, slug));
        if (existing.length > 0) {
          cleanTmp();
          return res.status(409).json({ message: `A color with slug "${slug}" already exists` });
        }

        const all = await db.select({ sortOrder: labelDesignColors.sortOrder }).from(labelDesignColors).orderBy(asc(labelDesignColors.sortOrder));
        const nextOrder = all.length > 0 ? (all[all.length - 1].sortOrder ?? 0) + 1 : 0;

        const [row] = await db.insert(labelDesignColors).values({
          slug,
          label: String(label),
          colorHex: String(colorHex),
          sortOrder: nextOrder,
          isDefault: false,
        }).returning();

        if (req.file && userId) {
          try {
            ensureUserDir(userId);
            fs.renameSync(req.file.path, customPath(userId, slug));
          } catch (imgErr: any) {
            console.warn(`[LabelColors] Image save failed for "${slug}":`, imgErr.message);
          }
        } else {
          cleanTmp();
        }

        res.json({ ...row, ...fileInfo(userId, slug) });
      } catch (e: any) {
        cleanTmp();
        res.status(500).json({ message: e.message });
      }
    });
  });

  // ── PATCH /api/factory/label-design-colors/:slug — update label and/or hex ─
  app.patch("/api/factory/label-design-colors/:slug", requireAuth, async (req: any, res: any) => {
    const { slug } = req.params;
    const userId = String(req.session.userId ?? "");
    const { label, colorHex } = req.body;
    if (!label && !colorHex) return res.status(400).json({ message: "Nothing to update" });

    try {
      const updates: Record<string, string> = {};
      if (label) updates.label = String(label);
      if (colorHex) updates.colorHex = String(colorHex);

      const [updated] = await db.update(labelDesignColors).set(updates).where(eq(labelDesignColors.slug, slug)).returning();
      if (!updated) return res.status(404).json({ message: "Color not found" });
      res.json({ ...updated, ...fileInfo(userId, slug) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE /api/factory/label-design-colors/:slug — remove custom color ────
  app.delete("/api/factory/label-design-colors/:slug", requireAuth, async (req: any, res: any) => {
    const { slug } = req.params;
    const userId = String(req.session.userId ?? "");
    try {
      const [row] = await db.select().from(labelDesignColors).where(eq(labelDesignColors.slug, slug));
      if (!row) return res.status(404).json({ message: "Color not found" });
      if (row.isDefault) return res.status(400).json({ message: "Built-in colors cannot be deleted" });

      await db.delete(labelDesignColors).where(eq(labelDesignColors.slug, slug));
      // Delete this user's custom image for the slug
      const imgPath = customPath(userId, slug);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/factory/label-banners/:slug — upload/replace banner image ────
  app.post("/api/factory/label-banners/:slug", requireAuth, async (req: any, res: any) => {
    const { slug } = req.params;
    const userId = String(req.session.userId ?? "");
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ message: "Invalid slug" });
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const rows = await db.select({ id: labelDesignColors.id }).from(labelDesignColors).where(eq(labelDesignColors.slug, slug));
    if (rows.length === 0) return res.status(404).json({ message: "Color not found" });

    upload.single("image")(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message });
      if (!req.file) return res.status(400).json({ message: "No image uploaded" });

      try {
        ensureUserDir(userId);
        fs.renameSync(req.file.path, customPath(userId, slug));
        const info = fileInfo(userId, slug);
        console.log(`[LabelBanners] user=${userId} "${slug}" updated (${req.file.size} bytes)`);
        res.json({ slot: slug, ...info });
      } catch (e: any) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        res.status(500).json({ message: e.message });
      }
    });
  });

  // ── DELETE /api/factory/label-banners/:slug — revert to default image ──────
  app.delete("/api/factory/label-banners/:slug", requireAuth, (req: any, res: any) => {
    const { slug } = req.params;
    const userId = String(req.session.userId ?? "");
    const p = customPath(userId, slug);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`[LabelBanners] user=${userId} "${slug}" reverted to default`);
    }
    res.json({ slot: slug, hasCustom: false, lastModified: null });
  });
}
