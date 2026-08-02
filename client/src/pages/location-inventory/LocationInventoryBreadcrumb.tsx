import { MapPin, ChevronRight } from "lucide-react";
import type { InventoryLocation as Location, StockGroupSummary } from "./locationInventoryTypes";
import { useErpText } from "@/i18n/modules/erp";

interface LocationInventoryBreadcrumbProps {
  selectedLocationLocal: Location | null;
  selectedGroup: StockGroupSummary | null;
  viewAllItems: boolean;
  goBackToLocations: () => void;
  onBackToLocation: () => void;
}

export function LocationInventoryBreadcrumb({
  selectedLocationLocal,
  selectedGroup,
  viewAllItems,
  goBackToLocations,
  onBackToLocation,
}: LocationInventoryBreadcrumbProps) {
  const tUi = useErpText();
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      {!selectedLocationLocal ? (
        <span>{tUi("select.location.2")}</span>
      ) : (
        <>
          <button className="hover:underline hover:text-foreground transition-colors" onClick={goBackToLocations}>
            Locations
          </button>
          <ChevronRight className="h-3.5 w-3.5" />
          {selectedGroup ? (
            <>
              <button className="hover:underline hover:text-foreground transition-colors" onClick={onBackToLocation}>
                {selectedLocationLocal.name}
              </button>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium">{selectedGroup.groupName}</span>
            </>
          ) : viewAllItems ? (
            <>
              <button className="hover:underline hover:text-foreground transition-colors" onClick={onBackToLocation}>
                {selectedLocationLocal.name}
              </button>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium">{tUi("all.items")}</span>
            </>
          ) : (
            <span className="text-foreground font-medium">{selectedLocationLocal.name}</span>
          )}
        </>
      )}
    </div>
  );
}
