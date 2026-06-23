import { Warehouse, Pencil, MessageCircle, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt?: string;
  supplierPartnerPayableDeductionPerQty?: string | null;
}

interface LocationGridProps {
  locations: Location[];
  locationsLoading: boolean;
  selectedLocationLocal: Location | null;
  setSelectedLocationLocal: (loc: Location | null) => void;
  locationSearchTerm: string;
  setLocationSearchTerm: (s: string) => void;
  posUser?: any;
  openRenameDialog?: (loc: Location, e?: any) => void;
  openWaGroupDialog?: (loc: Location, e?: any) => void;
}

export function LocationGrid({
  locations,
  locationsLoading,
  selectedLocationLocal,
  setSelectedLocationLocal,
  locationSearchTerm,
  setLocationSearchTerm,
  posUser,
  openRenameDialog,
  openWaGroupDialog,
}: LocationGridProps) {
  const filteredLocations = locations.filter((loc) => {
    if (!locationSearchTerm) return true;
    const s = locationSearchTerm.toLowerCase();
    return loc.name.toLowerCase().includes(s) || (loc.code && loc.code.toLowerCase().includes(s));
  });

  if (selectedLocationLocal) return null;

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search locations..."
          value={locationSearchTerm}
          onChange={(e) => setLocationSearchTerm(e.target.value)}
          data-testid="input-location-search"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {locationsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg border bg-card animate-pulse" />
          ))
        ) : filteredLocations.length === 0 ? (
          <div className="col-span-full py-12 text-center border-2 border-dashed rounded-lg text-muted-foreground">
            {locationSearchTerm ? "No locations match your search." : "No locations found."}
          </div>
        ) : (
          filteredLocations.map((loc) => (
            <div
              key={loc.id}
              onClick={() => setSelectedLocationLocal(loc)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover-elevate cursor-pointer"
              data-testid={`card-location-${loc.id}`}
            >
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Warehouse className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{loc.name}</p>
                <p className="text-xs text-muted-foreground">Tap to view inventory</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!posUser && openRenameDialog && (
                  <button
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); openRenameDialog(loc, e); }}
                    data-testid={`button-rename-${loc.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {!posUser && openWaGroupDialog && (
                  <button
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); openWaGroupDialog(loc, e); }}
                    data-testid={`button-wa-${loc.id}`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                  </button>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
