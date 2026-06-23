import { CalendarDays, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Location } from "@shared/schema";

interface StockEntrySidebarProps {
  selectedLocationId: string;
  onLocationChange: (val: string) => void;
  activeLocations: Location[];
  entryDate: string;
  onEntryDateChange: (val: string) => void;
  workerCategoryFilter: string;
  onWorkerCategoryFilterChange: (val: string) => void;
  workerCategoryGroups: any[];
  selectedCustomerId: string;
  onCustomerIdChange: (val: string) => void;
  allCustomers: any[];
  totalQty: number;
  totalKg: number;
  isPending: boolean;
  onConfirm: () => void;
}

export function StockEntrySidebar({
  selectedLocationId,
  onLocationChange,
  activeLocations,
  entryDate,
  onEntryDateChange,
  workerCategoryFilter,
  onWorkerCategoryFilterChange,
  workerCategoryGroups,
  selectedCustomerId,
  onCustomerIdChange,
  allCustomers,
  totalQty,
  totalKg,
  isPending,
  onConfirm,
}: StockEntrySidebarProps) {
  return (
    <div className="sticky top-6">
      <div className="p-5 rounded-2xl bg-card border shadow-sm space-y-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Location & Date</p>
            <div className="grid grid-cols-1 gap-3">
              <Select value={selectedLocationId} onValueChange={onLocationChange}>
                <SelectTrigger className="h-10 rounded-xl" data-testid="select-location">
                  <SelectValue placeholder="Select Warehouse..." />
                </SelectTrigger>
                <SelectContent>
                  {activeLocations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => onEntryDateChange(e.target.value)}
                  className="pl-9 h-10 rounded-xl"
                  data-testid="input-entry-date"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Filters & Options</p>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground px-1">Worker Group</Label>
                <Select value={workerCategoryFilter} onValueChange={onWorkerCategoryFilterChange}>
                  <SelectTrigger className="h-9 rounded-xl text-xs" data-testid="select-worker-group">
                    <SelectValue placeholder="Filter workers..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Workers</SelectItem>
                    {workerCategoryGroups.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground px-1">Customer Print Logo</Label>
                <Select value={selectedCustomerId} onValueChange={onCustomerIdChange}>
                  <SelectTrigger className="h-9 rounded-xl text-xs" data-testid="select-customer-logo">
                    <SelectValue placeholder="Global customer logo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Global Logo</SelectItem>
                    {allCustomers
                      .filter((c: any) => c.active)
                      .map((c: any) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.legalName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Total Bales</span>
            <span className="text-xl font-black text-primary" data-testid="text-total-qty">
              {totalQty}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Total Weight</span>
            <div className="text-right">
              <span className="text-xl font-black text-primary" data-testid="text-total-kg">
                {totalKg.toFixed(1)}
              </span>
              <span className="text-xs font-bold text-muted-foreground ml-1">KG</span>
            </div>
          </div>
        </div>

        <Button
          className="w-full gap-2 bg-emerald-600 hover:bg-emerald-600 text-white h-11 text-sm font-semibold rounded-xl"
          disabled={totalQty === 0 || !selectedLocationId || isPending}
          onClick={onConfirm}
          data-testid="button-confirm-stock-entry"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Processing…
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" /> Confirm & Print Labels{totalQty > 0 && ` (${totalQty})`}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
