import { Package, Warehouse } from "lucide-react";

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

interface StockGroupSummary {
  groupId: number | null;
  groupCode: string | null;
  groupName: string;
  totalQuantity: number;
  totalValue: number;
  averageRate: number;
  itemCount: number;
  items: any[];
}

interface LocationGridProps {
  locations: Location[];
  locationsLoading: boolean;
  selectedLocationLocal: Location | null;
  setSelectedLocationLocal: (loc: Location | null) => void;
  locationSearchTerm: string;
  setLocationSearchTerm: (s: string) => void;
  posUser?: any;
}

export function LocationGrid({
  locations,
  locationsLoading,
  selectedLocationLocal,
  setSelectedLocationLocal,
  locationSearchTerm,
  setLocationSearchTerm,
  posUser,
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
        <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pl-10"
          placeholder="Filter locations by name or code..."
          value={locationSearchTerm}
          onChange={(e) => setLocationSearchTerm(e.target.value)}
          data-testid="input-location-search"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {locationsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl border bg-card animate-pulse" />
          ))
        ) : filteredLocations.length === 0 ? (
          <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
            {locationSearchTerm ? "No locations match your search." : "No locations found."}
          </div>
        ) : (
          filteredLocations.map((loc) => (
            <div
              key={loc.id}
              onClick={() => setSelectedLocationLocal(loc)}
              className="group relative flex flex-col p-5 rounded-xl border bg-card hover-elevate cursor-pointer transition-all active:scale-[0.98]"
              data-testid={`card-location-${loc.id}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{loc.code || `LOC-${loc.id}`}</span>
                </div>
              </div>
              <h3 className="font-bold text-lg truncate mb-1">{loc.name}</h3>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {[loc.city, loc.state, loc.country].filter(Boolean).join(", ") || "No address set"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
