import { useEffect, useRef } from "react";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { useLocation, Redirect } from "wouter";
import { setAppTimezone } from "@/lib/queryClient";
import { companyQueryKey } from "@/lib/companyQueryScope";
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

const SUPPLIER_PARTNER_PATHS = new Set([
  "/sp",
  "/sp/reports",
  "/sp/opening-stock",
  "/sp/aliases",
  "/sp/setup",
  "/sp/migration",
  "/sp/gc-migration",
]);

export function AuthenticatedApp() {
  const { selectedCompany, isLoading: companyLoading } = useCompany();
  usePresence();
  useScreenFeed();
  useWsInvalidation();
  useDialogScrollFix();

  const [currentLocation] = useLocation();
  const { user, isLoading, error, loadingTimedOut, handleLogout } = useAuthenticatedUser();
  const { showLeaveConfirm, setShowLeaveConfirm, handleGoBack, handleConfirmLeave } = useAppNavigation();

  useEffect(() => {
    const main = document.getElementById("main-content");
    if (main) {
      main.scrollTop = 0;
      main.focus({ preventScroll: true });
    }
  }, [currentLocation]);

  const isPOS = user?.role === "POS";
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/chat/unread-count", selectedCompany?.id),
    refetchInterval: 60000,
    enabled: isPOS && !!user && !!selectedCompany,
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
    queryKey: companyQueryKey("/api/company-settings", selectedCompany?.id),
    enabled: !!user && !!selectedCompany,
  });
  const posImportEnabled = posCompanySettings?.posExcelImportEnabled === true;

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
    queryKey: companyQueryKey("/api/factory/my-access", selectedCompany?.id),
    enabled: !!user && !isPOS && !!selectedCompany,
    staleTime: 30000,
    retry: 2,
  });

  const { data: factorySettings } = useQuery<Record<string, any>>({
    queryKey: companyQueryKey("/api/factory/settings", selectedCompany?.id),
    queryFn: async () => {
      const r = await fetch("/api/factory/settings");
      return r.ok ? r.json() : {};
    },
    enabled: !!user && !isPOS && !!selectedCompany,
    staleTime: 60000,
  });

  const hasErpAccess = !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = !myAccess || myAccess.hasFactoryAccess;
  const isAdminOwner = user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer";

  if (loadingTimedOut || (!isLoading && (error || !user))) return <Redirect to="/login" />;
  if (isLoading || companyLoading || !selectedCompany) return <AppLoadingState />;

  const isPropertiesCompany = selectedCompany.companyType === "properties";
  const isPropertiesRoute = currentLocation.startsWith("/properties/");
  const isSupplierPartnerCompany = selectedCompany.companyType === "supplier_partner";
  const isSupplierPartnerRoute = currentLocation === "/sp" || currentLocation.startsWith("/sp/");
  const isFactoryCompany = selectedCompany.companyType === "factory" || selectedCompany.companyType === "factory_v2";
  const isFactoryRoute = currentLocation.startsWith("/factory/");
  const factoryDefaultPage = computeFactoryDefaultPage(myAccess);

  if (isPropertiesCompany && currentLocation === "/my-settings") {
    return <Redirect replace to="/properties/my-settings" />;
  }
  if (isPropertiesCompany && currentLocation === "/balance-repair") {
    return <Redirect replace to="/properties/balance-repair" />;
  }
  if (isPropertiesCompany && !isPropertiesRoute) {
    return <Redirect replace to="/properties/daybook" />;
  }

  if (isSupplierPartnerRoute && !isSupplierPartnerCompany) {
    return <Redirect replace to="/tracking" />;
  }
  if (
    isSupplierPartnerCompany &&
    (currentLocation === "/sp/migration" || currentLocation === "/sp/gc-migration")
  ) {
    return <Redirect replace to="/sp/setup?tab=migration" />;
  }
  if (isSupplierPartnerCompany && isSupplierPartnerRoute && !SUPPLIER_PARTNER_PATHS.has(currentLocation)) {
    return <Redirect replace to="/sp" />;
  }

  if (
    isFactoryCompany &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    if (myAccessLoading) return <AppLoadingState />;
    if (myAccess === undefined && !myAccessError) return null;
    return <Redirect replace to={factoryDefaultPage} />;
  }

  if (isFactoryRoute && !hasFactoryAccess) return <Redirect replace to="/" />;

  if (
    !isFactoryCompany &&
    !hasErpAccess &&
    hasFactoryAccess &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    return <Redirect replace to={factoryDefaultPage} />;
  }

  const factoryGuardRedirect = computeFactoryGuardRedirect({
    isFactoryRoute,
    isAdminOwner,
    myAccess,
    factorySettings,
    factoryDefaultPage,
    currentLocation,
  });
  if (factoryGuardRedirect) return <Redirect replace to={factoryGuardRedirect} />;

  if (isFactoryRoute && !isFactoryCompany && !myAccessLoading && hasErpAccess) {
    return <Redirect replace to="/" />;
  }

  const leaveConfirmDialog = (
    <AppLeaveConfirmDialog
      open={showLeaveConfirm}
      onOpenChange={setShowLeaveConfirm}
      onConfirm={handleConfirmLeave}
    />
  );

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

  if (isPropertiesCompany && isPropertiesRoute) {
    return (
      <PropertiesShell
        user={user}
        currentLocation={currentLocation}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

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

  return (
    <ErpShell
      user={user}
      hasErpAccess={hasErpAccess}
      handleLogout={handleLogout}
      leaveConfirmDialog={leaveConfirmDialog}
    />
  );
}
