import { Suspense, useEffect } from "react";
import { lazyRetry as lazy } from "@/lib/lazyRetry";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { useMobilePerformanceLifecycle } from "@/hooks/use-mobile-performance-lifecycle";
import { useLocation, Redirect } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { useWsInvalidation } from "@/hooks/use-ws-invalidation";
import { LanguageOnboardingDialog } from "@/components/LanguageOnboardingDialog";
import type { AuthenticatedUser } from "@/contracts/sessionContracts";
import { useAppNavigation } from "./useAppNavigation";
import { useAuthenticatedAppData } from "./useAuthenticatedAppData";
import { resolveAuthenticatedAppRoute } from "./authenticatedAppRouteGuard";
import { AppLeaveConfirmDialog } from "./AppLeaveConfirmDialog";
import { AppLoadingState } from "./AppLoadingState";

const PosShell = lazy(() => import("./PosShell").then((module) => ({ default: module.PosShell })));
const PropertiesShell = lazy(() => import("./PropertiesShell").then((module) => ({ default: module.PropertiesShell })));
const FactoryShell = lazy(() => import("./FactoryShell").then((module) => ({ default: module.FactoryShell })));
const ErpShell = lazy(() => import("./ErpShell").then((module) => ({ default: module.ErpShell })));
const RemoteSupportIndicator = lazy(() =>
  import("@/components/RemoteSupportIndicator").then((module) => ({ default: module.RemoteSupportIndicator }))
);

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

  // Company bootstrap must resolve before any route decision. A still-loading
  // bootstrap shows a spinner; a confirmed, terminal bootstrap failure shows a
  // recoverable error with a retry action instead of loading forever. A valid
  // selected company always falls through and mounts the workspace.
  if (companyLoading) return <AppLoadingState />;
  if (companyError || !selectedCompany) {
    return <AppLoadingState forceRecovery onRecover={() => void retryCompanyBootstrap()} />;
  }

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
  if (routeState.decision.kind === "redirect") return <Redirect replace to={routeState.decision.to} />;

  const leaveConfirmDialog = (
    <AppLeaveConfirmDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm} onConfirm={handleConfirmLeave} />
  );
  const languageOnboarding = user.id === undefined ? null : <LanguageOnboardingDialog userId={user.id} />;
  const appOverlays = (
    <>
      {languageOnboarding}
      <Suspense fallback={null}>
        <RemoteSupportIndicator />
      </Suspense>
    </>
  );

  if (isPOS) {
    return (
      <>
        <Suspense fallback={<AppLoadingState />}>
          <PosShell
            user={user}
            posImportEnabled={posImportEnabled}
            chatUnread={chatUnread}
            handleGoBack={handleGoBack}
            handleLogout={handleLogout}
            leaveConfirmDialog={leaveConfirmDialog}
          />
        </Suspense>
        {appOverlays}
      </>
    );
  }

  if (routeState.isPropertiesCompany && routeState.isPropertiesRoute) {
    return (
      <>
        <Suspense fallback={<AppLoadingState />}>
          <PropertiesShell
            user={user}
            currentLocation={currentLocation}
            handleLogout={handleLogout}
            leaveConfirmDialog={leaveConfirmDialog}
          />
        </Suspense>
        {appOverlays}
      </>
    );
  }

  if (routeState.isFactoryRoute || routeState.isFactoryCompany) {
    // The Factory access and settings contracts gate the Factory workspace
    // ONLY. Non-Factory companies (ERP, POS, Properties, Supplier Partner) never
    // wait on or fail because of /api/factory/*, so a failure of those Factory
    // endpoints can never blank or block a non-Factory startup.
    if (myAccessLoading || factorySettingsLoading) return <AppLoadingState />;
    if (myAccessError) {
      return <AppLoadingState forceRecovery onRecover={() => void retryMyAccess()} />;
    }
    if (factorySettingsError) {
      return <AppLoadingState forceRecovery onRecover={() => void retryFactorySettings()} />;
    }
    return (
      <>
        <Suspense fallback={<AppLoadingState />}>
          <FactoryShell
            user={user}
            myAccess={myAccess}
            factoryDefaultPage={routeState.factoryDefaultPage}
            handleLogout={handleLogout}
            leaveConfirmDialog={leaveConfirmDialog}
          />
        </Suspense>
        {appOverlays}
      </>
    );
  }

  return (
    <>
      <Suspense fallback={<AppLoadingState />}>
        <ErpShell
          user={user}
          hasErpAccess={routeState.hasErpAccess}
          handleLogout={handleLogout}
          leaveConfirmDialog={leaveConfirmDialog}
        />
      </Suspense>
      {appOverlays}
    </>
  );
}
