import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Eye,
  History,
  Maximize2,
  Monitor,
  MousePointer2,
  Wifi,
  WifiOff,
  ZoomIn,
} from "lucide-react";
import {
  calculateContainedScreenFeedSize,
  classifyScreenFeedConnection,
  formatScreenFeedDelay,
  type ScreenFeedDisplaySize,
} from "./screen-feed-viewer-layout";

export function getPageLabel(route: string): string {
  if (!route || route === "/") return "Dashboard";
  const routeLabels: Record<string, string> = {
    "/": "Dashboard",
    "/dashboard": "Dashboard",
    "/locations": "Locations",
    "/locations/inventory": "Location Inventory",
    "/stock-items": "Stock Items",
    "/stock-groups": "Stock Groups",
    "/ledger-accounts": "Ledger Accounts",
    "/vouchers": "Vouchers",
    "/vouchers/payment": "Payment Vouchers",
    "/vouchers/receipt": "Receipt Vouchers",
    "/vouchers/journal": "Journal Vouchers",
    "/vouchers/sales": "Sales Vouchers",
    "/purchase-orders": "Purchase Orders",
    "/containers": "Containers",
    "/containers/otw": "Containers OTW",
    "/employees": "Employees",
    "/customers": "Customers",
    "/suppliers": "Suppliers",
    "/bank-accounts": "Bank Accounts",
    "/reports": "Reports",
    "/reports/profit-loss": "Profit & Loss",
    "/reports/balance-sheet": "Balance Sheet",
    "/settings": "Settings",
    "/pos": "Point of Sale",
    "/pos/sales": "POS Sales",
    "/chatbot": "AI Chatbot",
    "/deleted-items": "Deleted Items",
  };
  if (routeLabels[route]) return routeLabels[route];
  return route
    .replace(/^\//, "")
    .replace(/-/g, " ")
    .replace(/\//g, " > ")
    .split(" ")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface ScreenFeedCursor {
  x: number;
  y: number;
  ts: number;
  visible: boolean;
}

interface ScreenFeedViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  documentWidth: number;
  documentHeight: number;
  devicePixelRatio: number;
  visualScale: number;
}

interface ScreenFeedCapture {
  width: number;
  height: number;
  source: "dom" | "retry" | "fallback";
  quality: number;
  encodedBytes: number;
  durationMs: number;
}

interface ScreenFrame {
  dataUrl: string;
  capturedAt: string;
  receivedAt?: string;
  clientCapturedAt?: string | null;
  username: string;
  clicks: Array<{ x: number; y: number; label: string; ts: number }>;
  cursor?: ScreenFeedCursor | null;
  viewport?: ScreenFeedViewport | null;
  capture?: ScreenFeedCapture | null;
}

type DisplayMode = "fit" | "actual";

const qualityLabels = {
  excellent: "Excellent",
  good: "Good",
  delayed: "Delayed",
  stale: "Stale",
  waiting: "Waiting",
} as const;

function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function WatchUserDialog({
  userId,
  username,
  onClose,
}: {
  userId: string;
  username: string;
  onClose: () => void;
}) {
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveFrame, setLiveFrame] = useState<ScreenFrame | null>(null);
  const [liveCursor, setLiveCursor] = useState<ScreenFeedCursor | null>(null);
  const [frameReceivedAt, setFrameReceivedAt] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("fit");
  const [tick, setTick] = useState(Date.now());
  const [displaySize, setDisplaySize] = useState<ScreenFeedDisplaySize>({ width: 0, height: 0 });

  const viewerSurfaceRef = useRef<HTMLDivElement>(null);
  const frameViewportRef = useRef<HTMLDivElement>(null);
  const watchStartRef = useRef(Date.now());

  const { data: presenceRaw } = useQuery<any>({
    queryKey: ["/api/user-presence", userId],
    queryFn: () => apiRequest("GET", `/api/user-presence/${userId}`).then((response) => response.json()),
    refetchInterval: 30000,
  });
  const { data: activityRaw } = useQuery<any>({
    queryKey: ["/api/user-presence", userId, "activity"],
    queryFn: () => apiRequest("GET", `/api/user-presence/${userId}/activity`).then((response) => response.json()),
    refetchInterval: 30000,
  });
  const { data: screenFrameRaw } = useQuery<any>({
    queryKey: ["/api/screen-feed", userId],
    queryFn: () => apiRequest("GET", `/api/screen-feed/${userId}`).then((response) => response.json()),
    refetchInterval: liveConnected ? false : 5000,
  });

  useEffect(() => {
    const intervalId = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setLiveConnected(false);
    setLiveFrame(null);
    setLiveCursor(null);
    setFrameReceivedAt(null);

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/screen-feed/live/${encodeURIComponent(userId)}`, {
        withCredentials: true,
      });
      eventSource.addEventListener("ready", () => setLiveConnected(true));
      eventSource.addEventListener("frame", (event) => {
        try {
          const frame = JSON.parse((event as MessageEvent<string>).data) as ScreenFrame;
          if (frame?.dataUrl && frame?.capturedAt) {
            setLiveConnected(true);
            setLiveFrame(frame);
            setLiveCursor(frame.cursor ?? null);
            setFrameReceivedAt(Date.now());
          }
        } catch {
          setLiveConnected(false);
        }
      });
      eventSource.addEventListener("cursor", (event) => {
        try {
          const cursor = JSON.parse((event as MessageEvent<string>).data) as ScreenFeedCursor;
          if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
            setLiveCursor(cursor);
          }
        } catch {
          // The next valid cursor or frame replaces a malformed event.
        }
      });
      eventSource.onerror = () => {
        setLiveConnected(false);
        setLiveFrame(null);
      };
    } catch {
      setLiveConnected(false);
    }

    return () => eventSource?.close();
  }, [userId]);

  const presence = presenceRaw && typeof presenceRaw === "object" && !Array.isArray(presenceRaw) ? presenceRaw : null;
  const activity = Array.isArray(activityRaw) ? activityRaw : [];
  const fallbackFrame =
    screenFrameRaw && typeof screenFrameRaw === "object" && !Array.isArray(screenFrameRaw)
      ? (screenFrameRaw as ScreenFrame)
      : null;
  const screenFrame = liveFrame ?? fallbackFrame;
  const clicks = Array.isArray(screenFrame?.clicks) ? screenFrame.clicks : [];
  const cursor = liveCursor ?? screenFrame?.cursor ?? null;

  useEffect(() => {
    if (!liveFrame && fallbackFrame?.dataUrl) {
      setFrameReceivedAt(Date.now());
      setLiveCursor(fallbackFrame.cursor ?? null);
    }
  }, [fallbackFrame?.capturedAt, fallbackFrame?.cursor, fallbackFrame?.dataUrl, liveFrame]);

  const sourceWidth = screenFrame?.capture?.width ?? screenFrame?.viewport?.width ?? 1280;
  const sourceHeight = screenFrame?.capture?.height ?? screenFrame?.viewport?.height ?? 720;

  useEffect(() => {
    const element = frameViewportRef.current;
    if (!element) return;

    const updateSize = () => {
      if (displayMode === "actual") {
        setDisplaySize({ width: sourceWidth, height: sourceHeight });
        return;
      }
      setDisplaySize(
        calculateContainedScreenFeedSize(element.clientWidth, element.clientHeight, sourceWidth, sourceHeight),
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [displayMode, sourceHeight, sourceWidth]);

  const isOnline =
    !!presence &&
    !!presence.userId &&
    !!presence.lastSeen &&
    tick - new Date(presence.lastSeen).getTime() < 3 * 60 * 1000;
  const hasScreen = !!screenFrame?.dataUrl;
  const serverTimestamp = screenFrame?.receivedAt ?? screenFrame?.capturedAt;
  const frameAgeMs = serverTimestamp ? Math.max(0, tick - new Date(serverTimestamp).getTime()) : Number.POSITIVE_INFINITY;
  const transportDelayMs =
    serverTimestamp && frameReceivedAt !== null
      ? Math.max(0, frameReceivedAt - new Date(serverTimestamp).getTime())
      : Number.NaN;
  const quality = classifyScreenFeedConnection(hasScreen, liveConnected, frameAgeMs);
  const recentClicks = clicks.filter((click) => tick - click.ts < 4000);
  const cursorVisible = !!cursor?.visible && tick - cursor.ts < 3000;

  const fmtTime = (value: string | Date | null | undefined) => {
    if (!value) return "—";
    const date = new Date(value as string);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const timeAgo = (value: string | Date | null | undefined) => {
    if (!value) return "unknown";
    const date = new Date(value as string);
    if (Number.isNaN(date.getTime())) return "unknown";
    const seconds = Math.floor((tick - date.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const openNativeFullscreen = () => {
    if (viewerSurfaceRef.current?.requestFullscreen) {
      void viewerSurfaceRef.current.requestFullscreen();
    }
  };

  const frameMetadata = useMemo(() => {
    const capture = screenFrame?.capture;
    const viewport = screenFrame?.viewport;
    return {
      resolution: capture ? `${capture.width}×${capture.height}` : `${sourceWidth}×${sourceHeight}`,
      viewport: viewport ? `${viewport.width}×${viewport.height}` : "—",
      scroll: viewport ? `${viewport.scrollX}, ${viewport.scrollY}` : "—",
      zoom: viewport ? `${Math.round(viewport.visualScale * 100)}%` : "—",
      dpr: viewport ? viewport.devicePixelRatio.toFixed(2) : "—",
      source: capture?.source ?? "legacy",
      size: formatBytes(capture?.encodedBytes),
      captureTime: capture ? formatScreenFeedDelay(capture.durationMs) : "—",
    };
  }, [screenFrame?.capture, screenFrame?.viewport, sourceHeight, sourceWidth]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !max-w-none !w-screen !h-screen !rounded-none p-0 overflow-hidden flex flex-col"
        data-testid="dialog-watch-user"
        data-screenfeed-ignore="true"
      >
        <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0 flex-wrap gap-y-1">
          {isOnline ? (
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">
                Live
              </span>
            </span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
          )}
          <span className="font-semibold text-sm">Watching: {username}</span>
          {isOnline && presence && (
            <span className="text-sm text-muted-foreground">
              · {presence.companyName || "no company"} · {presence.role || "—"} · last seen {timeAgo(presence.lastSeen)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${
                quality === "excellent"
                  ? "border-green-500/40 text-green-600 dark:text-green-400"
                  : quality === "good"
                    ? "border-blue-500/40 text-blue-600 dark:text-blue-400"
                    : quality === "delayed"
                      ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                      : "border-muted-foreground/30 text-muted-foreground"
              }`}
              data-testid="screen-feed-quality"
            >
              {liveConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {qualityLabels[quality]}
            </span>
            <Button
              size="sm"
              variant={displayMode === "fit" ? "default" : "outline"}
              onClick={() => setDisplayMode("fit")}
              data-testid="button-feed-fit"
            >
              <Monitor className="h-3.5 w-3.5 mr-1.5" />
              Fit
            </Button>
            <Button
              size="sm"
              variant={displayMode === "actual" ? "default" : "outline"}
              onClick={() => setDisplayMode("actual")}
              data-testid="button-feed-actual"
            >
              <ZoomIn className="h-3.5 w-3.5 mr-1.5" />
              100%
            </Button>
            {hasScreen && (
              <Button size="sm" variant="outline" onClick={openNativeFullscreen} data-testid="button-fullscreen-feed">
                <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
                Full Screen
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div ref={viewerSurfaceRef} className="flex-1 min-w-0 flex flex-col overflow-hidden bg-black">
            <div
              ref={frameViewportRef}
              className={`flex-1 min-h-0 ${
                displayMode === "fit"
                  ? "overflow-hidden flex items-center justify-center"
                  : "overflow-auto flex items-start justify-start"
              }`}
              data-testid="screen-feed-viewport"
            >
              {hasScreen ? (
                <div
                  className="relative shrink-0"
                  style={{ width: displaySize.width, height: displaySize.height }}
                  data-testid="screen-feed-frame-wrapper"
                >
                  <img
                    src={screenFrame.dataUrl}
                    alt="Live screen of user"
                    className="block w-full h-full object-fill select-none"
                    draggable={false}
                    data-testid="img-screen-feed"
                    style={{ imageRendering: "auto" }}
                  />
                  {cursorVisible && cursor && (
                    <div
                      className="absolute pointer-events-none drop-shadow-md"
                      style={{
                        left: `${cursor.x * 100}%`,
                        top: `${cursor.y * 100}%`,
                        transform: "translate(-2px, -2px)",
                      }}
                      data-testid="screen-feed-cursor"
                    >
                      <MousePointer2 className="h-5 w-5 fill-white text-black" />
                    </div>
                  )}
                  {recentClicks.map((click, index) => {
                    const ageSec = (tick - click.ts) / 1000;
                    const opacity = Math.max(0, 1 - ageSec / 4);
                    return (
                      <div
                        key={`${click.ts}-${index}`}
                        title={click.label}
                        style={{
                          position: "absolute",
                          left: `${click.x * 100}%`,
                          top: `${click.y * 100}%`,
                          transform: "translate(-50%, -50%)",
                          opacity,
                          pointerEvents: "none",
                        }}
                      >
                        <span className="relative flex h-5 w-5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-5 w-5 bg-orange-500 border-2 border-white" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground m-auto">
                  <Clock className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Waiting for first frame…</p>
                  <p className="text-xs">Live delivery starts as soon as the browser responds.</p>
                  {tick - watchStartRef.current > 20000 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center max-w-xs">
                      Still waiting — the fallback viewer will keep retrying automatically.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t px-3 py-1.5 shrink-0 bg-background/95 text-xs text-muted-foreground">
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
                <span className="font-medium text-foreground">{liveConnected ? "Live stream" : "Polling fallback"}</span>
                <span>Frame age: {Number.isFinite(frameAgeMs) ? formatScreenFeedDelay(frameAgeMs) : "—"}</span>
                <span>Delivery: {formatScreenFeedDelay(transportDelayMs)}</span>
                <span>Capture: {frameMetadata.resolution}</span>
                <span>Viewport: {frameMetadata.viewport}</span>
                <span>Zoom: {frameMetadata.zoom}</span>
                <span>DPR: {frameMetadata.dpr}</span>
                <span>Scroll: {frameMetadata.scroll}</span>
                <span>Frame: {frameMetadata.size}</span>
                <span>Render: {frameMetadata.captureTime}</span>
                <span>Source: {frameMetadata.source}</span>
              </div>
            </div>

            {clicks.length > 0 && (
              <div className="border-t px-3 py-1.5 shrink-0 bg-background/80 backdrop-blur-sm">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1 shrink-0">
                    <Eye className="h-3 w-3" /> Clicks
                  </span>
                  {[...clicks]
                    .reverse()
                    .slice(0, 6)
                    .map((click, index) => (
                      <div
                        key={`${click.ts}-${index}`}
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        <span className="truncate max-w-[160px]">{click.label || "—"}</span>
                        <span className="text-muted-foreground/50 shrink-0">
                          {new Date(click.ts).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="w-72 shrink-0 border-l flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b shrink-0">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                <History className="h-3.5 w-3.5" /> Page history
              </p>
            </div>
            {isOnline && presence?.currentRoute && (
              <div className="px-3 py-2 border-b shrink-0 bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Currently on</p>
                <p className="text-sm font-semibold truncate">{getPageLabel(presence.currentRoute)}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">{presence.currentRoute}</p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto divide-y text-sm min-h-0">
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-3">
                  No history yet — pages appear here as the user navigates.
                </p>
              ) : (
                activity.map((event: any) => (
                  <div key={event.id} className="px-3 py-2 space-y-0.5">
                    <p className="font-medium leading-tight truncate">{getPageLabel(event.route)}</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground font-mono truncate">{event.route}</p>
                      <p className="text-xs text-muted-foreground shrink-0">{fmtTime(event.occurredAt)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
