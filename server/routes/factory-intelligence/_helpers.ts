/**
 * Shared state and helpers for the factoryIntelligenceRoutes routes.
 *
 * Extracted verbatim from the former single-file factoryIntelligenceRoutes.ts.
 */
import multer from "multer";
import path from "path";
import fs from "fs";

export const balePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), "uploads", "bale-photos");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `bale-${Date.now()}${ext}`);
  },
});
export const balePhotoUpload = multer({ storage: balePhotoStorage });
