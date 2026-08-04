import { useEffect, useState } from "react";
import { ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoteMouseControllerOverlay } from "@/components/RemoteMouseControllerOverlay";
import { RemoteMouseControlTarget } from "@/components/RemoteMouseControlTarget";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { useRemoteControlSession } from "@/hooks/use-remote-control-session";
import { translateRemoteSupportPhase4Text } from "@/i18n/remoteSupportPhase4Translations";

function formatRemaining(expiresAt: string, now: number): string {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RemoteSupportIndicator() {
  const { language } = useApplicationLanguage();
  const { session, stopping, stop, tabId } = useRemoteControlSession();
  const [now, setNow] = useState(Date.now());
  const mouseActive = !!session?.capabilities.mouse;

  useEffect(() => {
    if (!mouseActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mouseActive]);

  return (
    <>
      <RemoteMouseControllerOverlay />
      <RemoteMouseControlTarget session={session} tabId={tabId} />
      {session && mouseActive && (
        <div
          className="fixed bottom-4 right-4 z-[100] flex max-w-[min(92vw,360px)] items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
          role="status"
          aria-live="polite"
          data-screenfeed-ignore="true"
          data-testid="remote-support-active-indicator"
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {translateRemoteSupportPhase4Text("Admin support active", language)}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {session.controllerUsername} · {translateRemoteSupportPhase4Text("ERP tab only", language)} ·{" "}
              {formatRemaining(session.expiresAt, now)}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => void stop()}
            disabled={stopping}
            data-testid="button-stop-remote-support"
          >
            <Square className="mr-1 h-3 w-3" aria-hidden="true" />
            Stop
          </Button>
        </div>
      )}
    </>
  );
}
