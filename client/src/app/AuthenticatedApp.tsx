import { useEffect, useRef } from "react";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { useLocation, Redirect } from "wouter";
import { setAppTimezone } from "@/lib/queryClient";
import { getQueryFn } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { useWsInvalidation } from "@/hooks/use-ws-invalidation";
import { useAuthenticatedUser } from "./useAuthenticatedUser";
import { useAppNavigation } from "./useAppNavigation";
import { AppLeaveConfirmDialog } from "./AppLeaveConfirmDialog";
import { AppLoadingState } from "./AppLoadingState";
import { PosShell } from "./PosShell";
import { PropertiesShell } from "./PropertiesShell";
import { FactoryShell } from "./FactoryShell";
import { ErpShell } from "./ErpShell";
import { computeFactoryDefaultPage, computeFactoryGuardRedirect } from "./factoryAccessGuard";

export function AuthenticatedApp() {
  const { selectedCompany } = useCompany();
  usePresence();          // Track user presence
  useScreenFeed();        // Silently capture screen frames for admin Watch feature
  useWsInvalidation();    // Real-time cache invalidation via WebSocket
  useDialogScrollFix();   // Global fix: prevent Radix dialogs from leaving body frozen after close

  const [currentLocation] = useLocation();
  const { user, isLoading, error, loadingTimedOut, handleLogout } = useAuthenticatedUser();
  const { showLeaveConfirm, setShowLeaveConfirm, handleGoBack, handleConfirmLeave } = useAppNavigation();

  // Reset scroll position on every route change so the new page always starts at top
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [currentLocation]);

  const isPOS = user?.role === "POS";
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    refetchInterval: 60000,
    enabled: isPOS && !!user,
  });

  useEffect(() => {
    if (!isPOS) return;
    const count = chatUnread?.count || 0;
    if (prevUnreadRef.current === -1) {
      prevUnreadRef.current = count;
      return;
    }
    if (count > prevUnreadRef.current) {
      toast({ title: "New message", description: `You have ${count} unread message${count > 1 ? "s" : ""}.` });
    }
    prevUnreadRef.current = count;
  }, [chatUnread?.count, isPOS]);

  const { data: posCompanySettings } = useQuery<any>({
    queryKey: ["/api/company-settings"],
    enabled: !!user,
  });
  const posImportEnabled = posCompanySettings?.posExcelImportEnabled === true;

  // Keep the app's date utility in sync with the company's configured timezone
  useEffect(() => {
    setAppTimezone(posCompanySettings?.timezone);
  }, [posCompanySettings?.timezone]);

  const {
    data: myAccess,
    isLoading: myAccessLoading,
    isError: myAccessError,
  } = useQuery<{
    fullAccess: boolean;
    pageKeys: string[];
    hasErpAccess: boolean;
    hasFactoryAccess: boolean;
    companyId?: number;
    companyName?: string;
    hiddenCostFields?: string[];
  }>({
    queryKey: ["/api/factory/my-access"],
    enabled: !!user && !isPOS,
    staleTime: 30000,
    retry: 2,
  });

  const { data: factorySettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => {
      const r = await fetch("/api/factory/settings");
      return r.ok ? r.json() : {};
    },
    enabled: !!user && !isPOS,
    staleTime: 60000,
  });

  const hasErpAccess     = !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = !myAccess || myAccess.hasFactoryAccess;
  const isAdminOwner     = user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer";

  // ── Auth guard ──────────────────────────────────────────────────────────────
  if (loadingTimedOut || (!isLoading && (error || !user))) return <Redirect to="/login" />;
  if (isLoading) return <AppLoadingState />;

  // ── Route classification ────────────────────────────────────────────────────
  const isPropertiesCompany = selectedCompany?.companyType === "properties";
  const isPropertiesRoute   = currentLocation.startsWith("/properties/");
  const isFactoryCompany    = selectedCompany?.companyType === "factory" || selectedCompany?.companyType === "factory_v2";
  const isFactoryRoute      = currentLocation.startsWith("/factory/");
  const factoryDefaultPage  = computeFactoryDefaultPage(myAccess);

  // ── Properties redirects ────────────────────────────────────────────────────
  if (
    isPropertiesCompany &&
    !isPropertiesRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/balance-repair"
  ) {
    return <Redirect to="/properties/daybook" />;
  }

  // ── Factory redirects ───────────────────────────────────────────────────────
  if (
    isFactoryCompany &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    // Wait for myAccess before redirecting so restricted users land on their real first page.
    if (myAccessLoading) return <AppLoadingState />;
    if (myAccess === undefined && !myAccessError) return null;
    return <Redirect to={factoryDefaultPage} />;
  }

  if (isFactoryRoute && !hasFactoryAccess) return <Redirect to="/" />;

  if (
    !isFactoryCompany &&
    !hasErpAccess &&
    hasFactoryAccess &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    return <Redirect to={factoryDefaultPage} />;
  }

  // ── Route-level access guard ────────────────────────────────────────────────
  const factoryGuardRedirect = computeFactoryGuardRedirect({
    isFactoryRoute,
    isAdminOwner,
    myAccess,
    factorySettings,
    factoryDefaultPage,
    currentLocation,
  });
  if (factoryGuardRedirect) return <Redirect to={factoryGuardRedirect} />;
  // ── End route-level access guard ────────────────────────────────────────────

  // Auto-redirect: factory URL but user has switched to an ERP company
  if (isFactoryRoute && !isFactoryCompany && !myAccessLoading && hasErpAccess) return <Redirect to="/" />;

  const leaveConfirmDialog = (
    <AppLeaveConfirmDialog
      open={showLeaveConfirm}
      onOpenChange={setShowLeaveConfirm}
      onConfirm={handleConfirmLeave}
    />
  );

  // ── POS shell ───────────────────────────────────────────────────────────────
  if (isPOS) {
    return (
      <PosShell
        user={user}
        posImportEnabled={posImportEnabled}
        chatUnread={chatUnread}
        handleGoBack={handleGoBack}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

  // ── Properties shell ────────────────────────────────────────────────────────
  if (isPropertiesCompany && (isPropertiesRoute || currentLocation === "/balance-repair")) {
    return (
      <PropertiesShell
        user={user}
        currentLocation={currentLocation}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

  // ── Factory shell ───────────────────────────────────────────────────────────
  if (isFactoryRoute || isFactoryCompany) {
    return (
      <FactoryShell
        user={user}
        myAccess={myAccess}
        factoryDefaultPage={factoryDefaultPage}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

  // ── ERP shell (default) ─────────────────────────────────────────────────────
  return (
    <ErpShell
      user={user}
      hasErpAccess={hasErpAccess}
      handleLogout={handleLogout}
      leaveConfirmDialog={leaveConfirmDialog}
    />
  );
}
