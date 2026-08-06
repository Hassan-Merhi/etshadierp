import { Suspense, type ReactNode } from "react";
import { lazyRetry as lazy } from "@/lib/lazyRetry";
import { LanguageOnboardingDialog } from "@/components/LanguageOnboardingDialog";
import type { AuthenticatedUser } from "@/contracts/sessionContracts";
import type { FactoryAccess } from "./useAuthenticatedAppData";
import type { resolveAuthenticatedAppRoute } from "./authenticatedAppRouteGuard";
import { AppLoadingState } from "./AppLoadingState";

const PosShell = lazy(() => import("./PosShell").then((module) => ({ default: module.PosShell })));
const PropertiesShell = lazy(() => import("./PropertiesShell").then((module) => ({ default: module.PropertiesShell })));
const FactoryShell = lazy(() => import("./FactoryShell").then((module) => ({ default: module.FactoryShell })));
const ErpShell = lazy(() => import("./ErpShell").then((module) => ({ default: module.ErpShell })));
const RemoteSupportIndicator = lazy(() =>
  import("@/components/RemoteSupportIndicator").then((module) => ({ default: module.RemoteSupportIndicator }))
);

type RouteState = ReturnType<typeof resolveAuthenticatedAppRoute>;

interface AuthenticatedWorkspaceProps {
  user: AuthenticatedUser;
  isPOS: boolean;
  currentLocation: string;
  routeState: RouteState;
  myAccess?: FactoryAccess;
  posImportEnabled: boolean;
  chatUnread: { count: number } | undefined;
  handleGoBack: () => void;
  handleLogout: () => Promise<void>;
  leaveConfirmDialog: ReactNode;
}

export function AuthenticatedWorkspace({
  user,
  isPOS,
  currentLocation,
  routeState,
  myAccess,
  posImportEnabled,
  chatUnread,
  handleGoBack,
  handleLogout,
  leaveConfirmDialog,
}: AuthenticatedWorkspaceProps) {
  const overlays = (
    <>
      {user.id === undefined ? null : <LanguageOnboardingDialog userId={user.id} />}
      <Suspense fallback={null}>
        <RemoteSupportIndicator />
      </Suspense>
    </>
  );

  let workspace: ReactNode;
  if (isPOS) {
    workspace = (
      <PosShell
        user={user}
        posImportEnabled={posImportEnabled}
        chatUnread={chatUnread}
        handleGoBack={handleGoBack}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  } else if (routeState.isPropertiesCompany && routeState.isPropertiesRoute) {
    workspace = (
      <PropertiesShell
        user={user}
        currentLocation={currentLocation}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  } else if (routeState.isFactoryRoute || routeState.isFactoryCompany) {
    workspace = (
      <FactoryShell
        user={user}
        myAccess={myAccess}
        factoryDefaultPage={routeState.factoryDefaultPage}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  } else {
    workspace = (
      <ErpShell
        user={user}
        hasErpAccess={routeState.hasErpAccess}
        handleLogout={handleLogout}
        leaveConfirmDialog={leaveConfirmDialog}
      />
    );
  }

  return (
    <>
      <Suspense fallback={<AppLoadingState />}>{workspace}</Suspense>
      {overlays}
    </>
  );
}
