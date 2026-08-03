import { useEffect, useState } from "react";
import { ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRemoteControlSession } from "@/hooks/use-remote-control-session";

function formatRemaining(expiresAt: string, now: number): string {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RemoteSupportIndicator() {
  const { session, stopping, stop } = useRemoteControlSession();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  if (!session) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex max-w-[min(92vw,360px)] items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
      data-screenfeed-ignore="true"
      data-testid="remote-support-active-indicator"
    >
      <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">Admin support active</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {session.controllerUsername} · ERP tab only · {formatRemaining(session.expiresAt, now)}
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
  );
}
