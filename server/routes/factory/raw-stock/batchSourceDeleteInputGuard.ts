import type { NextFunction, Request, Response } from "express";
import { parseId } from "../../../lib/parseId";

export function requireValidBatchSourceDeleteInput(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "DELETE") return next();

  const batchId = parseId((req.body as any)?.batchId);
  const supplierId = parseId((req.body as any)?.supplierId);

  if (batchId === null || supplierId === null) {
    return res.status(400).json({ message: "batchId and supplierId are required" });
  }

  return next();
}
