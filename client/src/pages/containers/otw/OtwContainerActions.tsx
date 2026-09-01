import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell } from "@/components/ui/table";
import { useJsonCargoEta } from "../useJsonCargoEta";

interface OtwContainerActionsProps {
  containerId: number;
  hasChanges: (id: number) => boolean;
  saveTracking: (id: number) => Promise<void>;
  savingIds: Set<number>;
}

export function OtwContainerActions({
  containerId,
  hasChanges,
  saveTracking,
  savingIds,
}: OtwContainerActionsProps) {
  const { refreshOne, refreshingIds } = useJsonCargoEta();
  const isRefreshing = refreshingIds.has(containerId);

  return (
    <TableCell>
      <div className="flex items-center gap-1">
        {hasChanges(containerId) && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => saveTracking(containerId)}
            disabled={savingIds.has(containerId)}
            data-testid={`button-save-${containerId}`}
          >
            {savingIds.has(containerId) ? (
              <span className="animate-spin">...</span>
            ) : (
              <Check className="h-4 w-4 text-green-600" />
            )}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          title="Refresh ETA (Maersk / Hapag-Lloyd / MSC / CMA CGM)"
          onClick={() => refreshOne(containerId)}
          disabled={isRefreshing}
          data-testid={`button-refresh-eta-${containerId}`}
        >
          <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </TableCell>
  );
}
