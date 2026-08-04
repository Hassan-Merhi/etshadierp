import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LockKeyhole, MousePointer2, ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";
import { normalizeRemoteMousePoint, type RemoteMouseCommandType } from "@/hooks/remote-mouse-control-policy";
import { translateRemoteSupportPhase4Text } from "@/i18n/remoteSupportPhase4Translations";
import { translateRemoteSupportPhase5Text } from "@/i18n/remoteSupportPhase5Translations";

interface MouseAuthorizationView {
  sessionId: string;
  controllerUserId: string;
  authorizedAt: string;
  expiresAt: string;
}

interface ControllerSessionView extends RemoteControlSessionView {
  mouseAuthorization: MouseAuthorizationView | null;
}

interface ControllerSessionsResponse {
  sessions: ControllerSessionView[];
}

interface CommandResultView {
  commandId: string;
  sessionId: string;
  status: "executed" | "blocked" | "ignored";
  reason: string | null;
  completedAt: string;
}

class RemoteRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "RemoteRequestError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RemoteRequestError(
      response.status,
      typeof payload?.code === "string" ? payload.code : null,
      typeof payload?.message === "string" ? payload.message : "Remote mouse request failed."
    );
  }
  return payload as T;
}

function findWatchDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-testid='dialog-watch-user']");
}

function matchingSession(sessions: ControllerSessionView[]): ControllerSessionView | null {
  const dialog = findWatchDialog();
  const watchedUserId = dialog?.dataset.watchedUserId;
  const dialogText = dialog?.textContent ?? "";
  return (
    sessions.find((session) => watchedUserId && session.targetUserId === watchedUserId) ??
    sessions.find((session) => dialogText.includes(session.targetUsername)) ??
    sessions[0] ??
    null
  );
}

