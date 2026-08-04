import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Keyboard, Loader2, LockKeyhole, MousePointer2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";
import type { RemoteKeyboardKey } from "@/hooks/remote-keyboard-control-policy";
import { translateRemoteSupportPhase5Text } from "@/i18n/remoteSupportPhase5Translations";
import { translateRemoteSupportPhase6Text } from "@/i18n/remoteSupportPhase6Translations";

interface ControllerSessionsResponse {
  sessions: RemoteControlSessionView[];
}

interface KeyboardResultView {
  commandId: string;
  sessionId: string;
  status: "executed" | "blocked" | "ignored";
  reason: string | null;
  completedAt: string;
}

class RemoteKeyboardRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "RemoteKeyboardRequestError";
  }
}

const ALLOWED_SPECIAL_KEYS = new Map<string, RemoteKeyboardKey>([
  ["Backspace", "Backspace"],
  ["Delete", "Delete"],
  ["Tab", "Tab"],
  ["Escape", "Escape"],
  ["Enter", "Enter"],
  ["ArrowUp", "ArrowUp"],
  ["ArrowDown", "ArrowDown"],
  ["ArrowLeft", "ArrowLeft"],
  ["ArrowRight", "ArrowRight"],
  ["Home", "Home"],
  ["End", "End"],
  [" ", "Space"],
]);

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
    throw new RemoteKeyboardRequestError(
      response.status,
      typeof payload?.code === "string" ? payload.code : null,
      typeof payload?.message === "string" ? payload.message : "Keyboard command failed."
    );
  }
  return payload as T;
}

function findWatchDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-testid='dialog-watch-user']");
}

function matchingSession(sessions: RemoteControlSessionView[]): RemoteControlSessionView | null {
  const dialogText = findWatchDialog()?.textContent ?? "";
  return sessions.find((session) => dialogText.includes(`Watching: ${session.targetUsername}`)) ?? sessions[0] ?? null;
}

