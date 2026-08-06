import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, Wifi, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { WatchUserDialog } from "./WatchUserDialog";

interface RemoteSupportRuntime {
  flags?: {
    screenFeedEnabled?: boolean;
    fastScreenFeed?: boolean;
  };
}

interface ScreenFrame {
  dataUrl: string;
  capturedAt: string;
  receivedAt?: string;
  username?: string;
}

interface FastPollState {
  etag: string | null;
  frame: ScreenFrame | null;
}

const FALLBACK_POLL_MS = 3000;

async function fetchConditionalFrame(userId: string, state: FastPollState, signal: AbortSignal): Promise<FastPollState> {
  const response = await fetch(`/api/screen-feed/${encodeURIComponent(userId)}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: state.etag ? { "If-None-Match": state.etag } : undefined,
  });

  if (response.status === 304) return state;
  if (!response.ok) throw new Error(`Screen feed request failed (${response.status}).`);

  const frame = (await response.json()) as ScreenFrame | null;
  return {
    etag: response.headers.get("ETag"),
    frame: frame?.dataUrl ? frame : state.frame,
  };
}

function FastScreenFeedDialog({
  userId,
  username,
  onClose,
}: {
  userId: string;
  username: string;
  onClose: () => void;
}) {
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const stateRef = useRef<FastPollState>({ etag: null, frame: null });
  const connectedRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  const setConnectionState = useCallback((value: boolean) => {
    connectedRef.current = value;
    setConnected(value);
  }, []);

  const pollOnce = useCallback(async () => {
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setRefreshing(true);
    try {
      const next = await fetchConditionalFrame(userId, stateRef.current, controller.signal);
      stateRef.current = next;
      if (next.frame) setFrame(next.frame);
      setError(null);
    } catch (pollError) {
      if (controller.signal.aborted) return;
      setError(pollError instanceof Error ? pollError.message : "Polling recovery failed.");
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    stateRef.current = { etag: null, frame: null };
    setFrame(null);
    setConnectionState(false);
    setError(null);

    let closed = false;
    const eventSource = new EventSource(`/api/screen-feed/live/${encodeURIComponent(userId)}`, {
      withCredentials: true,
    });

    eventSource.addEventListener("ready", () => {
      if (closed) return;
      setConnectionState(true);
      setError(null);
    });
    eventSource.addEventListener("frame", (event) => {
      if (closed) return;
      try {
        const nextFrame = JSON.parse((event as MessageEvent<string>).data) as ScreenFrame;
        if (!nextFrame?.dataUrl) return;
        stateRef.current = { etag: null, frame: nextFrame };
        setFrame(nextFrame);
        setConnectionState(true);
        setError(null);
      } catch {
        setError("A live frame arrived in an invalid format.");
      }
    });
    eventSource.onerror = () => {
      if (closed) return;
      setConnectionState(false);
      setError("Live stream disconnected. Polling recovery is active.");
      void pollOnce();
    };

    void pollOnce();
    const intervalId = window.setInterval(() => {
      if (!connectedRef.current) void pollOnce();
    }, FALLBACK_POLL_MS);

    return () => {
      closed = true;
      window.clearInterval(intervalId);
      eventSource.close();
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      connectedRef.current = false;
      stateRef.current = { etag: null, frame: null };
    };
  }, [pollOnce, setConnectionState, userId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="!fixed !inset-0 !left-0 !top-0 !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none p-0 overflow-hidden flex flex-col bg-background"
        data-testid="dialog-watch-user-fast"
        data-watched-user-id={userId}
        data-screenfeed-ignore="true"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">Watching {username}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span>{connected ? "Fast live feed" : "Polling fallback"}</span>
              {frame?.capturedAt ? <span>· {new Date(frame.capturedAt).toLocaleTimeString()}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void pollOnce()} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="ghost" size="icon" aria-label="Close viewer" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto bg-black flex items-center justify-center">
          {frame?.dataUrl ? (
            <img
              src={frame.dataUrl}
              alt={`Live screen for ${username}`}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="text-sm text-white/70">Waiting for the first screen frame…</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RemoteSupportWatchDialog(props: {
  userId: string;
  username: string;
  onClose: () => void;
}) {
  const { data: runtime } = useQuery<RemoteSupportRuntime>({
    queryKey: ["/api/screen-feed/admin/runtime"],
    queryFn: () =>
      apiRequest("GET", "/api/screen-feed/admin/runtime").then((response) => response.json()),
    staleTime: 15000,
    retry: 1,
  });

  if (!runtime?.flags?.screenFeedEnabled || !runtime.flags.fastScreenFeed) {
    return <WatchUserDialog {...props} />;
  }
  return <FastScreenFeedDialog {...props} />;
}
