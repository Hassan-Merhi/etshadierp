import { useState, Suspense } from "react";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DailyRateModal } from "@/components/DailyRateModal";
import { AppSidebar } from "@/components/AppSidebar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { LoadingState } from "@/components/ui/page-state";
import { Router } from "@/routes/AppRoutes";
import { canUseAdminSearch, type ShellUser } from "./shellUser";

interface ErpShellProps {
  user: ShellUser;
  hasErpAccess: boolean;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

export function ErpShell({ user, hasErpAccess, handleLogout, leaveConfirmDialog }: ErpShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [currentLocation] = useLocation();
  const { selectedCompany } = useCompany();
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };
  const hasAdminSearch = canUseAdminSearch(user);

  return (
    <AppModeProvider mode="erp">
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-full w-full min-w-0 overflow-hidden">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <AppSidebar user={user} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <OfflineBanner />
            <main
              id="main-content"
              tabIndex={-1}
              aria-label="ERP workspace"
              className="flex-1 overflow-y-auto overscroll-y-contain p-3 outline-none sm:p-6"
            >
              <div className="w-full min-w-0 max-w-full [&_form]:min-w-0 [&_table]:w-full [&_[role=table]]:w-full [&_.overflow-x-auto]:overscroll-x-contain">
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense
                    fallback={
                      <LoadingState
                        title="Loading workspace"
                        description="Preparing the latest ERP information."
                      />
                    }
                  >
                    <Router user={user} />
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
        hasErpAccess={hasErpAccess}
        hasFactoryAccess={false}
        isAdminOwner={hasAdminSearch}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}
