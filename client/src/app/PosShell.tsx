import { useState, Suspense } from "react";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DailyRateModal } from "@/components/DailyRateModal";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { Router } from "@/routes/AppRoutes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, LogOut, Search } from "lucide-react";
import { usePosNavigationItems } from "./usePosNavigationItems";

interface PosShellProps {
  user: any;
  posImportEnabled: boolean;
  chatUnread: { count: number } | undefined;
  handleGoBack: () => void;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

export function PosShell({
  user,
  posImportEnabled,
  chatUnread,
  handleGoBack,
  handleLogout,
  leaveConfirmDialog,
}: PosShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [currentLocation] = useLocation();
  const { selectedCompany } = useCompany();
  const posNavItems = usePosNavigationItems({ user, posImportEnabled, chatUnread });

  const posStyle = { "--sidebar-width": "11rem", "--sidebar-width-icon": "3rem" };
  const isPosRoute       = currentLocation === "/pos" || currentLocation.startsWith("/pos/");
  const isFullHeightRoute = isPosRoute || currentLocation === "/tracking" || currentLocation === "/";

  return (
    <>
      <SidebarProvider style={posStyle as React.CSSProperties}>
        <div className="flex h-full w-full">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <Sidebar>
            <SidebarHeader className="p-3 border-b">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={handleGoBack} data-testid="button-pos-back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="font-semibold text-sm truncate">POS {user.posStation || ""}</span>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {posNavItems.map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton isActive={item.active} onClick={item.onClick} data-testid={item.testId}>
                          <item.icon className="h-4 w-4" />
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <Badge
                              variant="default"
                              className="text-xs min-w-5 justify-center"
                              data-testid="badge-chat-unread-pos"
                            >
                              {item.badge}
                            </Badge>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="p-2 border-t space-y-1">
              <div className="text-xs text-muted-foreground px-2 truncate">{user.username}</div>
              <div className="flex items-center gap-1 flex-wrap">
                <CurrencyToggle />
                <CompanySelector />
                <ThemeToggle />
                <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </SidebarFooter>
          </Sidebar>
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-2 p-2 border-b h-12 no-print">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex items-center gap-2 ml-auto">
                <PendingSyncIndicator />
                {(user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 text-muted-foreground"
                    onClick={() => setPaletteOpen(true)}
                    data-testid="button-open-palette"
                  >
                    <Search className="h-4 w-4" />
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                      {typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
                        ? "⌘ /"
                        : "Ctrl /"}
                    </kbd>
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout-header">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </header>
            <OfflineBanner />
            <main className={isFullHeightRoute ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-3 sm:p-6"}>
              <div className={isFullHeightRoute ? "h-full" : "w-full"}>
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                        Loading...
                      </div>
                    }
                  >
                    <Router user={user} posImportEnabled={posImportEnabled} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isPOS={true} user={user} />
      {leaveConfirmDialog}
    </>
  );
}
