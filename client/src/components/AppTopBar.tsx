import type { ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { NotificationsCenter } from "@/components/NotificationsCenter";
import { UserMenu } from "@/components/UserMenu";
import { useApplicationDirection } from "@/contexts/ApplicationLanguageContext";

interface AppTopBarProps {
  accentColor: string;
  user: { username: string; role: string };
  onLogout: () => void;
  onSearchOpen?: () => void;
  showSearch?: boolean;
  leftContent?: ReactNode;
  extraActions?: ReactNode;
}

export function AppTopBar({
  accentColor,
  user,
  onLogout,
  onSearchOpen,
  showSearch = true,
  leftContent,
  extraActions,
}: AppTopBarProps) {
  const direction = useApplicationDirection();
  const dividerDirection = direction === "rtl" ? "to left" : "to right";

  return (
    <header
      data-slot="app-top-bar"
      className="relative flex min-h-14 flex-nowrap items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4 no-print"
    >
      <div
        data-slot="app-top-bar-divider"
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(${dividerDirection}, ${accentColor}cc 0%, ${accentColor}44 30%, hsl(var(--border)) 65%)`,
        }}
      />

      <div data-slot="app-top-bar-leading" className="flex shrink-0 items-center gap-2.5">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        {leftContent}
      </div>

      <div data-slot="app-top-bar-actions" className="ml-auto flex min-w-0 flex-nowrap items-center gap-1 sm:gap-1.5">
        {extraActions}

        {showSearch && onSearchOpen && (
          <button
            onClick={onSearchOpen}
            data-testid="button-open-palette"
            className="hidden h-8 items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 text-xs text-muted-foreground transition-colors hover-elevate sm:flex"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden lg:inline">Search</span>
            <kbd className="inline-flex h-4 items-center rounded border border-border bg-background px-1.5 font-mono text-[9px] leading-none">
              {typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "⌘ /" : "Ctrl /"}
            </kbd>
          </button>
        )}
        {showSearch && onSearchOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onSearchOpen}
            aria-label="Open search"
            data-testid="button-open-palette-sm"
            className="sm:hidden"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        <PendingSyncIndicator />
        <NotificationsCenter />

        <div className="mx-1 hidden h-5 w-px bg-border/60 sm:block" />

        <UserMenu accentColor={accentColor} user={user} onLogout={onLogout} />

        <div className="mx-1 hidden h-5 w-px bg-border/60 sm:block" />

        <span className="hidden sm:block">
          <CurrencyToggle />
        </span>
        <CompanySelector />
        <ThemeToggle />
      </div>
    </header>
  );
}
