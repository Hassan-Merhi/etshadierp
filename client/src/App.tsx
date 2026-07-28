import { useEffect, useRef } from "react";
import { useLocation, Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatWidget } from "@/components/ChatWidget";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ConnectivityProvider } from "@/contexts/ConnectivityContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { DateFormatProvider } from "@/contexts/DateFormatContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { CursorNavProvider } from "@/contexts/CursorNavContext";
import { DateJumpDialog } from "@/components/DateJumpDialog";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { UserNotesPanel } from "@/components/UserNotesPanel";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useServerRestart } from "@/hooks/use-server-restart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import Login from "@/pages/Login";
import { AuthenticatedApp } from "@/app/AuthenticatedApp";

// ── Production-only update banner ─────────────────────────────────────────────
// Polls /api/build-info every 5 minutes. When the build version changes it shows a
// small non-blocking toast with a manual "Refresh" button. It NEVER auto-refreshes.
// A service-worker update triggers the same version check immediately without
// forcing every open tab to download the full application again.
function UpdateBanner() {
  const { toast } = useToast();
  const notifiedRef = useRef(false);
  const initialVersionRef = useRef<string | null>(null);

  useEffect(() => {
    // Only run in production — dev restarts are handled by Vite HMR
    if (import.meta.env.DEV) return;

    async function checkVersion() {
      try {
        const res = await fetch("/api/build-info", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        const ver: string = data.version ?? "";
        if (!ver || ver === "dev") return;

        if (initialVersionRef.current === null) {
          // Store the version that was live when the app first loaded
          initialVersionRef.current = ver;
          return;
        }

        if (ver !== initialVersionRef.current && !notifiedRef.current) {
          notifiedRef.current = true;
          toast({
            title: "Update available",
            description: "A new version of the app is ready.",
            duration: 0, // stay until dismissed
            action: (
              <Button
                size="sm"
                variant="outline"
                data-testid="button-update-refresh"
                onClick={() => {
                  // Clear both current and legacy recovery guards before a
                  // user-requested refresh so the new build starts cleanly.
                  try {
                    const prefixes = ["assetRecovery:", "swReload:", "chunkReload:", "chunkRetry:"];
                    Object.keys(sessionStorage)
                      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
                      .forEach((key) => sessionStorage.removeItem(key));
                  } catch {
                    /* ignore */
                  }
                  window.location.reload();
                }}
              >
                Refresh
              </Button>
            ) as any,
          });
        }
      } catch {
        /* network error — ignore, will retry next interval */
      }
    }

    const handleServiceWorkerUpdate = () => {
      void checkVersion();
    };

    void checkVersion(); // initial check
    const id = setInterval(checkVersion, 5 * 60 * 1000); // every 5 minutes
    window.addEventListener("erp:service-worker-updated", handleServiceWorkerUpdate);
    return () => {
      clearInterval(id);
      window.removeEventListener("erp:service-worker-updated", handleServiceWorkerUpdate);
    };
  }, [toast]);

  return null;
}

function AuthGatedUserNotesPanel() {
  const [location] = useLocation();
  const { prefs } = useUserPreferences();
  if (location === "/login") return null;
  if (prefs && prefs.showNotesPanel === false) return null;
  return <UserNotesPanel />;
}

function AuthGatedChatWidget() {
  const [location] = useLocation();
  const { prefs } = useUserPreferences();
  if (location === "/login") return null;
  if (prefs && prefs.showChatWidget === false) return null;
  return <ChatWidget />;
}

function ServerRestartWatcher() {
  useServerRestart();
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <ConnectivityProvider>
            <CompanyProvider>
              <LocationProvider>
                <DateFormatProvider>
                  <CurrencyProvider>
                    <CursorNavProvider>
                      <ServerRestartWatcher />
                      <Switch>
                        <Route path="/login" component={Login} />
                        <Route>
                          <AuthenticatedApp />
                        </Route>
                      </Switch>
                      <Toaster />
                      <UpdateBanner />
                      <AuthGatedChatWidget />
                      <DateJumpDialog />
                      <AuthGatedUserNotesPanel />
                      <KeyboardShortcuts />
                    </CursorNavProvider>
                  </CurrencyProvider>
                </DateFormatProvider>
              </LocationProvider>
            </CompanyProvider>
          </ConnectivityProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
