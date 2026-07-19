import { useState, useRef, Suspense } from "react";
import { useLocation } from "wouter";
import { useButtonClickFeedback } from "@/hooks/use-button-click-feedback";
import { useCompany } from "@/contexts/CompanyContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DailyRateModal } from "@/components/DailyRateModal";
import { FactorySidebar } from "@/components/FactorySidebar";
import { FactoryRoutes } from "@/components/FactoryRoutes";
import { AppTopBar } from "@/components/AppTopBar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsButton } from "@/components/KeyboardShortcuts";
import { ModuleIdentity } from "@/components/navigation/module-identity";
import { LoadingState } from "@/components/ui/page-state";
import { Factory } from "lucide-react";
import type { MyAccess } from "./factoryAccessGuard";
import { canUseAdminSearch, type ShellUser } from "./shellUser";

interface FactoryShellProps {
  user: ShellUser;
  myAccess: MyAccess | undefined;
  factoryDefaultPage: string;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

const factoryPosWorkspaceClasses = [
  "[&_button]:touch-manipulation",
  "[&_input]:min-h-10",
  "[&_select]:min-h-10",
  "[&_textarea]:min-h-20",
  "[&_table]:min-w-max",
  "[&_th]:whitespace-nowrap",
  "[&_td]:align-middle",
  "[&_[role=listbox]]:max-h-[min(24rem,70dvh)]",
].join(" ");

export function FactoryShell({
  user,
  myAccess,
  factoryDefaultPage,
  handleLogout,
  leaveConfirmDialog,
}: FactoryShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [currentLocation] = useLocation();
  const { selectedCompany } = useCompany();
  const factoryContainerRef = useRef<HTMLDivElement>(null);
  useButtonClickFeedback(factoryContainerRef);

  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };
  const isFactoryPosRoute = currentLocation === "/factory/pos" || currentLocation.startsWith("/factory/pos?");
  const hasAdminSearch = canUseAdminSearch(user);

  return (
    <AppModeProvider mode="factory">
      <SidebarProvider style={style as React.CSSProperties}>
        <div ref={factoryContainerRef} className="flex h-full w-full min-w-0 overflow-hidden">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <FactorySidebar user={user} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AppTopBar
              accentColor="hsl(var(--module-factory))"
              user={user}
              onLogout={handleLogout}
              onSearchOpen={() => setPaletteOpen(true)}
              showSearch={hasAdminSearch}
              leftContent={
                <ModuleIdentity
                  compact
                  moduleName="Factory"
                  description="Production, raw materials, inventory, and costing"
                  companyName={myAccess?.companyName || selectedCompany?.name}
                  icon={Factory}
                  tone="factory"
                  className="hidden max-w-md border-0 bg-transparent p-0 shadow-none sm:block"
                />
              }
              extraActions={<KeyboardShortcutsButton />}
            />
            <OfflineBanner />
            <main
              id="main-content"
              tabIndex={-1}
              aria-label={isFactoryPosRoute ? "Factory point of sale workspace" : "Factory and inventory workspace"}
              data-pos-workspace={isFactoryPosRoute ? "true" : undefined}
              className={`flex-1 overflow-y-auto overscroll-y-contain p-3 outline-none sm:p-6 ${
                isFactoryPosRoute ? factoryPosWorkspaceClasses : ""
              }`}
            >
              <div className="w-full min-w-0 max-w-full [&_form]:min-w-0 [&_table]:w-full [&_[role=table]]:w-full [&_.overflow-x-auto]:overscroll-x-contain">
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense
                    fallback={
                      <LoadingState
                        title={isFactoryPosRoute ? "Loading factory point of sale" : "Loading factory workspace"}
                        description={
                          isFactoryPosRoute
                            ? "Preparing the latest sale-entry workspace."
                            : "Preparing the latest factory and inventory information."
                        }
                      />
                    }
                  >
                    <FactoryRoutes
                      user={user}
                      myAccess={myAccess}
                      factoryDefaultPage={factoryDefaultPage}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hasErpAccess={false}
        hasFactoryAccess={true}
        isAdminOwner={hasAdminSearch}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}
