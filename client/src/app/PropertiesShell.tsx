import { useState } from "react";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PropertiesSidebar } from "@/components/PropertiesSidebar";
import { AppTopBar } from "@/components/AppTopBar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { CommandPalette } from "@/components/CommandPalette";
import { PropertiesRoutes } from "@/app/PropertiesRoutes";
import { Building2 } from "lucide-react";

interface PropertiesShellProps {
  user: any;
  currentLocation: string;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

export function PropertiesShell({ user, currentLocation, handleLogout, leaveConfirmDialog }: PropertiesShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };

  return (
    <AppModeProvider mode="properties">
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-full w-full">
          <PropertiesSidebar user={user} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <AppTopBar
              accentColor="#6366f1"
              user={user}
              onLogout={handleLogout}
              onSearchOpen={() => setPaletteOpen(true)}
              showSearch={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
              leftContent={
                <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-indigo-600/10 border border-indigo-600/20">
                  <Building2 className="h-4 w-4 text-indigo-600" />
                  <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Properties</span>
                </div>
              }
            />
            <OfflineBanner />
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="w-full">
                <PropertiesRoutes user={user} currentLocation={currentLocation} />
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hasErpAccess={false}
        hasFactoryAccess={false}
        hasPropertiesAccess={true}
        isAdminOwner={user?.role === "Admin" || user?.role === "Developer"}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}
