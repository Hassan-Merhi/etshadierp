import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, MapPin, Monitor, Calendar, PackageMinus, ShieldCheck, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AdvancedRestrictionsPanel } from "@/components/AdvancedRestrictionsPanel";

interface RoleSummaryRowProps {
  role: any;
  companyName: string;
  locationNames: string[];
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const NON_RESTRICTABLE_ROLES = ["Developer", "Admin"];

export function RoleSummaryRow({
  role,
  companyName,
  locationNames,
  isEditing,
  onEdit,
  onDelete,
}: RoleSummaryRowProps) {
  const [restrictionsOpen, setRestrictionsOpen] = useState(false);
  const isPOS = role.role === "POS";
  const isPrivileged = ["Admin", "Owner", "Developer"].includes(role.role);
  const canShowRestrictions = !NON_RESTRICTABLE_ROLES.includes(role.role) && role.companyId;

  return (
    <div
      className={`rounded-md border bg-card transition-colors ${isEditing ? "border-primary/50 bg-accent/30" : ""}`}
      data-testid={`role-item-${role.id}`}
    >
      {/* Main row */}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{companyName}</span>
            <Badge
              variant={isPrivileged ? "default" : isPOS ? "secondary" : "outline"}
              className="text-xs"
            >
              {role.role}
            </Badge>
          </div>

          {(isPOS || role.daybookEditDays > 0 || role.canSellNegativeStock) && (
            <div className="flex items-center gap-3 flex-wrap">
              {isPOS && locationNames.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {locationNames.length === 1
                    ? locationNames[0]
                    : `${locationNames.length} locations`}
                </span>
              )}
              {isPOS && role.posStation && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Monitor className="h-3 w-3 shrink-0" />
                  Station {role.posStation}
                </span>
              )}
              {role.daybookEditDays > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3 shrink-0" />
                  {role.daybookEditDays}d edit window
                </span>
              )}
              {role.canSellNegativeStock && (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <PackageMinus className="h-3 w-3 shrink-0" />
                  Can sell 0-stock
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {canShowRestrictions && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRestrictionsOpen((v) => !v)}
              title="Advanced Restrictions"
              data-testid={`button-restrictions-${role.id}`}
              className={restrictionsOpen ? "text-primary" : ""}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            data-testid={`button-edit-role-${role.id}`}
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={onDelete}
            data-testid={`button-delete-role-${role.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Advanced Restrictions collapsible */}
      {canShowRestrictions && restrictionsOpen && (
        <div className="border-t px-3 py-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Advanced Restrictions
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setRestrictionsOpen(false)}
              data-testid={`button-close-restrictions-${role.id}`}
            >
              Close
            </Button>
          </div>
          <AdvancedRestrictionsPanel
            role={role.role}
            companyId={role.companyId}
            companyName={companyName}
          />
        </div>
      )}
    </div>
  );
}
