export type RemoteSupportFlagName =
  | "screenFeedEnabled"
  | "fastScreenFeed"
  | "remoteControl"
  | "keyboardControl"
  | "sensitiveActionProtection";

export interface RemoteSupportFlags {
  screenFeedEnabled: boolean;
  fastScreenFeed: boolean;
  remoteControl: boolean;
  keyboardControl: boolean;
  sensitiveActionProtection: boolean;
}

export interface RemoteSupportMetricsSnapshot {
  watcherStatusPolls: number;
  viewerPolls: number;
  liveStatusConnections: number;
  liveViewerConnections: number;
  framesAccepted: number;
  framesRejected: number;
  framesPushed: number;
  totalFrameBytes: number;
  averageFrameBytes: number;
  lastFrameBytes: number | null;
  lastFrameAcceptedAt: string | null;
  lastViewerPollAt: string | null;
  startedAt: string;
}

export interface RemoteSupportRuntimeSnapshot {
  flags: RemoteSupportFlags;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  hardDisabled: boolean;
  metrics: RemoteSupportMetricsSnapshot;
}

type RemoteSupportMetric =
  | "watcherStatusPoll"
  | "viewerPoll"
  | "liveStatusConnected"
  | "liveViewerConnected"
  | "frameAccepted"
  | "frameRejected"
  | "framePushed";

const HARD_DISABLED = process.env.DISABLE_SCREEN_FEED === "true";
const startedAt = new Date();

const bootFlags: RemoteSupportFlags = {
  screenFeedEnabled: !HARD_DISABLED,
  fastScreenFeed: !HARD_DISABLED,
  remoteControl: false,
  keyboardControl: false,
  sensitiveActionProtection: true,
};

let flags: RemoteSupportFlags = { ...bootFlags };
let revision = 1;
let updatedAt = startedAt;
let updatedBy = "system";

const metrics = {
  watcherStatusPolls: 0,
  viewerPolls: 0,
  liveStatusConnections: 0,
  liveViewerConnections: 0,
  framesAccepted: 0,
  framesRejected: 0,
  framesPushed: 0,
  totalFrameBytes: 0,
  lastFrameBytes: null as number | null,
  lastFrameAcceptedAt: null as Date | null,
  lastViewerPollAt: null as Date | null,
};

function normalizeFlags(next: RemoteSupportFlags): RemoteSupportFlags {
  const normalized = { ...next };

  if (HARD_DISABLED || !normalized.screenFeedEnabled) {
    normalized.screenFeedEnabled = false;
    normalized.fastScreenFeed = false;
    normalized.remoteControl = false;
    normalized.keyboardControl = false;
  }

  if (!normalized.remoteControl) {
    normalized.keyboardControl = false;
  }

  if (normalized.remoteControl || normalized.keyboardControl) {
    normalized.sensitiveActionProtection = true;
  }

  return normalized;
}

function metricsSnapshot(): RemoteSupportMetricsSnapshot {
  return {
    watcherStatusPolls: metrics.watcherStatusPolls,
    viewerPolls: metrics.viewerPolls,
    liveStatusConnections: metrics.liveStatusConnections,
    liveViewerConnections: metrics.liveViewerConnections,
    framesAccepted: metrics.framesAccepted,
    framesRejected: metrics.framesRejected,
    framesPushed: metrics.framesPushed,
    totalFrameBytes: metrics.totalFrameBytes,
    averageFrameBytes: metrics.framesAccepted > 0 ? Math.round(metrics.totalFrameBytes / metrics.framesAccepted) : 0,
    lastFrameBytes: metrics.lastFrameBytes,
    lastFrameAcceptedAt: metrics.lastFrameAcceptedAt?.toISOString() ?? null,
    lastViewerPollAt: metrics.lastViewerPollAt?.toISOString() ?? null,
    startedAt: startedAt.toISOString(),
  };
}

export function getRemoteSupportRuntimeSnapshot(): RemoteSupportRuntimeSnapshot {
  return {
    flags: { ...flags },
    revision,
    updatedAt: updatedAt.toISOString(),
    updatedBy,
    hardDisabled: HARD_DISABLED,
    metrics: metricsSnapshot(),
  };
}

export function isRemoteSupportEnabled(flag: RemoteSupportFlagName): boolean {
  return flags[flag];
}

export function updateRemoteSupportFlags(
  patch: Partial<RemoteSupportFlags>,
  actor: string
): RemoteSupportRuntimeSnapshot {
  const allowedKeys: RemoteSupportFlagName[] = [
    "screenFeedEnabled",
    "fastScreenFeed",
    "remoteControl",
    "keyboardControl",
    "sensitiveActionProtection",
  ];

  const safePatch = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => allowedKeys.includes(key as RemoteSupportFlagName) && typeof value === "boolean"
    )
  ) as Partial<RemoteSupportFlags>;

  flags = normalizeFlags({ ...flags, ...safePatch });
  revision += 1;
  updatedAt = new Date();
  updatedBy = actor || "unknown";
  return getRemoteSupportRuntimeSnapshot();
}

export function emergencyDisableRemoteSupport(actor: string): RemoteSupportRuntimeSnapshot {
  flags = {
    screenFeedEnabled: false,
    fastScreenFeed: false,
    remoteControl: false,
    keyboardControl: false,
    sensitiveActionProtection: true,
  };
  revision += 1;
  updatedAt = new Date();
  updatedBy = actor || "unknown";
  return getRemoteSupportRuntimeSnapshot();
}

export function restoreRemoteSupportBootDefaults(actor: string): RemoteSupportRuntimeSnapshot {
  flags = normalizeFlags({ ...bootFlags });
  revision += 1;
  updatedAt = new Date();
  updatedBy = actor || "unknown";
  return getRemoteSupportRuntimeSnapshot();
}

export function recordRemoteSupportMetric(metric: RemoteSupportMetric, value?: number): void {
  switch (metric) {
    case "watcherStatusPoll":
      metrics.watcherStatusPolls += 1;
      return;
    case "viewerPoll":
      metrics.viewerPolls += 1;
      metrics.lastViewerPollAt = new Date();
      return;
    case "liveStatusConnected":
      metrics.liveStatusConnections += 1;
      return;
    case "liveViewerConnected":
      metrics.liveViewerConnections += 1;
      return;
    case "frameRejected":
      metrics.framesRejected += 1;
      return;
    case "framePushed":
      metrics.framesPushed += Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 1;
      return;
    case "frameAccepted": {
      const safeBytes = Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 0;
      metrics.framesAccepted += 1;
      metrics.totalFrameBytes += safeBytes;
      metrics.lastFrameBytes = safeBytes;
      metrics.lastFrameAcceptedAt = new Date();
      return;
    }
  }
}

export function resetRemoteSupportMetrics(): RemoteSupportRuntimeSnapshot {
  metrics.watcherStatusPolls = 0;
  metrics.viewerPolls = 0;
  metrics.liveStatusConnections = 0;
  metrics.liveViewerConnections = 0;
  metrics.framesAccepted = 0;
  metrics.framesRejected = 0;
  metrics.framesPushed = 0;
  metrics.totalFrameBytes = 0;
  metrics.lastFrameBytes = null;
  metrics.lastFrameAcceptedAt = null;
  metrics.lastViewerPollAt = null;
  return getRemoteSupportRuntimeSnapshot();
}
