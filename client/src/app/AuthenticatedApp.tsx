import { useEffect } from "react";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { useLocation, Redirect } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { useWsInvalidation } from "@/hooks/use-ws-invalidation";
import { useAuthenticatedUser } from "./useAuthenticatedUser";
import { useAppNavigation } from "./useAppNavigation";
import { useAuthenticatedAppData } from "./useAuthenticatedAppData";
import { resolveAuthenticatedAppRoute } from "./authenticatedAppRouteGuard";
import { AppLeaveConfirmDialog } from "./AppLeaveConfirmDialog";
import { AppLoadingState } from "./AppLoadingState";
import { PosShell } from "./PosShell";
import { PropertiesShell } from "./PropertiesShell";
import { FactoryShell } from "./FactoryShell";
import { ErpShell } from "./ErpShell";

export function AuthenticatedApp() {
  const { selectedCompany, isLoading: companyLoading } = useCompany();
  usePresence();
  useScreenFeed();
  useWsInvalidation();
  useDialogScrollFix();

  const [currentLocation] = useLocation();
  const { user, isLoading, error, loadingTimedOut, handleLogout } = useAuthenticatedUser();
  const { showLeaveConfirm, setShowLeaveConfirm, handleGoBack, handleConfirmLeave } = useAppNavigation();
  const isPOS = user?.role === "POS";

  useEffect(() => {
    const main = document.getElementById("main-content");
    if (main) {
      main.scrollTop = 0;
      main.focus({ preventScroll: true });
    }
  }, [currentLocation]);

  const { chatUnread, posImportEnabled, myAccess, myAccessLoading, myAccessError, factorySettings } =
    useAuthenticatedAppData({
      selectedCompanyId: selectedCompany?.id,
      userPresent: !!user,
      isPOS,
    });

  if (loadingTimedOut || (!isLoading && (error || !user))) return <Redirect to="/login" />;
  if (isLoading || companyLoading || !selectedCompany || !user) return <AppLoadingState />;

  const isAdminOwner = user.role === "Admin" || user.role === "Owner" || user.role === "Developer";
  const routeState = resolveAuthenticatedAppRoute({
    currentLocation,
    companyType: selectedCompany.companyType,
    isAdminOwner,
    myAccess,
    myAccessLoading,
    myAccessError,
    factorySettings,
  });

  if (routeState.decision.kind === "loading") return <AppLoadingState />;
  if (routeState.decision.kind === "empty") return null;
  if (routeState.decision.kind === "redirect") {
    return <Redirect replace to={routeState.decision.to} />;
  }

  const leaveConfirmDialog = (
    <AppLeaveConfirmDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm} onConfirm={handleConfirmLeave} />
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

  if (routeState.isPropertiesCompany && routeState.isPropertiesRoute) {
    return (
      <PropertiesShell
        user={user}
        currentLocation={currentLocation}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

  if (routeState.isFactoryRoute || routeState.isFactoryCompany) {
    return (
      <FactoryShell
        user={user}
        myAccess={myAccess}
        factoryDefaultPage={routeState.factoryDefaultPage}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

  return (
    <ErpShell
      user={user}
      hasErpAccess={routeState.hasErpAccess}
      handleLogout={handleLogout}
      leaveConfirmDialog={leaveConfirmDialog}
    />
  );
}
