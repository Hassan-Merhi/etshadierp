import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

interface WatchTarget {
  userId: string;
  username: string;
}

interface SessionPayload {
  session?: {
    id?: string;
    status?: string;
    targetUserId?: string;
  } | null;
  code?: string;
  message?: string;
}

type WatchdogState = "idle" | "waiting" | "starting" | "ready" | "error";

const RECONCILE_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 5000;

function currentWatchTarget(): WatchTarget | null {
  const dialog = document.querySelector<HTMLElement>("[data-testid='dialog-watch-user']");
  const userId = dialog?.dataset.watchedUserId?.trim() ?? "";
  if (!dialog || !userId) return null;

  const heading = dialog.querySelector<HTMLElement>("[data-watch-username]")?.dataset.watchUsername?.trim();
  const text = dialog.textContent ?? "";
  const match = text.match(/Watching:\s*([^·\n]+)/i);
  return {
    userId,
    username: heading || match?.[1]?.trim() || userId,
  };
}

async function requestPayload(url: string, init?: RequestInit): Promise<{ response: Response; payload: SessionPayload }> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => ({}))) as SessionPayload;
  return { response, payload };
}

export function RemoteControlSessionWatchdog() {
  const [target, setTarget] = useState<WatchTarget | null>(() => currentWatchTarget());
  const [state, setState] = useState<WatchdogState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const lastHeartbeatRef = useRef(0);

  useEffect(() => {
    const refresh = () => {
      const next = currentWatchTarget();
      setTarget((current) => {
        if (current?.userId === next?.userId && current?.username === next?.username) return current;
        sessionIdRef.current = null;
        lastHeartbeatRef.current = 0;
        setState(next ? "waiting" : "idle");
        setMessage(null);
        return next;
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;

    const reconcile = async () => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const active = await requestPayload(
          `/api/screen-feed/control/sessions/active/${encodeURIComponent(target.userId)}`,
        );
        if (cancelled) return;

        const activeSession = active.response.ok ? active.payload.session : null;
        if (activeSession?.id && activeSession.status === "active") {
          sessionIdRef.current = activeSession.id;
          setState("ready");
          setMessage(null);

          if (Date.now() - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeatRef.current = Date.now();
            const heartbeat = await requestPayload(
              `/api/screen-feed/control/sessions/${encodeURIComponent(activeSession.id)}/heartbeat`,
              { method: "POST", body: JSON.stringify({}) },
            );
            if (!heartbeat.response.ok) {
              sessionIdRef.current = null;
              setState("waiting");
              setMessage(heartbeat.payload.message || "Reconnecting the support session.");
            }
          }
          return;
        }

        setState("starting");
        const started = await requestPayload("/api/screen-feed/control/sessions", {
          method: "POST",
          body: JSON.stringify({
            targetUserId: target.userId,
            targetUsername: target.username,
            durationMinutes: 15,
          }),
        });
        if (cancelled) return;

        if (started.response.ok && started.payload.session?.id) {
          sessionIdRef.current = started.payload.session.id;
          lastHeartbeatRef.current = Date.now();
          setState("ready");
          setMessage(null);
          return;
        }

        const code = started.payload.code ?? "";
        if (
          started.response.status === 409 &&
          ["TARGET_TAB_UNAVAILABLE", "TARGET_ALREADY_CONTROLLED", "SESSION_INACTIVE"].includes(code)
        ) {
          setState("waiting");
          setMessage(
            code === "TARGET_ALREADY_CONTROLLED"
              ? "Another controller already owns this support session."
              : "Waiting for the employee ERP tab to register for control.",
          );
          return;
        }

        setState("error");
        setMessage(started.payload.message || `Remote control is unavailable (${started.response.status}).`);
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Unable to prepare remote control.");
      } finally {
        runningRef.current = false;
      }
    };

    void reconcile();
    const intervalId = window.setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      runningRef.current = false;
    };
  }, [target]);

  if (!target || state === "idle" || state === "ready") return null;

  const failed = state === "error";
  return (
    <div
      className="fixed left-3 top-14 z-[2147483645] flex max-w-[min(92vw,420px)] items-start gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-xl backdrop-blur"
      data-screenfeed-ignore="true"
      data-testid="remote-control-session-watchdog"
      role={failed ? "alert" : "status"}
    >
      {failed ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      ) : state === "starting" ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          {failed ? "Remote control unavailable" : state === "starting" ? "Preparing remote control" : "Control reconnecting"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {message || `Preparing the ERP tab for ${target.username}.`}
        </p>
      </div>
    </div>
  );
}
