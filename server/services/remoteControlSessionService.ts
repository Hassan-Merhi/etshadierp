import { randomUUID } from "crypto";
import { isRemoteSupportEnabled } from "./remoteSupportRuntime";

export type RemoteControlSessionStatus = "active" | "stopped" | "expired";

export interface RemoteControlTabPresence {
  userId: string;
  username: string;
  tabId: string;
  companyId: number;
  route: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface RemoteControlSession {
  id: string;
  companyId: number;
  targetUserId: string;
  targetUsername: string;
  targetTabId: string;
  targetRoute: string;
  controllerUserId: string;
  controllerUsername: string;
  controllerRole: string;
  scope: "erp-browser-tab";
  status: RemoteControlSessionStatus;
  startedAt: number;
  expiresAt: number;
  lastControllerHeartbeatAt: number;
  lastTargetHeartbeatAt: number;
  stoppedAt: number | null;
  stopReason: string | null;
  capabilities: {
    mouse: boolean;
    keyboard: boolean;
    browserTabOnly: true;
  };
}

export class RemoteControlSessionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "RemoteControlSessionError";
  }
}

interface StartRemoteControlSessionInput {
  targetUserId: string;
  targetUsername?: string;
  requestedTabId?: string;
  controllerUserId: string;
  controllerUsername: string;
  controllerRole: string;
  controllerCompanyId: number;
  durationMs?: number;
}

type TargetListener = () => void;
type SessionStopListener = (session: RemoteControlSession) => void;

const DEFAULT_SESSION_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 15 * 60 * 1000;
const MIN_SESSION_MS = 60 * 1000;
const TAB_PRESENCE_TTL_MS = 30 * 1000;
const CONTROLLER_HEARTBEAT_TTL_MS = 20 * 1000;
const TARGET_HEARTBEAT_TTL_MS = 30 * 1000;
const COMPLETED_SESSION_RETENTION_MS = 60 * 60 * 1000;

const sessions = new Map<string, RemoteControlSession>();
const activeByTargetUser = new Map<string, string>();
const tabsByUser = new Map<string, Map<string, RemoteControlTabPresence>>();
const targetListeners = new Map<string, Set<TargetListener>>();
const sessionStopListeners = new Set<SessionStopListener>();

function cleanIdentifier(value: unknown, maxLength = 128): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanRoute(value: unknown): string {
  const route = cleanIdentifier(value, 500);
  return route.startsWith("/") ? route : "/";
}

function positiveCompanyId(value: unknown): number | null {
  const companyId = Number(value);
  return Number.isInteger(companyId) && companyId > 0 ? companyId : null;
}

function copySession(session: RemoteControlSession | null | undefined): RemoteControlSession | null {
  if (!session) return null;
  return {
    ...session,
    capabilities: { ...session.capabilities },
  };
}

function notifyTarget(userId: string): void {
  for (const listener of targetListeners.get(userId) ?? []) {
    try {
      listener();
    } catch {
      // A disconnected event-stream listener must not affect session state.
    }
  }
}

function activeSessionRecord(targetUserId: string): RemoteControlSession | null {
  const sessionId = activeByTargetUser.get(targetUserId);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || session.status !== "active") {
    activeByTargetUser.delete(targetUserId);
    return null;
  }
  return session;
}

function stopSessionInternal(
  session: RemoteControlSession,
  reason: string,
  status: Exclude<RemoteControlSessionStatus, "active">,
  now: number
): RemoteControlSession {
  if (session.status !== "active") return session;
  session.status = status;
  session.capabilities.mouse = false;
  session.capabilities.keyboard = false;
  session.stoppedAt = now;
  session.stopReason = cleanIdentifier(reason, 160) || "stopped";
  if (activeByTargetUser.get(session.targetUserId) === session.id) {
    activeByTargetUser.delete(session.targetUserId);
  }
  notifyTarget(session.targetUserId);
  const stoppedSnapshot = copySession(session) as RemoteControlSession;
  for (const listener of sessionStopListeners) {
    try {
      listener(stoppedSnapshot);
    } catch {
      // Stop observers must never prevent a fail-safe stop.
    }
  }
  return session;
}

function freshTabs(userId: string, now = Date.now()): RemoteControlTabPresence[] {
  const userTabs = tabsByUser.get(userId);
  if (!userTabs) return [];

  for (const [tabId, tab] of userTabs) {
    if (now - tab.lastSeenAt > TAB_PRESENCE_TTL_MS) userTabs.delete(tabId);
  }
  if (userTabs.size === 0) tabsByUser.delete(userId);

  return [...userTabs.values()]
    .filter((tab) => now - tab.lastSeenAt <= TAB_PRESENCE_TTL_MS)
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .map((tab) => ({ ...tab }));
}

