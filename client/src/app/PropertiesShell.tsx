import { useState, useRef } from "react";
import { useMainContentFocus } from "@/hooks/use-main-content-focus";
import { useWorkspaceWheelScroll } from "@/hooks/use-workspace-wheel-scroll";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PropertiesSidebar } from "@/components/PropertiesSidebar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { CommandPalette } from "@/components/CommandPalette";
import { SkipLink } from "@/components/ui/responsive-accessibility";
import { PropertiesRoutes } from "@/app/PropertiesRoutes";
import { canUseAdminSearch, type ShellUser } from "./shellUser";

interface PropertiesShellProps {
  user: ShellUser;
  currentLocation: string;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

export function PropertiesShell({ user, currentLocation, handleLogout, leaveConfirmDialog }: PropertiesShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };
  const propertiesContainerRef = useRef<HTMLDivElement>(null);
  useMainContentFocus(currentLocation);
  useWorkspaceWheelScroll(propertiesContainerRef);
  const hasAdminSearch = canUseAdminSearch(user);

  return (
    <AppModeProvider mode="properties">
      <SkipLink />
      <SidebarProvider style={style as React.CSSProperties}>
        <div ref={propertiesContainerRef} className="flex h-full w-full min-w-0 overflow-hidden">
          <PropertiesSidebar user={user} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <OfflineBanner />
            <main
              id="main-content"
              tabIndex={-1}
              aria-label="Properties workspace"
              className="flex-1 overflow-y-auto overscroll-y-contain p-3 outline-none sm:p-6"
            >
              <div className="w-full min-w-0 max-w-full [&_form]:min-w-0 [&_table]:w-full [&_[role=table]]:w-full [&_.overflow-x-auto]:overscroll-x-contain">
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
        isAdminOwner={hasAdminSearch}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}
