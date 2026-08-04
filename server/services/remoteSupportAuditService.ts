import { auditLog } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { subscribeRemoteControlSessionStops, type RemoteControlSession } from "./remoteControlSessionService";

export type RemoteSupportAuditEvent =
  | "session_started"
  | "session_stopped"
  | "mouse_authorized"
  | "mouse_revoked"
  | "keyboard_authorized"
  | "keyboard_revoked"
  | "mouse_command"
  | "mouse_result"
  | "keyboard_command"
  | "keyboard_result"
  | "command_blocked"
  | "permission_denied";

export interface RemoteSupportAuditDetails {
  capability?: "view" | "mouse" | "keyboard" | "audit";
  commandType?: string;
  key?: string;
  textLength?: number;
  sequence?: number;
  status?: "executed" | "blocked" | "ignored" | "requested" | "denied";
  reason?: string | null;
  route?: string;
  stopReason?: string | null;
}

const ALLOWED_DETAIL_KEYS = new Set<keyof RemoteSupportAuditDetails>([
  "capability",
  "commandType",
  "key",
  "textLength",
  "sequence",
  "status",
  "reason",
  "route",
  "stopReason",
]);
const auditedStoppedSessionIds = new Set<string>();
let stopAuditInstalled = false;

function boundedText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function safeDetails(details: RemoteSupportAuditDetails): Record<string, { new: unknown }> {
  const safe: Record<string, { new: unknown }> = {};
  for (const [rawKey, rawValue] of Object.entries(details)) {
    const key = rawKey as keyof RemoteSupportAuditDetails;
    if (!ALLOWED_DETAIL_KEYS.has(key) || rawValue === undefined) continue;
    if (key === "textLength" || key === "sequence") {
      const numberValue = Number(rawValue);
      if (Number.isFinite(numberValue) && numberValue >= 0) {
        safe[key] = { new: Math.floor(numberValue) };
      }
      continue;
    }
    if (key === "route") {
      safe[key] = { new: boundedText(rawValue, 300) ?? "/" };
      continue;
    }
    if (key === "reason" || key === "stopReason") {
      safe[key] = { new: boundedText(rawValue, 120) };
      continue;
    }
    const textValue = boundedText(rawValue, 80);
    if (textValue) safe[key] = { new: textValue };
  }
  return safe;
}

export function buildRemoteSupportAuditChanges(input: {
  event: RemoteSupportAuditEvent;
  session: RemoteControlSession;
  details?: RemoteSupportAuditDetails;
}): Record<string, { new: unknown }> {
  return {
    event: { new: input.event },
    controllerUserId: { new: input.session.controllerUserId },
    controllerUsername: { new: input.session.controllerUsername },
    controllerRole: { new: input.session.controllerRole },
    targetUserId: { new: input.session.targetUserId },
    targetUsername: { new: input.session.targetUsername },
    scope: { new: input.session.scope },
    targetRoute: { new: input.session.targetRoute },
    mouseEnabled: { new: input.session.capabilities.mouse },
    keyboardEnabled: { new: input.session.capabilities.keyboard },
    ...safeDetails(input.details ?? {}),
  };
}

export async function writeRemoteSupportAudit(input: {
  event: RemoteSupportAuditEvent;
  session: RemoteControlSession;
  actorUserId?: string;
  actorUsername?: string;
  details?: RemoteSupportAuditDetails;
}): Promise<void> {
  if (input.event === "session_stopped" && auditedStoppedSessionIds.has(input.session.id)) return;

  const actorUserId = boundedText(input.actorUserId, 128) ?? input.session.controllerUserId;
  const actorUsername = boundedText(input.actorUsername, 160) ?? input.session.controllerUsername;
  try {
    await db.insert(auditLog).values({
      userId: actorUserId,
      username: actorUsername,
      companyId: input.session.companyId,
      action: `remote_support_${input.event}`,
      tableName: "remote_support_sessions",
      recordId: null,
      recordIdentifier: input.session.id,
      changes: buildRemoteSupportAuditChanges(input),
    });
    if (input.event === "session_stopped") auditedStoppedSessionIds.add(input.session.id);
  } catch (error) {
    logger.error("[RemoteSupport] permanent audit write failed", {
      error,
      event: input.event,
      sessionId: input.session.id,
      companyId: input.session.companyId,
    });
    throw error;
  }
}

export function installRemoteSupportSessionStopAudit(): void {
  if (stopAuditInstalled) return;
  stopAuditInstalled = true;
  subscribeRemoteControlSessionStops((session) => {
    void writeRemoteSupportAudit({
      event: "session_stopped",
      session,
      actorUserId: session.controllerUserId,
      actorUsername: session.controllerUsername,
      details: {
        capability: "view",
        stopReason: session.stopReason,
        route: session.targetRoute,
      },
    }).catch(() => undefined);
  });
}

export function remoteSupportCommandAuditDetails(input: {
  capability: "mouse" | "keyboard";
  commandType: string;
  sequence?: number;
  key?: string;
  text?: string;
  route?: string;
}): RemoteSupportAuditDetails {
  return {
    capability: input.capability,
    commandType: boundedText(input.commandType, 80) ?? "unknown",
    sequence: input.sequence,
    key: boundedText(input.key, 40) ?? undefined,
    textLength: typeof input.text === "string" ? Array.from(input.text).length : undefined,
    route: input.route,
    status: "requested",
  };
}

export function resetRemoteSupportAuditStateForTests(): void {
  auditedStoppedSessionIds.clear();
  stopAuditInstalled = false;
}
