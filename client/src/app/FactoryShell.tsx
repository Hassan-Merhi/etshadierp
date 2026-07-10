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
import { Factory } from "lucide-react";
import type { MyAccess } from "./factoryAccessGuard";

interface FactoryShellProps {
  user: any;
  myAccess: MyAccess | undefined;
  factoryDefaultPage: string;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

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

  return (
    <AppModeProvider mode="factory">
      <SidebarProvider style={style as React.CSSProperties}>
        <div ref={factoryContainerRef} className="flex h-full w-full">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <FactorySidebar user={user} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <AppTopBar
              accentColor="#f97316"
              user={user}
              onLogout={handleLogout}
              onSearchOpen={() => setPaletteOpen(true)}
              showSearch={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
              leftContent={
                <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-orange-600/10 border border-orange-600/20">
                  <Factory className="h-4 w-4 text-orange-600" />
                  <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Factory Mode</span>
                  {myAccess?.companyName && (
                    <span className="hidden sm:inline text-xs text-orange-600/70 font-normal normal-case tracking-normal border-l border-orange-600/20 pl-2">
                      {myAccess.companyName}
                    </span>
                  )}
                </div>
              }
              extraActions={<KeyboardShortcutsButton />}
            />
            <OfflineBanner />
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="w-full">
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                        Loading...
                      </div>
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
        isAdminOwner={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}
