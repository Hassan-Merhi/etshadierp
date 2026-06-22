import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { MultiFilterSelect } from "./MultiFilterSelect";

interface FilterBarProps {
  showFilters: boolean;
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
  companies: string[];
  suppliers: string[];
  supplierFilters: string[];
  setSupplierFilters: (v: string[]) => void;
  transporters: string[];
  transporterFilters: string[];
  setTransporterFilters: (v: string[]) => void;
  agents: string[];
  agentFilters: string[];
  setAgentFilters: (v: string[]) => void;
  trucks: string[];
  truckFilters: string[];
  setTruckFilters: (v: string[]) => void;
  locations: string[];
  locationFilters: string[];
  setLocationFilters: (v: string[]) => void;
  docsFilter: string;
  setDocsFilter: (v: string) => void;
  delayedFilter: string;
  setDelayedFilter: (v: string) => void;
  freightFilter: string;
  setFreightFilter: (v: string) => void;
  etaFilter: string;
  setEtaFilter: (v: string) => void;
  notesFilter: string;
  setNotesFilter: (v: string) => void;
  sortOrder: string;
  setSortOrder: (v: string) => void;
  clearFilters: () => void;
}

export function FilterBar({
  showFilters,
  companyFilter,
  setCompanyFilter,
  companies,
  suppliers,
  supplierFilters,
  setSupplierFilters,
  transporters,
  transporterFilters,
  setTransporterFilters,
  agents,
  agentFilters,
  setAgentFilters,
  trucks,
  truckFilters,
  setTruckFilters,
  locations,
  locationFilters,
  setLocationFilters,
  docsFilter,
  setDocsFilter,
  delayedFilter,
  setDelayedFilter,
  freightFilter,
  setFreightFilter,
  etaFilter,
  setEtaFilter,
  notesFilter,
  setNotesFilter,
  sortOrder,
  setSortOrder,
  clearFilters,
}: FilterBarProps) {
  if (!showFilters) return null;

  return (
    <Card className="bg-muted/30 border-dashed animate-in fade-in slide-in-from-top-2 duration-200">
      <CardContent className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Company</Label>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-company">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Companies</SelectItem>
                {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Supplier</Label>
            <MultiFilterSelect
              allLabel="All Suppliers"
              options={suppliers.map(s => ({ label: s, value: s }))}
              selected={supplierFilters}
              onChange={setSupplierFilters}
              testId="multi-filter-supplier"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Transporter</Label>
            <MultiFilterSelect
              allLabel="All Transporters"
              options={transporters.map(t => ({ label: t, value: t }))}
              selected={transporterFilters}
              onChange={setTransporterFilters}
              testId="multi-filter-transporter"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Agent</Label>
            <MultiFilterSelect
              allLabel="All Agents"
              options={agents.map(a => ({ label: a, value: a }))}
              selected={agentFilters}
              onChange={setAgentFilters}
              testId="multi-filter-agent"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Truck</Label>
            <MultiFilterSelect
              allLabel="All Trucks"
              options={[
                { label: "With Truck #", value: "HAS_TRUCK" },
                { label: "No Truck #", value: "NO_TRUCK" },
                { label: "────────────────", value: "SEP", dividerBefore: true },
                ...trucks.map(t => ({ label: t, value: t }))
              ]}
              selected={truckFilters}
              onChange={setTruckFilters}
              testId="multi-filter-truck"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Location</Label>
            <MultiFilterSelect
              allLabel="All Locations"
              options={[
                { label: "With Location", value: "HAS_LOCATION" },
                { label: "No Location", value: "NO_LOCATION" },
                { label: "────────────────", value: "SEP", dividerBefore: true },
                ...locations.map(l => ({ label: l, value: l }))
              ]}
              selected={locationFilters}
              onChange={setLocationFilters}
              testId="multi-filter-location"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Docs</Label>
            <Select value={docsFilter} onValueChange={setDocsFilter}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-docs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="MISSING">Missing Docs</SelectItem>
                <SelectItem value="RECEIVED">Received Docs</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Delayed</Label>
            <Select value={delayedFilter} onValueChange={setDelayedFilter}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-delayed">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="YES">Yes (ETA passed)</SelectItem>
                <SelectItem value="OVERDUE">Offload Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Freight</Label>
            <Select value={freightFilter} onValueChange={setFreightFilter}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-freight">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="HAS_FREIGHT">Paid Freight</SelectItem>
                <SelectItem value="NO_FREIGHT">No Freight</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">ETA</Label>
            <Select value={etaFilter} onValueChange={setEtaFilter}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-eta">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="HAS_ETA">With ETA</SelectItem>
                <SelectItem value="NO_ETA">No ETA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Notes</Label>
            <Select value={notesFilter} onValueChange={setNotesFilter}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-notes">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="WITH">With Notes</SelectItem>
                <SelectItem value="WITHOUT">Without Notes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Sort</Label>
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="h-8 text-xs px-2" data-testid="select-filter-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">Default (Company + Shop)</SelectItem>
                <SelectItem value="ETA_ASC">ETA (Earliest First)</SelectItem>
                <SelectItem value="ETA_DESC">ETA (Latest First)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-full pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
              onClick={clearFilters}
            >
              <RefreshCw className="h-3 w-3 mr-1.5" />
              Reset All Filters
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
