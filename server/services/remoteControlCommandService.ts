import { randomUUID } from "crypto";
import { isRemoteSupportEnabled } from "./remoteSupportRuntime";
import { evaluateRemoteSupportRollout } from "./remoteSupportRollout";
import {
  getRemoteControlSession,
  setRemoteControlMouseCapability,
  type RemoteControlSession,
} from "./remoteControlSessionService";

export type RemoteMouseCommandType = "pointer-move" | "click" | "scroll";
export type RemoteMouseCommandResultStatus = "executed" | "blocked" | "ignored";

export interface RemoteMouseCommand {
  id: string;
  sessionId: string;
  targetUserId: string;
  targetTabId: string;
  type: RemoteMouseCommandType;
  sequence: number;
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
  createdAt: number;
}

export interface RemoteMouseCommandResult {
  commandId: string;
  sessionId: string;
  status: RemoteMouseCommandResultStatus;
  reason: string | null;
  completedAt: number;
}

export interface RemoteMouseAuthorization {
  sessionId: string;
  controllerUserId: string;
  authorizedAt: number;
  expiresAt: number;
}

export class RemoteMouseControlError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "RemoteMouseControlError";
  }
}

type CommandListener = (command: RemoteMouseCommand) => void;
type ResultListener = (result: RemoteMouseCommandResult) => void;

interface RateWindow {
  startedAt: number;
  counts: Record<RemoteMouseCommandType, number>;
}

const PASSWORD_CONFIRMATION_MAX_AGE_MS = 5 * 60 * 1000;
const COMMAND_RETENTION_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 1000;
const RATE_LIMITS: Record<RemoteMouseCommandType, number> = {
  "pointer-move": 20,
  click: 4,
  scroll: 12,
};

const commandListeners = new Map<string, Set<CommandListener>>();
const resultListeners = new Map<string, Set<ResultListener>>();
const authorizations = new Map<string, RemoteMouseAuthorization>();
const commandHistory = new Map<string, RemoteMouseCommand>();
const sequenceBySession = new Map<string, number>();
const rateWindows = new Map<string, RateWindow>();

function cleanIdentifier(value: unknown, maxLength = 160): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanReason(value: unknown): string | null {
  const reason = cleanIdentifier(value, 160);
  return reason || null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedCoordinate(value: unknown): number | null {
  const coordinate = finiteNumber(value);
  if (coordinate === null || coordinate < 0 || coordinate > 1) return null;
  return coordinate;
}

function boundedDelta(value: unknown): number | null {
  const delta = finiteNumber(value);
  if (delta === null) return null;
  return Math.max(-1200, Math.min(1200, delta));
}

function activeSessionForController(
  sessionId: string,
  controllerUserId: string,
  requireMouseCapability = true
): RemoteControlSession {
  const session = getRemoteControlSession(cleanIdentifier(sessionId));
  if (!session || session.status !== "active") {
    throw new RemoteMouseControlError("SESSION_INACTIVE", 409, "The support session is no longer active.");
  }
  if (session.controllerUserId !== cleanIdentifier(controllerUserId)) {
    throw new RemoteMouseControlError("CONTROLLER_MISMATCH", 403, "This controller does not own the session.");
  }
  if (!isRemoteSupportEnabled("remoteControl")) {
    throw new RemoteMouseControlError("MOUSE_CONTROL_DISABLED", 409, "Mouse control is disabled.");
  }
  const rollout = evaluateRemoteSupportRollout({
    companyId: session.companyId,
    controllerUserId: session.controllerUserId,
    controllerRole: session.controllerRole,
  });
  if (!rollout.allowed) {
    throw new RemoteMouseControlError(
      rollout.code ?? "REMOTE_SUPPORT_ROLLOUT_BLOCKED",
      409,
      rollout.message ?? "Remote support control is blocked by rollout policy."
    );
  }
  if (requireMouseCapability && !session.capabilities.mouse) {
    throw new RemoteMouseControlError("MOUSE_CONTROL_DISABLED", 409, "Mouse control is disabled.");
  }
  return session;
}

function activeSessionForTarget(
  sessionId: string,
  targetUserId: string,
  targetTabId: string,
  requireMouseCapability = true
): RemoteControlSession {
  const session = getRemoteControlSession(cleanIdentifier(sessionId));
  if (!session || session.status !== "active") {
    throw new RemoteMouseControlError("SESSION_INACTIVE", 409, "The support session is no longer active.");
  }
  if (session.targetUserId !== cleanIdentifier(targetUserId) || session.targetTabId !== cleanIdentifier(targetTabId)) {
    throw new RemoteMouseControlError("TARGET_MISMATCH", 403, "This command channel is not bound to this ERP tab.");
  }
  if (!isRemoteSupportEnabled("remoteControl") || (requireMouseCapability && !session.capabilities.mouse)) {
    throw new RemoteMouseControlError("MOUSE_CONTROL_DISABLED", 409, "Mouse control is disabled.");
  }
  return session;
}

function notify<T>(listeners: Set<(value: T) => void> | undefined, value: T): number {
  let delivered = 0;
  for (const listener of listeners ?? []) {
    try {
      listener(value);
      delivered += 1;
    } catch {
      // A broken event stream must not affect other listeners or session state.
    }
  }
  return delivered;
}

function clearSessionMouseState(sessionId: string, disableCapability: boolean): void {
  authorizations.delete(sessionId);
  rateWindows.delete(sessionId);
  sequenceBySession.delete(sessionId);
  commandListeners.delete(sessionId);
  resultListeners.delete(sessionId);
  for (const [commandId, command] of commandHistory) {
    if (command.sessionId === sessionId) commandHistory.delete(commandId);
  }
  if (disableCapability) setRemoteControlMouseCapability(sessionId, false);
}

function assertRateLimit(sessionId: string, type: RemoteMouseCommandType, now: number): void {
  let window = rateWindows.get(sessionId);
  if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
    window = {
      startedAt: now,
      counts: { "pointer-move": 0, click: 0, scroll: 0 },
    };
    rateWindows.set(sessionId, window);
  }

  window.counts[type] += 1;
  if (window.counts[type] > RATE_LIMITS[type]) {
    throw new RemoteMouseControlError("COMMAND_RATE_LIMITED", 429, "Mouse commands are being sent too quickly.");
  }
}

