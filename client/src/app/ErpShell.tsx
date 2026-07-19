import { useState, Suspense } from "react";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DailyRateModal } from "@/components/DailyRateModal";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopBar } from "@/components/AppTopBar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsButton } from "@/components/KeyboardShortcuts";
import { ModuleIdentity } from "@/components/navigation/module-identity";
import { LoadingState } from "@/components/ui/page-state";
import { Router } from "@/routes/AppRoutes";
import { BriefcaseBusiness } from "lucide-react";

interface ErpShellProps {
  user: any;
  hasErpAccess: boolean;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

export function ErpShell({ user, hasErpAccess, handleLogout, leaveConfirmDialog }: ErpShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [currentLocation] = useLocation();
  const { selectedCompany } = useCompany();
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };

  return (
    <AppModeProvider mode="erp">
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-full w-full min-w-0 overflow-hidden">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <AppSidebar user={user} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AppTopBar
              accentColor="hsl(var(--primary))"
              user={user}
              onLogout={handleLogout}
              onSearchOpen={() => setPaletteOpen(true)}
              showSearch={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
              leftContent={
                <ModuleIdentity
                  compact
                  moduleName="ERP"
                  description="Finance, inventory, sales, and operations"
                  companyName={selectedCompany?.name}
                  icon={BriefcaseBusiness}
                  tone="erp"
                  className="hidden max-w-sm border-0 bg-transparent p-0 shadow-none sm:block"
                />
              }
              extraActions={<KeyboardShortcutsButton />}
            />
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
        isAdminOwner={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}
