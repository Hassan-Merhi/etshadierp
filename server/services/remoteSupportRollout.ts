import { getRemoteSupportRuntimeSnapshot } from "./remoteSupportRuntime";

export type RemoteSupportRolloutStage = "disabled" | "internal" | "canary" | "general";

export interface RemoteSupportRolloutState {
  stage: RemoteSupportRolloutStage;
  canaryCompanyIds: number[];
  internalControllerUserIds: string[];
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export interface RemoteSupportRolloutReadiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export interface RemoteSupportRolloutSnapshot extends RemoteSupportRolloutState {
  readiness: RemoteSupportRolloutReadiness;
}

export interface RemoteSupportRolloutEligibilityInput {
  companyId: unknown;
  controllerUserId: unknown;
  controllerRole: unknown;
}

export interface RemoteSupportRolloutEligibility {
  allowed: boolean;
  code: string | null;
  message: string | null;
  stage: RemoteSupportRolloutStage;
}

export class RemoteSupportRolloutError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "RemoteSupportRolloutError";
  }
}

type MutableRolloutState = Pick<RemoteSupportRolloutState, "stage" | "canaryCompanyIds" | "internalControllerUserIds">;

const STAGES = new Set<RemoteSupportRolloutStage>(["disabled", "internal", "canary", "general"]);
const SAFE_BOOT_STATE: MutableRolloutState = {
  stage: "disabled",
  canaryCompanyIds: [],
  internalControllerUserIds: [],
};

function parsePositiveIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort(
    (left, right) => left - right
  );
}

function parseUserIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function normalizeStage(value: unknown): RemoteSupportRolloutStage {
  const stage = typeof value === "string" ? value.trim().toLowerCase() : "disabled";
  return STAGES.has(stage as RemoteSupportRolloutStage) ? (stage as RemoteSupportRolloutStage) : "disabled";
}

let state: MutableRolloutState = { ...SAFE_BOOT_STATE };
let revision = 1;
let updatedAt = new Date();
let updatedBy = "system";

function readiness(): RemoteSupportRolloutReadiness {
  const runtime = getRemoteSupportRuntimeSnapshot();
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (runtime.hardDisabled) blockers.push("screen-feed-hard-disabled");
  if (!runtime.flags.screenFeedEnabled) blockers.push("screen-feed-disabled");
  if (!runtime.flags.remoteControl) blockers.push("remote-control-runtime-disabled");
  if (!runtime.flags.sensitiveActionProtection) blockers.push("sensitive-action-protection-disabled");
  if (state.stage === "disabled") blockers.push("rollout-disabled");
  if (state.stage === "canary" && state.canaryCompanyIds.length === 0) {
    blockers.push("canary-company-list-empty");
  }
  if (!runtime.flags.keyboardControl) warnings.push("keyboard-control-runtime-disabled");
  if (state.stage === "internal" && state.internalControllerUserIds.length === 0) {
    warnings.push("internal-rollout-developer-only");
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

export function getRemoteSupportRolloutSnapshot(): RemoteSupportRolloutSnapshot {
  return {
    stage: state.stage,
    canaryCompanyIds: [...state.canaryCompanyIds],
    internalControllerUserIds: [...state.internalControllerUserIds],
    revision,
    updatedAt: updatedAt.toISOString(),
    updatedBy,
    readiness: readiness(),
  };
}

export function updateRemoteSupportRollout(
  patch: Partial<Pick<RemoteSupportRolloutState, "stage" | "canaryCompanyIds" | "internalControllerUserIds">>,
  actor: string
): RemoteSupportRolloutSnapshot {
  state = {
    stage: patch.stage === undefined ? state.stage : normalizeStage(patch.stage),
    canaryCompanyIds:
      patch.canaryCompanyIds === undefined ? state.canaryCompanyIds : parsePositiveIds(patch.canaryCompanyIds),
    internalControllerUserIds:
      patch.internalControllerUserIds === undefined
        ? state.internalControllerUserIds
        : parseUserIds(patch.internalControllerUserIds),
  };
  revision += 1;
  updatedAt = new Date();
  updatedBy = actor.trim() || "unknown";
  return getRemoteSupportRolloutSnapshot();
}

export function rollbackRemoteSupportRollout(actor: string): RemoteSupportRolloutSnapshot {
  state = { ...state, stage: "disabled" };
  revision += 1;
  updatedAt = new Date();
  updatedBy = actor.trim() || "unknown";
  return getRemoteSupportRolloutSnapshot();
}

export function evaluateRemoteSupportRollout(
  input: RemoteSupportRolloutEligibilityInput
): RemoteSupportRolloutEligibility {
  const runtime = getRemoteSupportRuntimeSnapshot();
  const companyId = Number(input.companyId);
  const controllerUserId = String(input.controllerUserId ?? "").trim();
  const controllerRole = String(input.controllerRole ?? "").trim();

  if (
    runtime.hardDisabled ||
    !runtime.flags.screenFeedEnabled ||
    !runtime.flags.remoteControl ||
    !runtime.flags.sensitiveActionProtection
  ) {
    return {
      allowed: false,
      code: "REMOTE_SUPPORT_NOT_READY",
      message: "Remote support control is not ready for use.",
      stage: state.stage,
    };
  }
  if (!Number.isInteger(companyId) || companyId <= 0 || !controllerUserId) {
    return {
      allowed: false,
      code: "REMOTE_SUPPORT_ROLLOUT_CONTEXT_INVALID",
      message: "A valid company and controller are required.",
      stage: state.stage,
    };
  }
  if (state.stage === "disabled") {
    return {
      allowed: false,
      code: "REMOTE_SUPPORT_ROLLOUT_DISABLED",
      message: "Remote support control has not been enabled for rollout.",
      stage: state.stage,
    };
  }
  if (
    state.stage === "internal" &&
    controllerRole !== "Developer" &&
    !state.internalControllerUserIds.includes(controllerUserId)
  ) {
    return {
      allowed: false,
      code: "REMOTE_SUPPORT_INTERNAL_ONLY",
      message: "Remote support control is limited to the internal rollout cohort.",
      stage: state.stage,
    };
  }
  if (state.stage === "canary" && !state.canaryCompanyIds.includes(companyId)) {
    return {
      allowed: false,
      code: "REMOTE_SUPPORT_CANARY_COMPANY_REQUIRED",
      message: "Remote support control is not enabled for this company.",
      stage: state.stage,
    };
  }
  return { allowed: true, code: null, message: null, stage: state.stage };
}

export function assertRemoteSupportRolloutEligible(input: RemoteSupportRolloutEligibilityInput): void {
  const result = evaluateRemoteSupportRollout(input);
  if (!result.allowed) {
    throw new RemoteSupportRolloutError(
      result.code ?? "REMOTE_SUPPORT_ROLLOUT_BLOCKED",
      409,
      result.message ?? "Remote support control is blocked by rollout policy."
    );
  }
}

export function resetRemoteSupportRolloutForTests(): void {
  state = { ...SAFE_BOOT_STATE };
  revision = 1;
  updatedAt = new Date(0);
  updatedBy = "test";
}