export function isRemoteControlControllerRole(role: unknown): boolean {
  const allowedRoles = new Set(
    (process.env.REMOTE_SUPPORT_CONTROLLER_ROLES ?? "Developer,Admin,Owner,Manager")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return typeof role === "string" && allowedRoles.has(role);
}

export function listRemoteControlTabs(userId: string, now = Date.now()): RemoteControlTabPresence[] {
  return freshTabs(cleanIdentifier(userId), now);
}

export function listActiveRemoteControlSessionsForController(controllerUserId: string): RemoteControlSession[] {
  cleanupRemoteControlState();
  const normalizedControllerId = cleanIdentifier(controllerUserId);
  return [...sessions.values()]
    .filter((session) => session.status === "active" && session.controllerUserId === normalizedControllerId)
    .sort((left, right) => right.startedAt - left.startedAt)
    .map((session) => copySession(session) as RemoteControlSession);
}

export function registerRemoteControlTab(input: {
  userId: string;
  username?: string;
  tabId: string;
  companyId: unknown;
  route?: string;
  now?: number;
}): RemoteControlSession | null {
  const userId = cleanIdentifier(input.userId);
  const tabId = cleanIdentifier(input.tabId);
  const companyId = positiveCompanyId(input.companyId);
  if (!userId || !tabId || !companyId) {
    throw new RemoteControlSessionError("INVALID_TAB", 400, "A valid company ERP browser tab is required.");
  }

  const now = input.now ?? Date.now();
  const route = cleanRoute(input.route);
  let userTabs = tabsByUser.get(userId);
  if (!userTabs) {
    userTabs = new Map();
    tabsByUser.set(userId, userTabs);
  }

  const existing = userTabs.get(tabId);
  userTabs.set(tabId, {
    userId,
    username: cleanIdentifier(input.username, 160) || existing?.username || userId,
    tabId,
    companyId,
    route,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
  });

  const session = activeSessionRecord(userId);
  if (session?.targetTabId === tabId) {
    if (session.companyId !== companyId) {
      stopSessionInternal(session, "target-company-changed", "stopped", now);
      return null;
    }
    session.targetRoute = route;
    session.lastTargetHeartbeatAt = now;
    return copySession(session);
  }
  return null;
}

export function startRemoteControlSession(input: StartRemoteControlSessionInput): RemoteControlSession {
  cleanupRemoteControlState();

  if (!isRemoteSupportEnabled("remoteControl")) {
    throw new RemoteControlSessionError("REMOTE_CONTROL_DISABLED", 409, "Remote control is disabled.");
  }
  if (!isRemoteControlControllerRole(input.controllerRole)) {
    throw new RemoteControlSessionError("CONTROLLER_NOT_AUTHORIZED", 403, "This role cannot start support control.");
  }

  const targetUserId = cleanIdentifier(input.targetUserId);
  const controllerUserId = cleanIdentifier(input.controllerUserId);
  const controllerCompanyId = positiveCompanyId(input.controllerCompanyId);
  if (!targetUserId || !controllerUserId || !controllerCompanyId) {
    throw new RemoteControlSessionError("INVALID_SESSION_PARTICIPANT", 400, "Valid users and company are required.");
  }

  const existing = activeSessionRecord(targetUserId);
  if (existing) {
    if (existing.controllerUserId === controllerUserId && existing.companyId === controllerCompanyId) {
      return copySession(existing) as RemoteControlSession;
    }
    throw new RemoteControlSessionError(
      "TARGET_ALREADY_CONTROLLED",
      409,
      "Another authorized controller already has an active session for this user."
    );
  }

  const tabs = freshTabs(targetUserId).filter((tab) => tab.companyId === controllerCompanyId);
  const requestedTabId = cleanIdentifier(input.requestedTabId);
  const selectedTab = requestedTabId ? tabs.find((tab) => tab.tabId === requestedTabId) : tabs[0];
  if (!selectedTab) {
    throw new RemoteControlSessionError(
      "TARGET_TAB_UNAVAILABLE",
      409,
      "No active ERP browser tab is available for this user in the selected company."
    );
  }

  const now = Date.now();
  const durationMs = Math.min(MAX_SESSION_MS, Math.max(MIN_SESSION_MS, input.durationMs ?? DEFAULT_SESSION_MS));
  const session: RemoteControlSession = {
    id: randomUUID(),
    companyId: controllerCompanyId,
    targetUserId,
    targetUsername: cleanIdentifier(input.targetUsername, 160) || selectedTab.username || targetUserId,
    targetTabId: selectedTab.tabId,
    targetRoute: selectedTab.route,
    controllerUserId,
    controllerUsername: cleanIdentifier(input.controllerUsername, 160) || controllerUserId,
    controllerRole: cleanIdentifier(input.controllerRole, 80),
    scope: "erp-browser-tab",
    status: "active",
    startedAt: now,
    expiresAt: now + durationMs,
    lastControllerHeartbeatAt: now,
    lastTargetHeartbeatAt: selectedTab.lastSeenAt,
    stoppedAt: null,
    stopReason: null,
    capabilities: {
      mouse: false,
      keyboard: false,
      browserTabOnly: true,
    },
  };

  sessions.set(session.id, session);
  activeByTargetUser.set(targetUserId, session.id);
  notifyTarget(targetUserId);
  return copySession(session) as RemoteControlSession;
}

export function setRemoteControlMouseCapability(sessionId: string, enabled: boolean): RemoteControlSession | null {
  cleanupRemoteControlState();
  const session = sessions.get(cleanIdentifier(sessionId));
  if (!session || session.status !== "active") return null;
  const nextKeyboard = enabled ? session.capabilities.keyboard : false;
  if (session.capabilities.mouse === enabled && session.capabilities.keyboard === nextKeyboard) {
    return copySession(session);
  }
  session.capabilities.mouse = enabled;
  if (!enabled) session.capabilities.keyboard = false;
  notifyTarget(session.targetUserId);
  return copySession(session);
}

export function setRemoteControlKeyboardCapability(sessionId: string, enabled: boolean): RemoteControlSession | null {
  cleanupRemoteControlState();
  const session = sessions.get(cleanIdentifier(sessionId));
  if (!session || session.status !== "active") return null;
  if (enabled && (!session.capabilities.mouse || !isRemoteSupportEnabled("keyboardControl"))) return null;
  if (session.capabilities.keyboard === enabled) return copySession(session);
  session.capabilities.keyboard = enabled;
  notifyTarget(session.targetUserId);
  return copySession(session);
}

export function heartbeatRemoteControlController(
  sessionId: string,
  controllerUserId: string,
  now = Date.now()
): RemoteControlSession | null {
  cleanupRemoteControlState(now);
  const session = sessions.get(cleanIdentifier(sessionId));
  if (!session || session.status !== "active") return null;
  if (session.controllerUserId !== cleanIdentifier(controllerUserId)) return null;
  session.lastControllerHeartbeatAt = now;
  return copySession(session);
}

export function getRemoteControlSession(sessionId: string): RemoteControlSession | null {
  cleanupRemoteControlState();
  return copySession(sessions.get(cleanIdentifier(sessionId)));
}

export function getActiveRemoteControlSession(targetUserId: string, targetTabId?: string): RemoteControlSession | null {
  cleanupRemoteControlState();
  const session = activeSessionRecord(cleanIdentifier(targetUserId));
  if (!session) return null;
  const tabId = cleanIdentifier(targetTabId);
  if (tabId && session.targetTabId !== tabId) return null;
  return copySession(session);
}

export function stopRemoteControlSession(
  sessionId: string,
  reason: string,
  now = Date.now()
): RemoteControlSession | null {
  const session = sessions.get(cleanIdentifier(sessionId));
  if (!session) return null;
  return copySession(stopSessionInternal(session, reason, "stopped", now));
}

export function stopAllRemoteControlSessions(reason: string, now = Date.now()): number {
  let stopped = 0;
  for (const session of sessions.values()) {
    if (session.status !== "active") continue;
    stopSessionInternal(session, reason, "stopped", now);
    stopped += 1;
  }
  return stopped;
}

export function subscribeRemoteControlTarget(userId: string, listener: TargetListener): () => void {
  const targetUserId = cleanIdentifier(userId);
  let listeners = targetListeners.get(targetUserId);
  if (!listeners) {
    listeners = new Set();
    targetListeners.set(targetUserId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) targetListeners.delete(targetUserId);
  };
}

export function subscribeRemoteControlSessionStops(listener: SessionStopListener): () => void {
  sessionStopListeners.add(listener);
  return () => sessionStopListeners.delete(listener);
}

export function cleanupRemoteControlState(now = Date.now()): void {
  for (const session of sessions.values()) {
    if (session.status === "active") {
      if (!isRemoteSupportEnabled("remoteControl")) {
        stopSessionInternal(session, "runtime-disabled", "stopped", now);
      } else if (!isRemoteSupportEnabled("keyboardControl") && session.capabilities.keyboard) {
        session.capabilities.keyboard = false;
        notifyTarget(session.targetUserId);
      } else if (now >= session.expiresAt) {
        stopSessionInternal(session, "session-expired", "expired", now);
      } else if (now - session.lastControllerHeartbeatAt > CONTROLLER_HEARTBEAT_TTL_MS) {
        stopSessionInternal(session, "controller-disconnected", "stopped", now);
      } else if (now - session.lastTargetHeartbeatAt > TARGET_HEARTBEAT_TTL_MS) {
        stopSessionInternal(session, "target-tab-disconnected", "stopped", now);
      }
    } else if (session.stoppedAt && now - session.stoppedAt > COMPLETED_SESSION_RETENTION_MS) {
      sessions.delete(session.id);
    }
  }

  for (const userId of tabsByUser.keys()) freshTabs(userId, now);
}

export function resetRemoteControlSessionStateForTests(): void {
  sessions.clear();
  activeByTargetUser.clear();
  tabsByUser.clear();
  targetListeners.clear();
  sessionStopListeners.clear();
}

const cleanupTimer = setInterval(() => cleanupRemoteControlState(), 3000);
(cleanupTimer as unknown as { unref?: () => void }).unref?.();