export function RemoteKeyboardControllerOverlay() {
  const { language } = useApplicationLanguage();
  const [watchDialogOpen, setWatchDialogOpen] = useState(() => !!findWatchDialog());
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<KeyboardResultView | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const t = useCallback((value: string) => translateRemoteSupportPhase6Text(value, language), [language]);

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
    refetchInterval: watchDialogOpen ? 1200 : false,
    retry: false,
  });

  const session = useMemo(
    () => matchingSession(Array.isArray(sessionsQuery.data?.sessions) ? sessionsQuery.data.sessions : []),
    [sessionsQuery.data?.sessions]
  );
  const keyboardActive = !!session?.capabilities.keyboard;
  const mouseActive = !!session?.capabilities.mouse;

  useEffect(() => {
    setError(null);
    setLastResult(null);
    setPasswordOpen(false);
    setPassword("");
  }, [session?.id]);

  useEffect(() => {
    if (keyboardActive) captureRef.current?.focus({ preventScroll: true });
  }, [keyboardActive]);

  const requestKeyboardAuthorization = useCallback(async () => {
    if (!session) return;
    await requestJson(
      `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/keyboard-authorization`,
      { method: "POST", body: JSON.stringify({}) }
    );
    await sessionsQuery.refetch();
    setPasswordOpen(false);
    setPassword("");
    window.setTimeout(() => captureRef.current?.focus({ preventScroll: true }), 0);
  }, [session, sessionsQuery]);

  const enableKeyboard = useCallback(async () => {
    if (!session || !mouseActive || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestKeyboardAuthorization();
    } catch (requestError) {
      if (
        requestError instanceof RemoteKeyboardRequestError &&
        (requestError.status === 428 || requestError.code === "PASSWORD_CONFIRMATION_REQUIRED")
      ) {
        setPasswordOpen(true);
      } else {
        setError(
          requestError instanceof Error ? t(requestError.message) : t("Unable to enable keyboard control.")
        );
      }
    } finally {
      setBusy(false);
    }
  }, [busy, mouseActive, requestKeyboardAuthorization, session, t]);

  const confirmPasswordAndEnable = useCallback(async () => {
    if (!password || !session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/auth/confirm-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      await requestKeyboardAuthorization();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? translateRemoteSupportPhase5Text(requestError.message, language)
          : translateRemoteSupportPhase5Text("Password confirmation failed.", language)
      );
    } finally {
      setBusy(false);
    }
  }, [busy, language, password, requestKeyboardAuthorization, session]);

  const stopKeyboard = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson(
        `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/keyboard-authorization/revoke`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setLastResult(null);
      await sessionsQuery.refetch();
    } catch (requestError) {
      setError(requestError instanceof Error ? t(requestError.message) : t("Keyboard command failed."));
    } finally {
      setBusy(false);
    }
  }, [busy, session, sessionsQuery, t]);

  const sendCommand = useCallback(
    async (payload: { type: "insert-text"; text: string } | { type: "key"; key: RemoteKeyboardKey; shiftKey: boolean }) => {
      if (!session || !keyboardActive) return;
      try {
        await requestJson(
          `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/keyboard-commands`,
          { method: "POST", body: JSON.stringify(payload) }
        );
      } catch (requestError) {
        if (
          requestError instanceof RemoteKeyboardRequestError &&
          (requestError.status === 428 || requestError.code === "KEYBOARD_AUTHORIZATION_REQUIRED")
        ) {
          setPasswordOpen(true);
          await sessionsQuery.refetch();
        }
        setError(requestError instanceof Error ? t(requestError.message) : t("Keyboard command failed."));
      }
    },
    [keyboardActive, session, sessionsQuery, t]
  );

  useEffect(() => {
    if (!session || !keyboardActive) return;
    const eventSource = new EventSource(
      `/api/screen-feed/control/sessions/${encodeURIComponent(session.id)}/keyboard-results`,
      { withCredentials: true }
    );
    eventSource.addEventListener("result", (event) => {
      try {
        const result = JSON.parse((event as MessageEvent<string>).data) as KeyboardResultView;
        if (result?.sessionId !== session.id) return;
        setLastResult(result);
        if (result.status === "blocked") {
          setError(t("That field is protected and cannot be edited remotely."));
        }
      } catch {
        // A later result replaces malformed stream data.
      }
    });
    return () => eventSource.close();
  }, [keyboardActive, session, t]);

  if (!watchDialogOpen || !session) return null;

  const statusLabel = lastResult
    ? translateRemoteSupportPhase5Text(
        lastResult.status === "executed" ? "Executed" : lastResult.status === "blocked" ? "Blocked" : "Ignored",
        language
      )
    : null;

  return (
    <div
      className="fixed right-3 top-[13.5rem] z-[2147483644] w-[min(92vw,360px)] rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur"
      data-screenfeed-ignore="true"
      data-testid="remote-keyboard-controller-overlay"
    >
      <div className="flex items-start gap-2">
        <div className="rounded-md bg-primary/10 p-1.5 text-primary">
          {keyboardActive ? <Keyboard className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {t("Keyboard control")} · {session.targetUsername}
          </p>
          <p className="text-xs text-muted-foreground">
            {mouseActive ? t("Only safe search, filter and explicitly approved fields can be edited.") : t("Mouse control required")}
          </p>
        </div>
        {keyboardActive ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-2"
            disabled={busy}
            onClick={() => void stopKeyboard()}
            data-testid="button-disable-remote-keyboard"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Square className="mr-1 h-3 w-3" />}
            {t("Stop keyboard")}
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 shrink-0 px-2"
            disabled={!mouseActive || busy}
            onClick={() => void enableKeyboard()}
            data-testid="button-enable-remote-keyboard"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LockKeyhole className="mr-1 h-3 w-3" />}
            {t("Enable keyboard")}
          </Button>
        )}
      </div>

      {passwordOpen && !keyboardActive && (
        <form
          className="mt-3 space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmPasswordAndEnable();
          }}
        >
          <p className="text-xs font-medium">
            {t("Confirm your password to enable keyboard control for up to 5 minutes.")}
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={translateRemoteSupportPhase5Text("Password", language)}
              className="h-9"
              data-testid="input-remote-keyboard-password"
            />
            <Button type="submit" size="sm" className="h-9" disabled={!password || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : translateRemoteSupportPhase5Text("Confirm", language)}
            </Button>
          </div>
        </form>
      )}

      {keyboardActive && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs font-medium">{t("Click a safe field in the watched screen, then type here.")}</p>
          <Input
            ref={captureRef}
            value=""
            inputMode="text"
            autoComplete="off"
            placeholder={t("Type remote text here")}
            className="h-9"
            data-testid="input-remote-keyboard-capture"
            onPaste={(event) => event.preventDefault()}
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey || event.altKey) {
                event.preventDefault();
                setError(t("Clipboard shortcuts and paste are blocked."));
                return;
              }
              const special = ALLOWED_SPECIAL_KEYS.get(event.key);
              if (special) {
                event.preventDefault();
                void sendCommand({ type: "key", key: special, shiftKey: event.shiftKey });
                return;
              }
              if (Array.from(event.key).length === 1) {
                event.preventDefault();
                void sendCommand({ type: "insert-text", text: event.key });
              }
            }}
          />
          <p className="text-[11px] text-muted-foreground">{t("Clipboard shortcuts and paste are blocked.")}</p>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{keyboardActive ? t("Keyboard active") : mouseActive ? t("Enable keyboard") : t("Mouse control required")}</span>
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
