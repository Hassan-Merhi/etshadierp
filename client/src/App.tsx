import "@/styles/rtl-hardening.css";
import { useEffect, useRef } from "react";
import { Redirect, Switch, Route } from "wouter";
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
import { ApplicationLanguageProvider } from "@/contexts/ApplicationLanguageContext";
import { GlobalLanguageSwitch } from "@/components/GlobalLanguageSwitch";
import { DateJumpDialog } from "@/components/DateJumpDialog";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { UserNotesPanel } from "@/components/UserNotesPanel";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useServerRestart } from "@/hooks/use-server-restart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import Login from "@/pages/Login";
import { AuthenticatedApp } from "@/app/AuthenticatedApp";
import { AppLoadingState } from "@/app/AppLoadingState";
import { useAuthenticatedUser } from "@/app/useAuthenticatedUser";

function UpdateBanner() {
  const { toast } = useToast();
  const notifiedRef = useRef(false);
  const initialVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    async function checkVersion() {
      try {
        const res = await fetch("/api/build-info", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        const ver: string = data.version ?? "";
        if (!ver || ver === "dev") return;

        if (initialVersionRef.current === null) {
          initialVersionRef.current = ver;
          return;
        }

        if (ver !== initialVersionRef.current && !notifiedRef.current) {
          notifiedRef.current = true;
          toast({
            title: "Update available",
            description: "A new version of the app is ready.",
            duration: 0,
            action: (
              <Button
                size="sm"
                variant="outline"
                data-testid="button-update-refresh"
                onClick={() => {
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

    void checkVersion();
    const id = setInterval(checkVersion, 5 * 60 * 1000);
    window.addEventListener("erp:service-worker-updated", handleServiceWorkerUpdate);
    return () => {
      clearInterval(id);
      window.removeEventListener("erp:service-worker-updated", handleServiceWorkerUpdate);
    };
  }, [toast]);

  return null;
}

function AuthenticatedUserNotesPanel() {
  const { prefs } = useUserPreferences();
  if (prefs && prefs.showNotesPanel === false) return null;
  return <UserNotesPanel />;
}

function AuthenticatedChatWidget() {
  const { prefs } = useUserPreferences();
  if (prefs && prefs.showChatWidget === false) return null;
  return <ChatWidget />;
}

function ServerRestartWatcher() {
  useServerRestart();
  return null;
}

function AuthenticatedRoot() {
  const { user, isLoading, error, loadingTimedOut, handleLogout } = useAuthenticatedUser();

  if (loadingTimedOut || (!isLoading && (error || !user))) return <Redirect to="/login" />;
  if (isLoading || !user) return <AppLoadingState />;

  return (
    <ApplicationLanguageProvider>
      <CompanyProvider>
        <LocationProvider>
          <DateFormatProvider>
            <CurrencyProvider>
              <CursorNavProvider>
                <ServerRestartWatcher />
                <GlobalLanguageSwitch />
                <AuthenticatedApp user={user} handleLogout={handleLogout} />
                <AuthenticatedChatWidget />
                <DateJumpDialog />
                <AuthenticatedUserNotesPanel />
                <KeyboardShortcuts />
              </CursorNavProvider>
            </CurrencyProvider>
          </DateFormatProvider>
        </LocationProvider>
      </CompanyProvider>
    </ApplicationLanguageProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <ConnectivityProvider>
            <Switch>
              <Route path="/login" component={Login} />
              <Route>
                <AuthenticatedRoot />
              </Route>
            </Switch>
            <Toaster />
            <UpdateBanner />
          </ConnectivityProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
