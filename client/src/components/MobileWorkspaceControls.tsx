import { ReactNode, useState } from "react";
import { LogOut, MoreHorizontal, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { NotificationsCenter } from "@/components/NotificationsCenter";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface WorkspaceUser {
  username: string;
  role: string;
}

interface WorkspaceHeaderControlsProps {
  accentColor: string;
  user: WorkspaceUser;
  onLogout: () => void;
}

interface MobileWorkspaceControlsProps extends WorkspaceHeaderControlsProps {
  onSearchOpen?: () => void;
  showSearch: boolean;
  extraActions?: ReactNode;
}

function getInitials(username: string) {
  const words = username.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.substring(0, 2).toUpperCase();
}

export function WorkspaceHeaderControls({ accentColor, user, onLogout }: WorkspaceHeaderControlsProps) {
  return (
    <>
      <div className="hidden sm:block">
        <PendingSyncIndicator />
      </div>

      <NotificationsCenter />

      <div className="mx-1 hidden h-5 w-px bg-border/60 sm:block" />

      <div className="hidden shrink-0 items-center gap-2 rounded-full border border-border/40 bg-muted/30 px-2.5 py-1 md:flex">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: accentColor }}
        >
          {getInitials(user.username)}
        </span>
        <span className="text-sm font-medium leading-none">{user.username}</span>
        <span className="border-l border-border/50 pl-1.5 text-xs leading-none text-muted-foreground">{user.role}</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onLogout}
        data-testid="button-logout"
        aria-label="Log out"
        className="hidden sm:inline-flex"
      >
        <LogOut className="h-4 w-4" />
      </Button>

      <div className="mx-1 hidden h-5 w-px bg-border/60 sm:block" />

      <span className="hidden sm:block">
        <CurrencyToggle />
      </span>
    </>
  );
}

export default function MobileWorkspaceControls({
  accentColor,
  user,
  onLogout,
  onSearchOpen,
  showSearch,
  extraActions,
}: MobileWorkspaceControlsProps) {
  const [open, setOpen] = useState(false);

  const openSearch = () => {
    setOpen(false);
    onSearchOpen?.();
  };

  const logout = () => {
    setOpen(false);
    onLogout();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open account and display controls"
          data-testid="button-mobile-controls"
          className="h-10 w-10 shrink-0 sm:hidden"
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[calc(100vw_-_0.5rem)] max-w-sm flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 pb-3 pt-[max(1rem,var(--safe-area-top))] text-left">
          <SheetTitle>Workspace controls</SheetTitle>
          <SheetDescription>Account, display, synchronization, and search controls.</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: accentColor }}
            >
              {getInitials(user.username)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.username}</p>
              <p className="truncate text-xs text-muted-foreground">{user.role}</p>
            </div>
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>

          {extraActions && <div className="grid gap-2 [&>*]:w-full">{extraActions}</div>}

          {showSearch && onSearchOpen && (
            <Button
              variant="outline"
              onClick={openSearch}
              data-testid="button-mobile-controls-search"
              className="w-full justify-start gap-2"
            >
              <Search className="h-4 w-4" />
              Search the workspace
            </Button>
          )}

          <div className="rounded-lg border p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status and display
            </p>
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <span className="text-sm">Pending synchronization</span>
              <PendingSyncIndicator />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-3">
              <div className="[&>button]:w-full">
                <CurrencyToggle />
              </div>
              <div className="flex min-h-10 items-center justify-between rounded-md border px-3">
                <span className="text-sm">Theme</span>
                <ThemeToggle />
              </div>
            </div>
          </div>

          <Button
            variant="destructive"
            onClick={logout}
            data-testid="button-mobile-logout"
            className="mt-auto w-full gap-2"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