function assertMouseAuthorization(sessionId: string, controllerUserId: string, now: number): RemoteMouseAuthorization {
  const authorization = authorizations.get(sessionId);
  if (
    !authorization ||
    authorization.controllerUserId !== cleanIdentifier(controllerUserId) ||
    now >= authorization.expiresAt
  ) {
    clearSessionMouseState(sessionId, true);
    throw new RemoteMouseControlError(
      "MOUSE_AUTHORIZATION_REQUIRED",
      428,
      "Confirm your password before enabling mouse control."
    );
  }
  return { ...authorization };
}

export function authorizeRemoteMouseControl(input: {
  sessionId: string;
  controllerUserId: string;
  passwordConfirmedAt: number | null | undefined;
  now?: number;
}): RemoteMouseAuthorization {
  const now = input.now ?? Date.now();
  const session = activeSessionForController(input.sessionId, input.controllerUserId, false);
  const confirmedAt = input.passwordConfirmedAt;
  if (
    confirmedAt == null ||
    !Number.isFinite(confirmedAt) ||
    confirmedAt > now ||
    now - confirmedAt > PASSWORD_CONFIRMATION_MAX_AGE_MS
  ) {
    throw new RemoteMouseControlError(
      "PASSWORD_CONFIRMATION_REQUIRED",
      428,
      "Confirm your password before enabling mouse control."
    );
  }

  const authorization: RemoteMouseAuthorization = {
    sessionId: session.id,
    controllerUserId: session.controllerUserId,
    authorizedAt: now,
    expiresAt: Math.min(session.expiresAt, confirmedAt + PASSWORD_CONFIRMATION_MAX_AGE_MS),
  };
  authorizations.set(session.id, authorization);
  if (!setRemoteControlMouseCapability(session.id, true)) {
    clearSessionMouseState(session.id, false);
    throw new RemoteMouseControlError("SESSION_INACTIVE", 409, "The support session is no longer active.");
  }
  return { ...authorization };
}

export function revokeRemoteMouseControl(input: { sessionId: string; controllerUserId: string }): void {
  const session = activeSessionForController(input.sessionId, input.controllerUserId, false);
  clearSessionMouseState(session.id, true);
}

export function getRemoteMouseAuthorization(
  sessionId: string,
  controllerUserId: string,
  now = Date.now()
): RemoteMouseAuthorization | null {
  try {
    activeSessionForController(sessionId, controllerUserId, false);
    return assertMouseAuthorization(cleanIdentifier(sessionId), controllerUserId, now);
  } catch {
    return null;
  }
}

