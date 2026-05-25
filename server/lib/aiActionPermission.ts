import { Request } from "express";
import { db } from "../db";
import { users, aiActionLog } from "@shared/schema";
import { eq } from "drizzle-orm";

export type AIActionType = "read" | "draft" | "write";

interface Denial {
  code: number;
  message: string;
}

// Roles that may run draft/write AI actions (all non-POS roles).
// Note: write actions ALSO go through the underlying ERP route's own checks,
// so this is a minimum gate, not the full permission check.
const CREATE_ROLES = new Set(["Developer", "Admin", "Owner", "Manager", "Normal User"]);

/**
 * Verify the current user is allowed to run the given AI action tier.
 *
 * - read:  any chatbot-enabled user, any role.
 * - draft: chatbot-enabled + non-POS role.
 * - write: chatbot-enabled + non-POS role.
 *          The underlying ERP route additionally enforces its own role/permission
 *          checks — AI write routes must never bypass those.
 *
 * Returns null when allowed, or { code, message } when denied.
 * Always call this at the top of the route handler, before any work is done.
 */
export async function requireAIActionPermission(
  req: Request,
  actionType: AIActionType,
): Promise<Denial | null> {
  const userId = req.session.userId;
  const role = req.session.currentRole ?? "";

  if (!userId) return { code: 401, message: "Unauthorized" };

  // One DB query — chatbotEnabled is not cached in session yet.
  const [user] = await db
    .select({ chatbotEnabled: users.chatbotEnabled })
    .from(users)
    .where(eq(users.id, userId));

  if (!user?.chatbotEnabled) {
    return {
      code: 403,
      message: "AI assistant is not enabled for your account",
    };
  }

  // read — any chatbot-enabled user
  if (actionType === "read") return null;

  // draft / write — non-POS roles only
  if (!CREATE_ROLES.has(role)) {
    const tier = actionType === "draft" ? "draft" : "write";
    return {
      code: 403,
      message: `Your role (${role || "unknown"}) does not have permission to use AI ${tier} actions`,
    };
  }

  return null;
}

/**
 * Append a row to ai_action_log.
 *
 * Fields:
 *   actionType  — permission tier: 'read' | 'draft' | 'write'
 *   actionName  — specific action: 'chat_message' | 'stock_transfer' | 'po_import' | etc.
 *   inputJson   — sanitised snapshot of the request payload (avoid secrets / large blobs)
 *   outputJson  — sanitised snapshot of the response or created-record references
 *   status      — 'success' | 'denied' | 'error'
 *
 * Never throws — logging failures must never break the primary request.
 */
export async function logAIAction(params: {
  req: Request;
  actionType: AIActionType;
  actionName: string;
  inputJson?: unknown;
  outputJson?: unknown;
  status: "success" | "denied" | "error";
  createdRecordId?: number | null;
}): Promise<void> {
  try {
    const userId = params.req.session.userId;
    const companyId = params.req.session.currentCompanyId;
    if (!userId || !companyId) return;

    await db.insert(aiActionLog).values({
      userId,
      companyId,
      actionType: params.actionType,
      actionName: params.actionName,
      inputJson:  params.inputJson  ?? null,
      outputJson: params.outputJson ?? null,
      status:     params.status,
      createdRecordId: params.createdRecordId ?? null,
    } as any);
  } catch (err) {
    console.error("[AIActionLog] write failed:", (err as Error).message);
  }
}
