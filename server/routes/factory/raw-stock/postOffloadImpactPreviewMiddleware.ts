import type { NextFunction, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import {
  InvalidPostOffloadImpactPreviewError,
  StalePostOffloadImpactPreviewError,
  verifyPostOffloadImpactPreview,
  type PostOffloadImpactPreviewSummary,
} from "../../../services/factory/postOffloadImpactPreview";

const CREATE_PATH = /\/api\/factory\/containers\/(\d+)\/post-offload-charges\/?(?:\?.*)?$/;

export interface PostOffloadImpactPreviewRequest extends Request {
  postOffloadImpactPreview?: PostOffloadImpactPreviewSummary;
}

/**
 * Phase 4 refreshed-client contract.
 *
 * Legacy callers that do not send impactPreviewVersion remain compatible. A
 * refreshed client opts into strict verification by sending version 1 and the
 * signed token returned by the read-only preview endpoint.
 */
export async function requirePostOffloadImpactPreview(
  req: PostOffloadImpactPreviewRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const pathMatch = CREATE_PATH.exec(req.originalUrl);
  if (req.method !== "POST" || !pathMatch || req.originalUrl.includes("/preview")) {
    next();
    return;
  }

  if (Number(req.body?.impactPreviewVersion) !== 1) {
    next();
    return;
  }

  const companyId = Number(req.session?.factoryCompanyId || req.session?.currentCompanyId || 0);
  const userId = String(req.session?.userId || req.user?.id || "");
  const containerId = Number.parseInt(pathMatch[1], 10);
  const token = req.body?.impactPreviewToken;

  if (!companyId || !userId || !Number.isInteger(containerId) || containerId <= 0) {
    res.status(400).json({
      message: "Post-offload impact preview context is incomplete.",
      code: "POST_OFFLOAD_IMPACT_PREVIEW_CONTEXT_MISSING",
    });
    return;
  }
  if (!token) {
    res.status(400).json({
      message: "Review the post-offload impact before saving this charge.",
      code: "POST_OFFLOAD_IMPACT_PREVIEW_REQUIRED",
    });
    return;
  }

  try {
    req.postOffloadImpactPreview = await verifyPostOffloadImpactPreview({
      token,
      companyId,
      userId,
      containerId,
      transactionDate: req.body?.txDate,
      charges: req.body?.charges,
    });
    next();
  } catch (error: unknown) {
    logger.warn("Post-offload impact preview verification rejected a mutation", {
      error,
      companyId,
      containerId,
      userId,
    });

    const status =
      error instanceof StalePostOffloadImpactPreviewError
        ? 409
        : error instanceof InvalidPostOffloadImpactPreviewError
          ? 400
          : (error as { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      message: getErrorMessage(error),
      code:
        (error as { code?: string }).code ||
        (status === 409 ? "POST_OFFLOAD_IMPACT_PREVIEW_STALE" : "POST_OFFLOAD_IMPACT_PREVIEW_INVALID"),
    });
  }
}
