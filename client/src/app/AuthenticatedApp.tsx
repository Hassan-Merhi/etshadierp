import { useEffect } from "react";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { useMobilePerformanceLifecycle } from "@/hooks/use-mobile-performance-lifecycle";
import { useLocation, Redirect } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { useWsInvalidation } from "@/hooks/use-ws-invalidation";
import type { AuthenticatedUser } from "@/contracts/sessionContracts";
import { useAppNavigation } from "./useAppNavigation";
import { useAuthenticatedAppData } from "./useAuthenticatedAppData";
import { resolveAuthenticatedAppRoute } from "./authenticatedAppRouteGuard";
import { AppLeaveConfirmDialog } from "./AppLeaveConfirmDialog";
import { AppLoadingState } from "./AppLoadingState";
import { AuthenticatedWorkspace } from "./AuthenticatedWorkspace";

interface AuthenticatedAppProps {
  user: AuthenticatedUser;
  handleLogout: () => Promise<void>;
}

export function AuthenticatedApp({ user, handleLogout }: AuthenticatedAppProps) {
  const {
    selectedCompany,
    isLoading: companyLoading,
    error: companyError,
    retry: retryCompanyBootstrap,
  } = useCompany();
  useMobilePerformanceLifecycle();
  usePresence(true);
  useScreenFeed();
  useWsInvalidation();
  useDialogScrollFix();

  const [currentLocation] = useLocation();
  const { showLeaveConfirm, setShowLeaveConfirm, handleGoBack, handleConfirmLeave } = useAppNavigation();
  const isPOS = user.role === "POS";

  useEffect(() => {
    const main = document.getElementById("main-content");
    if (main) {
      main.scrollTop = 0;
      main.focus({ preventScroll: true });
    }
  }, [currentLocation]);

  const {
    chatUnread,
    posImportEnabled,
    myAccess,
    myAccessLoading,
    myAccessError,
    retryMyAccess,
    factorySettings,
    factorySettingsLoading,
    factorySettingsError,
    retryFactorySettings,
  } = useAuthenticatedAppData({ selectedCompanyId: selectedCompany?.id, userPresent: true, isPOS });

  if (companyLoading) return <AppLoadingState />;
  if (companyError || !selectedCompany) {
    return <AppLoadingState forceRecovery onRecover={() => void retryCompanyBootstrap()} />;
  }

  const usesAccessContract =
    !isPOS && selectedCompany.companyType !== "properties" && selectedCompany.companyType !== "supplier_partner";
  if (usesAccessContract && myAccessLoading) return <AppLoadingState />;
  if (usesAccessContract && (myAccessError || !myAccess)) {
    return <AppLoadingState forceRecovery onRecover={() => void retryMyAccess()} />;
  }

  const isFactoryContext =
    selectedCompany.companyType === "factory" ||
    selectedCompany.companyType === "factory_v2" ||
    currentLocation.startsWith("/factory/");
  if (isFactoryContext && factorySettingsLoading) return <AppLoadingState />;
  if (isFactoryContext && factorySettingsError) {
    return <AppLoadingState forceRecovery onRecover={() => void retryFactorySettings()} />;
  }

  const routeState = resolveAuthenticatedAppRoute({
    currentLocation,
    companyType: selectedCompany.companyType,
    isAdminOwner: user.role === "Admin" || user.role === "Owner" || user.role === "Developer",
    myAccess,
    myAccessLoading,
    myAccessError,
    factorySettings,
  });

  if (routeState.decision.kind === "loading") return <AppLoadingState />;
  if (routeState.decision.kind === "recovery") {
    return <AppLoadingState forceRecovery onRecover={() => void retryMyAccess()} />;
  }
  if (routeState.decision.kind === "redirect") return <Redirect replace to={routeState.decision.to} />;

  const leaveConfirmDialog = (
    <AppLeaveConfirmDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm} onConfirm={handleConfirmLeave} />
  );

  return (
    <AuthenticatedWorkspace
      user={user}
      isPOS={isPOS}
      currentLocation={currentLocation}
      routeState={routeState}
      myAccess={myAccess}
      posImportEnabled={posImportEnabled}
      chatUnread={chatUnread}
      handleGoBack={handleGoBack}
      handleLogout={handleLogout}
      leaveConfirmDialog={leaveConfirmDialog}
    />
  );
}
