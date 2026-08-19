import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Search, FileSpreadsheet, Pencil } from "lucide-react";
import { RenameLocationDialog } from "./factory-location-inventory/dialogs/RenameLocationDialog";
import type { useFactoryLocationInventory } from "./FactoryLocationInventoryModel";

type FactoryLocationInventoryModel = ReturnType<typeof useFactoryLocationInventory>;

export function FactoryLocationInventoryLocationView({ inventory }: { inventory: FactoryLocationInventoryModel }) {
  const {
    filteredLocations,
    handleLocationClick,
    hideAvgCost,
    hideSellingPrice,
    locationSearch,
    locations,
    locationsLoading,
    openRenameDialog,
    renameDialogOpen,
    renameInput,
    renameLocationMutation,
    renamingLocation,
    setLocationSearch,
    setRenameDialogOpen,
    setRenameInput,
  } = inventory;
  return (
    <div className="p-4 md:p-6 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Location Inventory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Physical bales on ground by location</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const p = new URLSearchParams();
              if (hideAvgCost) p.set("includeCost", "0");
              if (hideSellingPrice) p.set("includeSellPrice", "0");
              const qs = p.toString();
              window.open(`/api/factory/location-inventory/export/all${qs ? "?" + qs : ""}`, "_blank");
            }}
            data-testid="button-export-all-locations"
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export All (Excel)
          </Button>
        </div>
      </div>

      {/* Search + list */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
              className="pl-8 h-8 bg-transparent border-0 focus-visible:ring-0 text-sm"
              data-testid="input-search-locations"
            />
          </div>
        </div>
        <div className="p-4">
          {locationsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No locations found.
            </div>
          ) : filteredLocations.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">No locations match your search.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filteredLocations.map((location) => (
                <div
                  key={location.id}
                  className="relative flex flex-col items-center justify-center text-center px-4 py-6 rounded-xl border bg-muted/10 cursor-pointer hover-elevate gap-2"
                  onClick={() => handleLocationClick(location)}
                  data-testid={`row-location-${location.id}`}
                >
                  <div className="p-2 rounded-lg bg-primary/10">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <span className="font-semibold text-sm leading-snug">{location.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1.5 right-1.5 h-7 w-7 opacity-40"
                    onClick={(e) => openRenameDialog(location, e)}
                    data-testid={`button-rename-location-${location.id}`}
                    title="Rename location"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!locationsLoading && filteredLocations.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              {filteredLocations.length} of {locations.length} location{locations.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>

      <RenameLocationDialog
        renameDialogOpen={renameDialogOpen}
        renameInput={renameInput}
        renameLocationMutation={renameLocationMutation}
        renamingLocation={renamingLocation}
        setRenameDialogOpen={setRenameDialogOpen}
        setRenameInput={setRenameInput}
      />
    </div>
  );
}
