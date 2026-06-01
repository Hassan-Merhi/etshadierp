/**
 * labelBannersRoutes.ts
 * Manages the 5 HMD label banner images (purple/green/gold/white/red).
 *
 * Strategy:
 *  - Default images live in client/public/labels/ (served by Vite in dev,
 *    by Express static in prod).
 *  - Custom replacements are stored in uploads/label-banners/ — a persistent
 *    directory that survives builds/deployments.
 *  - GET /labels/hmd-:slot.jpg is registered as an Express route BEFORE the
 *    Vite/static middleware, so it intercepts the URL and serves the custom
 *    file when one exists, or calls next() to fall through to the default.
 *  - labelHtml.ts needs zero changes — it still references /labels/hmd-*.jpg.
 */

import path from "path";
import fs from "fs";
import multer from "multer";

const SLOTS = ["purple", "green", "gold", "white", "red"] as const;
type Slot = (typeof SLOTS)[number];

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "label-banners");

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function customPath(slot: Slot): string {
  return path.join(UPLOAD_DIR, `hmd-${slot}.jpg`);
}

function defaultPath(slot: Slot): string {
  // Works in both dev (client/public) and prod (server/public built output)
  const candidates = [
    path.join(process.cwd(), "client", "public", "labels", `hmd-${slot}.jpg`),
    path.join(process.cwd(), "dist", "public", "labels", `hmd-${slot}.jpg`),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "public", "labels", `hmd-${slot}.jpg`),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Store temporarily; we rename to the fixed filename after validation
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
  // ── Override /labels/hmd-:slot.jpg to serve custom image when present ──────
  // Must be registered BEFORE Vite/static middleware so it intercepts the URL.
  app.get("/labels/hmd-:slot.jpg", (req: any, res: any, next: any) => {
    const slot = req.params.slot as string;
    if (!(SLOTS as readonly string[]).includes(slot)) return next();
    const custom = customPath(slot as Slot);
    if (fs.existsSync(custom)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "image/jpeg");
      return res.sendFile(custom);
    }
    next(); // fall through to Vite / Express static
  });

  // ── GET /api/factory/label-banners — list all slots + custom status ─────────
  app.get("/api/factory/label-banners", requireAuth, (_req: any, res: any) => {
    ensureDir();
    const slots = SLOTS.map((slot) => {
      const custom = customPath(slot);
      const hasCustom = fs.existsSync(custom);
      const lastModified = hasCustom ? fs.statSync(custom).mtimeMs : null;
      return { slot, hasCustom, lastModified };
    });
    res.json(slots);
  });

  // ── POST /api/factory/label-banners/:slot — upload new image ───────────────
  app.post("/api/factory/label-banners/:slot", requireAuth, (req: any, res: any) => {
    const slot = req.params.slot as string;
    if (!(SLOTS as readonly string[]).includes(slot)) {
      return res.status(400).json({ message: `Invalid slot. Must be one of: ${SLOTS.join(", ")}` });
    }

    upload.single("image")(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message });
      if (!req.file) return res.status(400).json({ message: "No image uploaded" });

      const tmpPath = req.file.path;
      const dest = customPath(slot as Slot);

      try {
        // Atomic rename to the fixed destination
        fs.renameSync(tmpPath, dest);
        const lastModified = fs.statSync(dest).mtimeMs;
        console.log(`[LabelBanners] Slot "${slot}" updated (${req.file.size} bytes)`);
        res.json({ slot, hasCustom: true, lastModified });
      } catch (e: any) {
        // Clean up temp file if rename fails
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        res.status(500).json({ message: e.message });
      }
    });
  });

  // ── DELETE /api/factory/label-banners/:slot — revert to default ────────────
  app.delete("/api/factory/label-banners/:slot", requireAuth, (req: any, res: any) => {
    const slot = req.params.slot as string;
    if (!(SLOTS as readonly string[]).includes(slot)) {
      return res.status(400).json({ message: "Invalid slot" });
    }
    const custom = customPath(slot as Slot);
    if (fs.existsSync(custom)) {
      fs.unlinkSync(custom);
      console.log(`[LabelBanners] Slot "${slot}" reverted to default`);
    }
    res.json({ slot, hasCustom: false, lastModified: null });
  });
}
