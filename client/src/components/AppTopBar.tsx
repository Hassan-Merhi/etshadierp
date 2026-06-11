import { ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Search, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { NotificationsCenter } from "@/components/NotificationsCenter";

interface AppTopBarProps {
  accentColor: string;
  user: { username: string; role: string };
  onLogout: () => void;
  onSearchOpen?: () => void;
  showSearch?: boolean;
  leftContent?: ReactNode;
  extraActions?: ReactNode;
}

function getInitials(username: string) {
  const words = username.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.substring(0, 2).toUpperCase();
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
  return (
    <header className="relative flex flex-nowrap items-center justify-between px-3 sm:px-4 min-h-14 gap-2 sm:gap-3 no-print">
      {/* Gradient bottom border — replaces plain border-b */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background: `linear-gradient(to right, ${accentColor}cc 0%, ${accentColor}44 30%, hsl(var(--border)) 65%)`,
        }}
      />

      {/* Left zone: sidebar toggle + optional module badge */}
      <div className="flex items-center gap-2.5 shrink-0">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        {leftContent}
      </div>

      {/* Right zone */}
      <div className="flex flex-nowrap items-center gap-1 sm:gap-1.5 ml-auto min-w-0">

        {/* Extra actions slot (e.g. "Switch to ERP") */}
        {extraActions}

        {/* Search pill — desktop */}
        {showSearch && onSearchOpen && (
          <button
            onClick={onSearchOpen}
            data-testid="button-open-palette"
            className="hidden sm:flex items-center gap-2 h-8 px-3 rounded-full border border-border/60 bg-muted/40 text-muted-foreground text-xs transition-colors hover-elevate"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden lg:inline">Search</span>
            <kbd className="inline-flex h-4 items-center rounded border border-border bg-background px-1.5 text-[9px] font-mono leading-none">
              Ctrl /
            </kbd>
          </button>
        )}
        {/* Search icon — mobile */}
        {showSearch && onSearchOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onSearchOpen}
            data-testid="button-open-palette-sm"
            className="sm:hidden"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}

        <PendingSyncIndicator />
        <NotificationsCenter />

        {/* Divider */}
        <div className="hidden sm:block h-5 w-px bg-border/60 mx-1" />

        {/* User pill */}
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full border border-border/40 bg-muted/30 shrink-0">
          <span
            className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
            style={{ backgroundColor: accentColor }}
          >
            {getInitials(user.username)}
          </span>
          <span className="text-sm font-medium leading-none">{user.username}</span>
          <span className="text-xs text-muted-foreground leading-none border-l border-border/50 pl-1.5">
            {user.role}
          </span>
        </div>

        {/* Logout */}
        <Button variant="ghost" size="icon" onClick={onLogout} data-testid="button-logout">
          <LogOut className="h-4 w-4" />
        </Button>

        {/* Divider */}
        <div className="hidden sm:block h-5 w-px bg-border/60 mx-1" />

        <span className="hidden sm:block"><CurrencyToggle /></span>
        <CompanySelector />
        <ThemeToggle />
      </div>
    </header>
  );
}
