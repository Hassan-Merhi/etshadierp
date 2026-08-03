import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Maximize2, Clock, Eye, History } from "lucide-react";

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

interface ScreenFrame {
  dataUrl: string;
  capturedAt: string;
  username: string;
  clicks: Array<{ x: number; y: number; label: string; ts: number }>;
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
  const watchStartRef = useRef(Date.now());
  const { data: screenFrameRaw } = useQuery<any>({
    queryKey: ["/api/screen-feed", userId],
    queryFn: () => apiRequest("GET", `/api/screen-feed/${userId}`).then((response) => response.json()),
    refetchInterval: liveConnected ? false : 5000,
  });

  useEffect(() => {
    setLiveConnected(false);
    setLiveFrame(null);

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
          }
        } catch {
          setLiveConnected(false);
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

  const isOnline =
    !!presence &&
    !!presence.userId &&
    !!presence.lastSeen &&
    Date.now() - new Date(presence.lastSeen).getTime() < 3 * 60 * 1000;
  const hasScreen = !!screenFrame?.dataUrl;

  const now = Date.now();
  const recentClicks = clicks.filter((click) => now - click.ts < 4000);

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
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const imgRef = useRef<HTMLImageElement>(null);

  const openNativeFullscreen = () => {
    if (imgRef.current?.requestFullscreen) {
      void imgRef.current.requestFullscreen();
    }
  };

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
              · {presence.companyName || "no company"} · {presence.role || "—"}· last seen {timeAgo(presence.lastSeen)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {screenFrame?.capturedAt && (
              <span className="text-xs text-muted-foreground">captured {timeAgo(screenFrame.capturedAt)}</span>
            )}
            {hasScreen && (
              <Button size="sm" variant="outline" onClick={openNativeFullscreen} data-testid="button-fullscreen-feed">
                <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
                Full Screen
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-black">
            <div className="flex-1 min-h-0 flex items-center justify-center">
              {hasScreen ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <img
                    ref={imgRef}
                    src={screenFrame.dataUrl}
                    alt="Live screen of user"
                    className="max-w-full max-h-full object-contain block"
                    data-testid="img-screen-feed"
                    style={{ imageRendering: "crisp-edges" }}
                  />
                  {recentClicks.map((click, index) => {
                    const ageSec = (now - click.ts) / 1000;
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
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Clock className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Waiting for first frame…</p>
                  <p className="text-xs">Live delivery starts as soon as the browser responds.</p>
                  {Date.now() - watchStartRef.current > 20000 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center max-w-xs">
                      Still waiting — the fallback viewer will keep retrying automatically.
                    </p>
                  )}
                </div>
              )}
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
