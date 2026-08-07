import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, LockKeyhole, MousePointer2, ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RemoteControllerRequestError,
  remoteControllerRequestJson,
  useRemoteControllerSession,
} from "@/components/RemoteControllerSessionContext";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { normalizeRemoteMousePoint, type RemoteMouseCommandType } from "@/hooks/remote-mouse-control-policy";
import { translateRemoteSupportPhase4Text } from "@/i18n/remoteSupportPhase4Translations";
import { translateRemoteSupportPhase5Text } from "@/i18n/remoteSupportPhase5Translations";

interface CommandResultView {
  commandId: string;
  sessionId: string;
  status: "executed" | "blocked" | "ignored";
  reason: string | null;
  completedAt: string;
}

interface MouseCommandPayload {
  type: RemoteMouseCommandType;
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
}

const POINTER_COALESCE_MS = 125;
const SCROLL_COALESCE_MS = 100;

function authorizationIsFresh(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const value = new Date(expiresAt).getTime();
  return Number.isFinite(value) && value > Date.now();
}

export function RemoteMouseControllerOverlay() {
  const { language } = useApplicationLanguage();
  const { target, session, portalHost, refreshSession } = useRemoteControllerSession();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CommandResultView | null>(null);
  const commandTailRef = useRef<Promise<void>>(Promise.resolve());
  const activeSessionIdRef = useRef<string | null>(null);
  const pointerPendingRef = useRef<{ x: number; y: number } | null>(null);
  const pointerTimerRef = useRef<number | null>(null);
  const scrollPendingRef = useRef<{ x: number; y: number; deltaX: number; deltaY: number } | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const t = useCallback((value: string) => translateRemoteSupportPhase5Text(value, language), [language]);

  const authorized = authorizationIsFresh(session?.mouseAuthorization?.expiresAt);
  const controlEnabled = !!session && session.capabilities.mouse && authorized;

  useEffect(() => {
    activeSessionIdRef.current = session?.id ?? null;
    setError(null);
    setLastResult(null);
    setPasswordOpen(false);
    setPassword("");
    pointerPendingRef.current = null;
    scrollPendingRef.current = null;
    if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
    pointerTimerRef.current = null;
    scrollTimerRef.current = null;
  }, [session?.id]);

  const requestMouseAuthorization = useCallback(async () => {
    if (!session) return;
    await remoteControllerRequestJson(
      `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/mouse-authorization`,
      { method: "POST", body: JSON.stringify({}) }
    );
    await refreshSession();
    setPasswordOpen(false);
    setPassword("");
  }, [refreshSession, session]);

  const authorizeMouse = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestMouseAuthorization();
    } catch (requestError) {
      if (
        requestError instanceof RemoteControllerRequestError &&
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
      await remoteControllerRequestJson("/api/auth/confirm-password", {
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
      await remoteControllerRequestJson(
        `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/mouse-authorization/revoke`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setLastResult(null);
      await refreshSession();
    } catch (requestError) {
      setError(requestError instanceof Error ? t(requestError.message) : t("Mouse command failed."));
    } finally {
      setBusy(false);
    }
  }, [busy, refreshSession, session, t]);

  const enqueueCommand = useCallback(
    (payload: MouseCommandPayload) => {
      const sessionId = session?.id;
      if (!sessionId || !controlEnabled) return;

      const run = async () => {
        if (activeSessionIdRef.current !== sessionId) return;
        try {
          await remoteControllerRequestJson(
            `/api/screen-feed/control/sessions/${encodeURIComponent(sessionId)}/commands`,
            {
              method: "POST",
              body: JSON.stringify(payload),
            }
          );
        } catch (requestError) {
          if (activeSessionIdRef.current !== sessionId) return;
          if (
            requestError instanceof RemoteControllerRequestError &&
            (requestError.status === 428 || requestError.code === "MOUSE_AUTHORIZATION_REQUIRED")
          ) {
            setPasswordOpen(true);
            void refreshSession().catch(() => undefined);
          }
          setError(requestError instanceof Error ? t(requestError.message) : t("Mouse command failed."));
        }
      };

      commandTailRef.current = commandTailRef.current.catch(() => undefined).then(run);
    },
    [controlEnabled, refreshSession, session?.id, t]
  );

  const flushPointer = useCallback(() => {
    pointerTimerRef.current = null;
    const point = pointerPendingRef.current;
    pointerPendingRef.current = null;
    if (point) enqueueCommand({ type: "pointer-move", ...point });
  }, [enqueueCommand]);

  const flushScroll = useCallback(() => {
    scrollTimerRef.current = null;
    const pending = scrollPendingRef.current;
    scrollPendingRef.current = null;
    if (pending && (pending.deltaX !== 0 || pending.deltaY !== 0)) {
      enqueueCommand({ type: "scroll", ...pending });
    }
  }, [enqueueCommand]);

  useEffect(() => {
    if (!controlEnabled || !session || !portalHost) return;
    const dialog = portalHost.closest<HTMLElement>("[data-testid='dialog-watch-user']");
    if (!dialog || dialog.dataset.watchedUserId !== session.targetUserId) return;
    const image = dialog.querySelector<HTMLImageElement>("[data-testid='img-screen-feed']");
    if (!image) return;

    image.style.cursor = "crosshair";
    image.style.touchAction = "none";

    const pointFromEvent = (clientX: number, clientY: number) =>
      normalizeRemoteMousePoint(clientX, clientY, image.getBoundingClientRect());

    const onPointerMove = (event: PointerEvent) => {
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      pointerPendingRef.current = point;
      if (pointerTimerRef.current === null) {
        pointerTimerRef.current = window.setTimeout(flushPointer, POINTER_COALESCE_MS);
      }
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      pointerPendingRef.current = null;
      if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
      pointerTimerRef.current = null;
      enqueueCommand({ type: "click", ...point });
    };

    const onWheel = (event: WheelEvent) => {
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      const previous = scrollPendingRef.current;
      scrollPendingRef.current = {
        ...point,
        deltaX: Math.max(-1200, Math.min(1200, (previous?.deltaX ?? 0) + event.deltaX)),
        deltaY: Math.max(-1200, Math.min(1200, (previous?.deltaY ?? 0) + event.deltaY)),
      };
      if (scrollTimerRef.current === null) {
        scrollTimerRef.current = window.setTimeout(flushScroll, SCROLL_COALESCE_MS);
      }
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
      pointerPendingRef.current = null;
      scrollPendingRef.current = null;
      if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      pointerTimerRef.current = null;
      scrollTimerRef.current = null;
    };
  }, [controlEnabled, enqueueCommand, flushPointer, flushScroll, portalHost, session]);

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

  if (!target || !session || !portalHost) return null;

  const statusLabel = lastResult
    ? t(lastResult.status === "executed" ? "Executed" : lastResult.status === "blocked" ? "Blocked" : "Ignored")
    : null;

  return createPortal(
    <section
      className="w-full rounded-xl border bg-background/95 p-3 shadow-sm"
      data-screenfeed-ignore="true"
      data-testid="remote-mouse-controller-overlay"
      data-remote-control-panel-section="mouse"
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
              autoFocus
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
    </section>,
    portalHost
  );
}