export function publishRemoteMouseCommand(input: {
  sessionId: string;
  controllerUserId: string;
  type: unknown;
  x: unknown;
  y: unknown;
  deltaX?: unknown;
  deltaY?: unknown;
  now?: number;
}): RemoteMouseCommand {
  const now = input.now ?? Date.now();
  const session = activeSessionForController(input.sessionId, input.controllerUserId);
  assertMouseAuthorization(session.id, input.controllerUserId, now);

  const type = input.type;
  if (type !== "pointer-move" && type !== "click" && type !== "scroll") {
    throw new RemoteMouseControlError("INVALID_COMMAND", 400, "Unsupported mouse command.");
  }

  const x = normalizedCoordinate(input.x);
  const y = normalizedCoordinate(input.y);
  if (x === null || y === null) {
    throw new RemoteMouseControlError("INVALID_COORDINATES", 400, "Mouse coordinates must be normalized.");
  }

  const deltaX = type === "scroll" ? boundedDelta(input.deltaX ?? 0) : undefined;
  const deltaY = type === "scroll" ? boundedDelta(input.deltaY ?? 0) : undefined;
  if (type === "scroll" && (deltaX === null || deltaY === null || (deltaX === 0 && deltaY === 0))) {
    throw new RemoteMouseControlError("INVALID_SCROLL", 400, "A bounded scroll delta is required.");
  }

  assertRateLimit(session.id, type, now);
  const nextSequence = (sequenceBySession.get(session.id) ?? 0) + 1;
  sequenceBySession.set(session.id, nextSequence);

  const command: RemoteMouseCommand = {
    id: randomUUID(),
    sessionId: session.id,
    targetUserId: session.targetUserId,
    targetTabId: session.targetTabId,
    type,
    sequence: nextSequence,
    x,
    y,
    ...(type === "scroll" ? { deltaX: deltaX as number, deltaY: deltaY as number } : {}),
    createdAt: now,
  };

  commandHistory.set(command.id, command);
  const delivered = notify(commandListeners.get(session.id), command);
  if (delivered === 0) {
    commandHistory.delete(command.id);
    throw new RemoteMouseControlError(
      "TARGET_COMMAND_CHANNEL_UNAVAILABLE",
      409,
      "The employee ERP tab is not ready to receive mouse commands."
    );
  }
  return { ...command };
}

export function subscribeRemoteMouseCommands(input: {
  sessionId: string;
  targetUserId: string;
  targetTabId: string;
  listener: CommandListener;
}): () => void {
  const session = activeSessionForTarget(input.sessionId, input.targetUserId, input.targetTabId);
  let listeners = commandListeners.get(session.id);
  if (!listeners) {
    listeners = new Set();
    commandListeners.set(session.id, listeners);
  }
  listeners.add(input.listener);
  return () => {
    listeners?.delete(input.listener);
    if (listeners?.size === 0) commandListeners.delete(session.id);
  };
}

export function publishRemoteMouseCommandResult(input: {
  sessionId: string;
  commandId: string;
  targetUserId: string;
  targetTabId: string;
  status: unknown;
  reason?: unknown;
  now?: number;
}): RemoteMouseCommandResult {
  const now = input.now ?? Date.now();
  const session = activeSessionForTarget(input.sessionId, input.targetUserId, input.targetTabId, false);
  const commandId = cleanIdentifier(input.commandId);
  const command = commandHistory.get(commandId);
  if (!command || command.sessionId !== session.id) {
    throw new RemoteMouseControlError("COMMAND_NOT_FOUND", 404, "Mouse command not found.");
  }
  if (input.status !== "executed" && input.status !== "blocked" && input.status !== "ignored") {
    throw new RemoteMouseControlError("INVALID_RESULT", 400, "Unsupported mouse command result.");
  }

  const result: RemoteMouseCommandResult = {
    commandId,
    sessionId: session.id,
    status: input.status,
    reason: cleanReason(input.reason),
    completedAt: now,
  };
  commandHistory.delete(commandId);
  notify(resultListeners.get(session.id), result);
  return { ...result };
}

export function subscribeRemoteMouseResults(input: {
  sessionId: string;
  controllerUserId: string;
  listener: ResultListener;
}): () => void {
  const session = activeSessionForController(input.sessionId, input.controllerUserId);
  let listeners = resultListeners.get(session.id);
  if (!listeners) {
    listeners = new Set();
    resultListeners.set(session.id, listeners);
  }
  listeners.add(input.listener);
  return () => {
    listeners?.delete(input.listener);
    if (listeners?.size === 0) resultListeners.delete(session.id);
  };
}

export function cleanupRemoteMouseCommandState(now = Date.now()): void {
  const sessionIds = new Set([
    ...authorizations.keys(),
    ...commandListeners.keys(),
    ...resultListeners.keys(),
    ...sequenceBySession.keys(),
    ...rateWindows.keys(),
  ]);
  for (const sessionId of sessionIds) {
    const session = getRemoteControlSession(sessionId);
    const authorization = authorizations.get(sessionId);
    if (!session || session.status !== "active" || !authorization || now >= authorization.expiresAt) {
      clearSessionMouseState(sessionId, !!session && session.status === "active");
    }
  }

  for (const [commandId, command] of commandHistory) {
    if (now - command.createdAt > COMMAND_RETENTION_MS) commandHistory.delete(commandId);
  }
}

export function resetRemoteMouseCommandStateForTests(): void {
  commandListeners.clear();
  resultListeners.clear();
  authorizations.clear();
  commandHistory.clear();
  sequenceBySession.clear();
  rateWindows.clear();
}

const cleanupTimer = setInterval(() => cleanupRemoteMouseCommandState(), 3000);
(cleanupTimer as unknown as { unref?: () => void }).unref?.();
