import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ChevronRight, Shield, Building2 } from "lucide-react";
import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
import { FEATURE_KEYS } from "@shared/schema";

const FACTORY_PAGE_COUNT = FACTORY_NAV_PAGES.length;
const ERP_PAGE_COUNT = FEATURE_KEYS.length;

function accessSummary(user: any): { label: string; variant: "default" | "secondary" | "outline" } {
  const privileged = ["admin", "owner"].includes(user.role?.toLowerCase());
  const hasERP = privileged || (user.hasErpAccess ?? true);
  const hasFactory = privileged || (user.hasFactoryAccess ?? true);
  if (hasERP && hasFactory) return { label: "ERP + Factory", variant: "default" };
  if (hasERP) return { label: "ERP only", variant: "secondary" };
  if (hasFactory) return { label: "Factory only", variant: "secondary" };
  return { label: "No access", variant: "outline" };
}

function pagesSummary(user: any): string {
  const privileged = ["admin", "owner"].includes(user.role?.toLowerCase());
  if (privileged || user.pageAccess.length === 0) return "Full access";
  const factoryKeys = new Set(FACTORY_NAV_PAGES.map((p: any) => p.key));
  const erpKeys = new Set(FEATURE_KEYS);
  const fCount = user.pageAccess.filter((k: string) => factoryKeys.has(k)).length;
  const eCount = user.pageAccess.filter((k: string) => erpKeys.has(k)).length;
  const parts: string[] = [];
  if (fCount > 0) parts.push(`Factory: ${fCount}/${FACTORY_PAGE_COUNT}`);
  if (eCount > 0) parts.push(`ERP: ${eCount}/${ERP_PAGE_COUNT}`);
  return parts.length > 0 ? `Custom — ${parts.join(" · ")}` : "Full access";
}

interface UserListTableProps {
  users: any[];
  isLoading: boolean;
  selectedUserId?: string | null;
  onSelectUser: (user: any) => void;
}

export function UserListTable({ users, isLoading, selectedUserId, onSelectUser }: UserListTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No users yet</p>
        <p className="text-sm mt-1">Click "Add User" to create the first one</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {users.map((user: any) => {
        const privileged = ["admin", "owner"].includes(user.role?.toLowerCase());
        const access = accessSummary(user);
        const pages = pagesSummary(user);
        const isSelected = selectedUserId === user.id;
        return (
          <button
            key={user.id}
            type="button"
            className={`w-full text-left rounded-md border px-4 py-3 flex items-center gap-4 transition-colors hover-elevate ${
              isSelected ? "border-primary bg-accent" : "bg-card"
            }`}
            onClick={() => onSelectUser(user)}
            data-testid={`row-user-${user.id}`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm text-muted-foreground uppercase">
              {(user.displayName || user.username).charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{user.displayName || user.username}</span>
                {user.displayName && (
                  <span className="text-xs text-muted-foreground font-mono">{user.username}</span>
                )}
                {privileged && (
                  <Badge variant="default" className="text-xs capitalize gap-1">
                    <Shield className="h-3 w-3" />
                    {user.role}
                  </Badge>
                )}
                {!privileged && user.role && (
                  <Badge variant="secondary" className="text-xs capitalize">{user.role}</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <span className={`text-xs ${access.variant === "outline" ? "text-destructive" : "text-muted-foreground"}`}>
                  {access.label}
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{pages}</span>
              </div>
            </div>
            <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isSelected ? "text-primary rotate-90" : ""}`} />
          </button>
        );
      })}
    </div>
  );
}
