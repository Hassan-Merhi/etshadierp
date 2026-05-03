import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, MapPin, Monitor, Calendar, PackageMinus } from "lucide-react";

interface RoleSummaryRowProps {
  role: any;
  companyName: string;
  locationNames: string[];
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function RoleSummaryRow({
  role,
  companyName,
  locationNames,
  isEditing,
  onEdit,
  onDelete,
}: RoleSummaryRowProps) {
  const isPOS = role.role?.startsWith("POS");
  const isPrivileged = ["Admin", "Owner", "Developer"].includes(role.role);

  return (
    <div
      className={`rounded-md border bg-card transition-colors ${isEditing ? "border-primary/50 bg-accent/30" : ""}`}
      data-testid={`role-item-${role.id}`}
    >
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
    </div>
  );
}