function authorizationIsFresh(authorization: MouseAuthorizationView | null): boolean {
  if (!authorization) return false;
  const expiresAt = new Date(authorization.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function RemoteMouseControllerOverlay() {
  const { language } = useApplicationLanguage();
  const [watchDialogOpen, setWatchDialogOpen] = useState(() => !!findWatchDialog());
  const [armedSessionId, setArmedSessionId] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CommandResultView | null>(null);
  const pointerSentAtRef = useRef(0);
  const wheelSentAtRef = useRef(0);
  const t = useCallback((value: string) => translateRemoteSupportPhase5Text(value, language), [language]);

  useEffect(() => {
    const update = () => setWatchDialogOpen(!!findWatchDialog());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const sessionsQuery = useQuery<ControllerSessionsResponse>({
    queryKey: ["/api/screen-feed/control/sessions/controller-active"],
    queryFn: () => requestJson<ControllerSessionsResponse>("/api/screen-feed/control/sessions/controller-active"),
    enabled: watchDialogOpen,
    refetchInterval: watchDialogOpen ? 1500 : false,
    retry: false,
  });

  const session = useMemo(
    () => matchingSession(Array.isArray(sessionsQuery.data?.sessions) ? sessionsQuery.data.sessions : []),
    [sessionsQuery.data?.sessions]
  );
  const authorized = authorizationIsFresh(session?.mouseAuthorization ?? null);
  const controlEnabled = !!session && session.capabilities.mouse && authorized && armedSessionId === session.id;

  useEffect(() => {
    if (!session || !session.capabilities.mouse || !authorized || armedSessionId !== session.id) {
      if (armedSessionId && (!session || armedSessionId !== session.id || !session.capabilities.mouse || !authorized)) {
        setArmedSessionId(null);
      }
    }
  }, [armedSessionId, authorized, session]);

  useEffect(() => {
    setError(null);
    setLastResult(null);
    setPasswordOpen(false);
    setPassword("");
  }, [session?.id]);

  const requestMouseAuthorization = useCallback(async () => {
    if (!session) return;
    await requestJson(`/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/mouse-authorization`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await sessionsQuery.refetch();
    setArmedSessionId(session.id);
    setPasswordOpen(false);
    setPassword("");
  }, [session, sessionsQuery]);

  const authorizeMouse = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestMouseAuthorization();
    } catch (requestError) {
      if (
        requestError instanceof RemoteRequestError &&
        (requestError.status === 428 || requestError.code === "PASSWORD_CONFIRMATION_REQUIRED")
      ) {
        setPasswordOpen(true);
      } else {
        setError(requestError instanceof Error ? t(requestError.message) : t("Unable to enable mouse control."));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, requestMouseAuthorization, session, t]);

  const confirmPasswordAndAuthorize = useCallback(async () => {
    if (!password || busy || !session) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/auth/confirm-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      await requestMouseAuthorization();
    } catch (requestError) {
      setError(requestError instanceof Error ? t(requestError.message) : t("Password confirmation failed."));
    } finally {
      setBusy(false);
    }
  }, [busy, password, requestMouseAuthorization, session, t]);

  const stopMouse = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson(
        `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/mouse-authorization/revoke`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setArmedSessionId(null);
      setLastResult(null);
      await sessionsQuery.refetch();
    } catch (requestError) {
      setError(requestError instanceof Error ? t(requestError.message) : t("Mouse command failed."));
    } finally {
      setBusy(false);
    }
  }, [busy, session, sessionsQuery, t]);

  const sendCommand = useCallback(
    async (
      type: RemoteMouseCommandType,
      point: { x: number; y: number },
      delta?: { deltaX: number; deltaY: number }
    ) => {
      if (!session || !controlEnabled) return;
      try {
        await requestJson(`/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/commands`, {
          method: "POST",
          body: JSON.stringify({ type, ...point, ...delta }),
        });
      } catch (requestError) {
        if (
          requestError instanceof RemoteRequestError &&
          (requestError.status === 428 || requestError.code === "MOUSE_AUTHORIZATION_REQUIRED")
        ) {
          setArmedSessionId(null);
          setPasswordOpen(true);
        }
        setError(requestError instanceof Error ? t(requestError.message) : t("Mouse command failed."));
      }
    },
    [controlEnabled, session, t]
  );

  useEffect(() => {
    if (!controlEnabled || !session) return;

    const image = document.querySelector<HTMLImageElement>(
      "[data-testid='dialog-watch-user'] [data-testid='img-screen-feed']"
    );
    if (!image) return;

    image.style.cursor = "crosshair";
    image.style.touchAction = "none";

    const pointFromEvent = (clientX: number, clientY: number) =>
      normalizeRemoteMousePoint(clientX, clientY, image.getBoundingClientRect());

    const onPointerMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - pointerSentAtRef.current < 80) return;
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      pointerSentAtRef.current = now;
      void sendCommand("pointer-move", point);
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      void sendCommand("click", point);
    };

    const onWheel = (event: WheelEvent) => {
      const now = Date.now();
      if (now - wheelSentAtRef.current < 80) return;
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      wheelSentAtRef.current = now;
      event.preventDefault();
      event.stopPropagation();
      void sendCommand("scroll", point, {
        deltaX: Math.max(-1200, Math.min(1200, event.deltaX)),
        deltaY: Math.max(-1200, Math.min(1200, event.deltaY)),
      });
    };

    image.addEventListener("pointermove", onPointerMove);
    image.addEventListener("click", onClick, true);
    image.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      image.style.cursor = "";
      image.style.touchAction = "";
      image.removeEventListener("pointermove", onPointerMove);
      image.removeEventListener("click", onClick, true);
      image.removeEventListener("wheel", onWheel, true);
    };
  }, [controlEnabled, sendCommand, session]);

  useEffect(() => {
    if (!controlEnabled || !session) return;
    const eventSource = new EventSource(`/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/results`, {
      withCredentials: true,
    });
    eventSource.addEventListener("result", (event) => {
      try {
        const result = JSON.parse((event as MessageEvent<string>).data) as CommandResultView;
        if (result?.sessionId === session.id) {
          setLastResult(result);
          if (result.status === "blocked") {
            setError(t("That control is protected and cannot be activated remotely."));
          }
        }
      } catch {
        // A later result replaces malformed stream data.
      }
    });
    return () => eventSource.close();
  }, [controlEnabled, session, t]);

  if (!watchDialogOpen || !session) return null;

  const statusLabel = lastResult
    ? t(lastResult.status === "executed" ? "Executed" : lastResult.status === "blocked" ? "Blocked" : "Ignored")
    : null;

  return (
    <div
      className="fixed right-3 top-14 z-[2147483645] w-[min(92vw,360px)] rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur"
      data-screenfeed-ignore="true"
      data-testid="remote-mouse-controller-overlay"
    >
      <div className="flex items-start gap-2">
        <div className="rounded-md bg-primary/10 p-1.5 text-primary">
          {controlEnabled ? <MousePointer2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {t("Mouse control")} · {session.targetUsername}
          </p>
          <p className="text-xs text-muted-foreground">
            {translateRemoteSupportPhase4Text("ERP tab only", language)} · {t("Safe viewing and navigation")} ·{" "}
            {t("Keyboard disabled")}
          </p>
        </div>
        {controlEnabled ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-2"
            onClick={() => void stopMouse()}
            disabled={busy}
            data-testid="button-disable-remote-mouse"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Square className="mr-1 h-3 w-3" />}
            {t("Stop mouse")}
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 shrink-0 px-2"
            onClick={() => void authorizeMouse()}
            disabled={busy}
            data-testid="button-enable-remote-mouse"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LockKeyhole className="mr-1 h-3 w-3" />}
            {t("Enable")}
          </Button>
        )}
      </div>

      {passwordOpen && !controlEnabled && (
        <form
          className="mt-3 space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmPasswordAndAuthorize();
          }}
        >
          <p className="text-xs font-medium">
            {t("Confirm your password to enable mouse control for up to 5 minutes.")}
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("Password")}
              className="h-9"
              data-testid="input-remote-mouse-password"
            />
            <Button type="submit" size="sm" className="h-9" disabled={!password || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Confirm")}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {controlEnabled
            ? t("Active: click and scroll on allowlisted controls")
            : t("Read-only until explicitly enabled")}
        </span>
        {statusLabel && <span className="shrink-0">{statusLabel}</span>}
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
