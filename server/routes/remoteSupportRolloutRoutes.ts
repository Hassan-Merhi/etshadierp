import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { getSessionRole, getSessionUserId, getSessionUsername } from "../lib/requestContext";
import { stopAllRemoteControlSessions } from "../services/remoteControlSessionService";
import {
  getRemoteSupportRolloutSnapshot,
  rollbackRemoteSupportRollout,
  updateRemoteSupportRollout,
  type RemoteSupportRolloutStage,
} from "../services/remoteSupportRollout";
import {
  getRemoteSupportRuntimeSnapshot,
  updateRemoteSupportFlags,
} from "../services/remoteSupportRuntime";

const PASSWORD_CONFIRMATION_MAX_AGE_MS = 5 * 60 * 1000;
const ROLLOUT_STAGES = new Set<RemoteSupportRolloutStage>([
  "disabled",
  "internal",
  "canary",
  "general",
]);

function actor(req: Request): string {
  const username = getSessionUsername(req);
  const userId = getSessionUserId(req);
  return username || (userId === null || userId === undefined ? "unknown" : String(userId));
}

function requireDeveloper(req: Request, res: Response): boolean {
  if (getSessionRole(req) !== "Developer") {
    res.status(403).json({ message: "Developer access required." });
    return false;
  }
  return true;
}

function hasRecentPasswordConfirmation(req: Request): boolean {
  const value = (req.session as { passwordConfirmedAt?: unknown }).passwordConfirmedAt;
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Date.now() - value >= 0 &&
    Date.now() - value <= PASSWORD_CONFIRMATION_MAX_AGE_MS
  );
}

function parseStage(value: unknown): RemoteSupportRolloutStage | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as RemoteSupportRolloutStage;
  return ROLLOUT_STAGES.has(normalized) ? normalized : null;
}

export function registerRemoteSupportRolloutRoutes(app: Express): void {
  app.get("/api/screen-feed/admin/rollout", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      rollout: getRemoteSupportRolloutSnapshot(),
      runtime: getRemoteSupportRuntimeSnapshot(),
    });
  });

  app.patch("/api/screen-feed/admin/rollout", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    const stage = req.body?.stage === undefined ? undefined : parseStage(req.body.stage);
    if (req.body?.stage !== undefined && !stage) {
      return res.status(400).json({ message: "Invalid remote support rollout stage." });
    }
    if (stage !== undefined && stage !== "disabled" && !hasRecentPasswordConfirmation(req)) {
      return res.status(403).json({
        code: "PASSWORD_CONFIRMATION_REQUIRED",
        message: "Confirm your password before enabling remote support rollout.",
      });
    }

    const updated = updateRemoteSupportRollout(
      {
        ...(stage === undefined ? {} : { stage }),
        ...(req.body?.canaryCompanyIds === undefined
          ? {}
          : { canaryCompanyIds: req.body.canaryCompanyIds }),
        ...(req.body?.internalControllerUserIds === undefined
          ? {}
          : { internalControllerUserIds: req.body.internalControllerUserIds }),
      },
      actor(req)
    );
    const stoppedSessions = stopAllRemoteControlSessions("rollout-policy-changed");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      rollout: updated,
      runtime: getRemoteSupportRuntimeSnapshot(),
      stoppedSessions,
    });
  });

  app.post("/api/screen-feed/admin/rollout/rollback", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    const updatedBy = actor(req);
    const rollout = rollbackRemoteSupportRollout(updatedBy);
    const runtime = updateRemoteSupportFlags(
      { remoteControl: false, keyboardControl: false },
      updatedBy
    );
    const stoppedSessions = stopAllRemoteControlSessions("rollout-emergency-rollback");
    res.setHeader("Cache-Control", "no-store");
    res.json({ rollout, runtime, stoppedSessions });
  });
}
