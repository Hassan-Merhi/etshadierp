/**
 * Shared state and helpers for the factoryDocsUsersRoutes routes.
 *
 * Extracted verbatim from the former single-file factoryDocsUsersRoutes.ts.
 */
import { db } from "../../../db";
import { containerFreight, containers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";

// ── Ownership helpers ──────────────────────────────────────────────────────────

/** Returns true only if the container exists AND belongs to companyId. */
export async function verifyContainerOwnership(containerId: number, companyId: number): Promise<boolean> {
  const rows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.companyId, companyId)));
  return rows.length > 0;
}

/** Returns the containerId for a freight row — or null if not found / wrong company. */
export async function getFreightContainerId(freightId: number, companyId: number): Promise<number | null> {
  const rows = await db
    .select({ containerId: containerFreight.containerId })
    .from(containerFreight)
    .where(and(eq(containerFreight.id, freightId), eq(containerFreight.companyId, companyId)));
  return rows.length > 0 ? rows[0].containerId : null;
}

// Safe file-serving: normalise the path and reject traversal attempts.
export function safeSendFile(res: any, folder: string, filename: string) {
  const safeFolder = path.basename(folder);
  const safeFile = path.basename(filename);
  if (!safeFolder || !safeFile || safeFolder !== folder || safeFile !== filename) {
    return res.status(400).json({ message: "Invalid file path" });
  }
  const filePath = path.join(process.cwd(), "uploads", safeFolder, safeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
  res.sendFile(filePath);
}
