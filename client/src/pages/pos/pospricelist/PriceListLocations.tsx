/**
 * Location pickers for the POS Price List page: the desktop sidebar and the
 * phone-only horizontal strip.
 *
 * Split out of POSPriceList.tsx unchanged — the synthetic "All Locations"
 * entry stays hidden from POS users, and selecting a location still resets the
 * search, group filter, unpriced view and any in-flight cell edit.
 */
import { Layers, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ALL_LOCATIONS_ID } from "./utils";
import type { PosPriceListModel } from "./usePosPriceListModel";

export function PriceListSidebar({ model }: { model: PosPriceListModel }) {
  const { locations, locationsLoading, selectedLocationId, posUser } = model;
  return (
    <div className="hidden sm:flex w-52 shrink-0 border-r flex-col overflow-hidden bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-3 border-b">
        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-sidebar-foreground">Locations</span>
        {!locationsLoading && locations.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
            {locations.length}
          </Badge>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {locationsLoading ? (
          <div className="flex flex-col gap-1 px-2 py-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : locations.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-4">No locations.</p>
        ) : (
          <div className="flex flex-col gap-0.5 px-2 py-1">
            {!posUser && (
              <button
                data-testid="button-location-all"
                onClick={() => model.selectLocation(ALL_LOCATIONS_ID)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate flex items-center gap-1.5",
                  selectedLocationId === ALL_LOCATIONS_ID
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-sidebar-foreground"
                )}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                All Locations
              </button>
            )}
            {locations.map((loc) => (
              <button
                key={loc.id}
                data-testid={`button-location-${loc.id}`}
                onClick={() => model.selectLocation(loc.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate flex items-center gap-2",
                  selectedLocationId === loc.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <MapPin className="w-3.5 h-3.5 shrink-0 opacity-60" />
                {loc.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PriceListMobileLocations({ model }: { model: PosPriceListModel }) {
  const { locations, locationsLoading, selectedLocationId, posUser } = model;
  return (
    <div className="sm:hidden border-b shrink-0 bg-sidebar">
      {locationsLoading ? (
        <div className="flex gap-2 px-3 py-2 overflow-x-auto">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-md" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 px-3 py-2 overflow-x-auto">
          {!posUser && (
            <button
              data-testid="button-mobile-location-all"
              onClick={() => model.selectLocation(ALL_LOCATIONS_ID)}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                selectedLocationId === ALL_LOCATIONS_ID
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              All
            </button>
          )}
          {locations.map((loc) => (
            <button
              key={loc.id}
              data-testid={`button-mobile-location-${loc.id}`}
              onClick={() => model.selectLocation(loc.id)}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                selectedLocationId === loc.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
