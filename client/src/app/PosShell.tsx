import { useState, useRef, Suspense } from "react";
import { useLocation } from "wouter";
import { useMainContentFocus } from "@/hooks/use-main-content-focus";
import { useWorkspaceWheelScroll } from "@/hooks/use-workspace-wheel-scroll";
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
import { ModuleIdentity } from "@/components/navigation/module-identity";
import { Router } from "@/routes/AppRoutes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/page-state";
import { SkipLink } from "@/components/ui/responsive-accessibility";
import { ArrowLeft, LogOut, Search, ShoppingCart } from "lucide-react";
import { usePosNavigationItems } from "./usePosNavigationItems";
import { canUseAdminSearch, type ShellUser } from "./shellUser";

interface PosShellProps {
  user: ShellUser;
  posImportEnabled: boolean;
  chatUnread: { count: number } | undefined;
  handleGoBack: () => void;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

const posWorkspaceClasses = [
  "[&_button]:touch-manipulation",
  "max-sm:[&_button]:min-h-11",
  "max-sm:[&_input]:min-h-11",
  "max-sm:[&_input]:text-base",
  "max-sm:[&_select]:min-h-11",
  "max-sm:[&_textarea]:min-h-24",
  "[&_form]:min-w-0",
  "[&_form]:max-w-full",
  "[&_fieldset]:min-w-0",
  "[&_img]:max-w-full",
  "[&_table]:min-w-max",
  "[&_th]:whitespace-nowrap",
  "[&_td]:align-middle",
  "[&_[role=dialog]]:max-w-[calc(100vw-1rem)]",
  "[&_[role=listbox]]:max-h-[min(24rem,70dvh)]",
  "[&_[data-pos-mobile-page]]:max-w-full",
  "[&_[data-table-scroll-region]]:max-w-full",
  "[&_.tabular-nums]:font-variant-numeric-tabular-nums",
].join(" ");

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
  const isFullHeightRoute =
    currentLocation === "/" ||
    currentLocation === "/pos" ||
    currentLocation === "/pos/" ||
    currentLocation.startsWith("/pos/edit/");
  const hasAdminSearch = canUseAdminSearch(user);
  const posContainerRef = useRef<HTMLDivElement>(null);
  useMainContentFocus(currentLocation, isFullHeightRoute);
  useWorkspaceWheelScroll(posContainerRef);

  return (
    <>
      <SkipLink />
      <SidebarProvider style={posStyle as React.CSSProperties}>
        <div
          ref={posContainerRef}
          data-pos-shell="true"
          className="flex h-full w-full min-w-0 overflow-hidden"
        >
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <Sidebar>
            <SidebarHeader className="space-y-2 border-b p-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleGoBack}
                  aria-label="Go back"
                  data-testid="button-pos-back"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <ModuleIdentity
                  compact
                  moduleName={user.posStation ? `POS ${user.posStation}` : "POS"}
                  companyName={selectedCompany?.name}
                  icon={ShoppingCart}
                  tone="pos"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none"
                />
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu aria-label="Point of sale navigation">
                    {posNavItems.map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          isActive={item.active}
                          onClick={item.onClick}
                          aria-current={item.active ? "page" : undefined}
                          data-testid={item.testId}
                        >
                          <item.icon className="h-4 w-4" aria-hidden="true" />
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <Badge
                              variant="default"
                              className="min-w-5 justify-center text-xs"
                              aria-label={`${item.badge} unread`}
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
            <SidebarFooter className="space-y-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="truncate px-2 text-xs text-muted-foreground">{user.username}</div>
              <div className="flex flex-wrap items-center gap-1">
                <CurrencyToggle />
                <CompanySelector />
                <ThemeToggle />
                <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Log out" data-testid="button-logout">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </SidebarFooter>
          </Sidebar>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="no-print flex min-h-14 items-center gap-2 border-b px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:min-h-12 sm:pt-2">
              <SidebarTrigger
                className="h-11 w-11 sm:h-9 sm:w-9"
                aria-label="Toggle point of sale navigation"
                data-testid="button-sidebar-toggle"
              />
              <div className="min-w-0 flex-1 lg:hidden">
                <p className="truncate text-sm font-semibold">{user.posStation ? `POS ${user.posStation}` : "Point of Sale"}</p>
                <p className="truncate text-xs text-muted-foreground">{selectedCompany?.name}</p>
              </div>
              <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
                <PendingSyncIndicator />
                {hasAdminSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex min-h-11 items-center gap-1.5 px-2 text-muted-foreground sm:min-h-9"
                    onClick={() => setPaletteOpen(true)}
                    aria-label="Open command search"
                    data-testid="button-open-palette"
                  >
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <kbd className="hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] lg:inline-flex">
                      {typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
                        ? "⌘ /"
                        : "Ctrl /"}
                    </kbd>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 sm:h-9 sm:w-9"
                  onClick={handleLogout}
                  aria-label="Log out"
                  data-testid="button-logout-header"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </header>
            <OfflineBanner />
            <main
              id="main-content"
              tabIndex={-1}
              aria-label="Point of sale workspace"
              data-pos-workspace="true"
              className={`${posWorkspaceClasses} outline-none ${
                isFullHeightRoute
                  ? "flex-1 min-w-0 overflow-hidden overscroll-contain"
                  : "flex-1 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6"
              }`}
            >
              <div className={isFullHeightRoute ? "h-full min-w-0" : "w-full min-w-0 max-w-full"}>
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense fallback={<LoadingState title="Loading point of sale" description="Preparing the latest sales workspace." />}>
                    <Router user={user} posImportEnabled={posImportEnabled} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      {hasAdminSearch && (
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isPOS={true} user={user} />
      )}
      {leaveConfirmDialog}
    </>
  );
}
