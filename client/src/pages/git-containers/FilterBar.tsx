import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { MultiFilterSelect } from "./MultiFilterSelect";
import { EtaDateFilter } from "./EtaDateFilter";
import type { EtaFilterValue } from "./gitContainerTypes";

interface FilterBarProps {
  showFilters: boolean;
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
  companies: string[];
  containerNumbers: string[];
  containerFilters: string[];
  setContainerFilters: (v: string[]) => void;
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
  etaFilter: EtaFilterValue;
  setEtaFilter: (v: EtaFilterValue) => void;
  allEtaDates: string[];
  hasContainersWithNoEta: boolean;
  notesFilter: string;
  setNotesFilter: (v: string) => void;
  sortOrder: string;
  setSortOrder: (v: string) => void;
  clearFilters: () => void;
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-widest mb-1 block">
      {children}
    </Label>
  );
}

export function FilterBar({
  showFilters,
  companyFilter,
  setCompanyFilter,
  companies,
  containerNumbers,
  containerFilters,
  setContainerFilters,
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
  allEtaDates,
  hasContainersWithNoEta,
  notesFilter,
  setNotesFilter,
  sortOrder,
  setSortOrder,
  clearFilters,
}: FilterBarProps) {
  if (!showFilters) return null;

  const activeCount = [
    companyFilter !== "ALL" ? 1 : 0,
    containerFilters.length,
    supplierFilters.length,
    transporterFilters.length,
    agentFilters.length,
    truckFilters.length,
    locationFilters.length,
    docsFilter !== "ALL" ? 1 : 0,
    delayedFilter !== "ALL" ? 1 : 0,
    freightFilter !== "ALL" ? 1 : 0,
    etaFilter !== "ALL" ? 1 : 0, // EtaFilterValue "ALL" means unfiltered
    notesFilter !== "ALL" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <Card className="border border-border/60 shadow-none rounded-md animate-in fade-in slide-in-from-top-2 duration-200">
      <CardContent className="p-3 space-y-3">
        {/* Row 1 — entity filters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <div>
            <FilterLabel>Company</FilterLabel>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-filter-company">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <FilterLabel>Container #</FilterLabel>
            <MultiFilterSelect
              allLabel="All Containers"
              options={containerNumbers.map((n) => ({ label: n, value: n }))}
              selected={containerFilters}
              onChange={setContainerFilters}
              testId="multi-filter-container"
              searchable
            />
          </div>

          <div>
            <FilterLabel>Supplier</FilterLabel>
            <MultiFilterSelect
              allLabel="All Suppliers"
              options={suppliers.map((s) => ({ label: s, value: s }))}
              selected={supplierFilters}
              onChange={setSupplierFilters}
              testId="multi-filter-supplier"
            />
          </div>

          <div>
            <FilterLabel>Transporter</FilterLabel>
            <MultiFilterSelect
              allLabel="All Transporters"
              options={transporters.map((t) => ({ label: t, value: t }))}
              selected={transporterFilters}
              onChange={setTransporterFilters}
              testId="multi-filter-transporter"
            />
          </div>

          <div>
            <FilterLabel>Agent</FilterLabel>
            <MultiFilterSelect
              allLabel="All Agents"
              options={agents.map((a) => ({ label: a, value: a }))}
              selected={agentFilters}
              onChange={setAgentFilters}
              testId="multi-filter-agent"
            />
          </div>

          <div>
            <FilterLabel>Truck</FilterLabel>
            <MultiFilterSelect
              allLabel="All Trucks"
              options={[
                { label: "With Truck #", value: "HAS_TRUCK" },
                { label: "No Truck #", value: "NO_TRUCK" },
                { label: "────────────────", value: "SEP", dividerBefore: true },
                ...trucks.map((t) => ({ label: t, value: t })),
              ]}
              selected={truckFilters}
              onChange={setTruckFilters}
              testId="multi-filter-truck"
            />
          </div>

          <div>
            <FilterLabel>Location</FilterLabel>
            <MultiFilterSelect
              allLabel="All Locations"
              options={[
                { label: "With Location", value: "HAS_LOCATION" },
                { label: "No Location", value: "NO_LOCATION" },
                { label: "────────────────", value: "SEP", dividerBefore: true },
                ...locations.map((l) => ({ label: l, value: l })),
              ]}
              selected={locationFilters}
              onChange={setLocationFilters}
              testId="multi-filter-location"
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/40" />

        {/* Row 2 — status/boolean filters + sort */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <FilterLabel>Docs</FilterLabel>
            <Select value={docsFilter} onValueChange={setDocsFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-filter-docs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="MISSING">Missing Docs</SelectItem>
                <SelectItem value="RECEIVED">Received Docs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-36">
            <FilterLabel>Delayed</FilterLabel>
            <Select value={delayedFilter} onValueChange={setDelayedFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-filter-delayed">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="YES">ETA Passed</SelectItem>
                <SelectItem value="OVERDUE">Offload Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-32">
            <FilterLabel>Freight</FilterLabel>
            <Select value={freightFilter} onValueChange={setFreightFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-filter-freight">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="HAS_FREIGHT">Paid Freight</SelectItem>
                <SelectItem value="NO_FREIGHT">No Freight</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-44">
            <FilterLabel>ETA</FilterLabel>
            <EtaDateFilter
              value={etaFilter}
              onChange={setEtaFilter}
              allEtaDates={allEtaDates}
              hasContainersWithNoEta={hasContainersWithNoEta}
              testId="select-filter-eta"
            />
          </div>

          <div className="w-32">
            <FilterLabel>Notes</FilterLabel>
            <Select value={notesFilter} onValueChange={setNotesFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-filter-notes">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="WITH">With Notes</SelectItem>
                <SelectItem value="WITHOUT">Without Notes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-40">
            <FilterLabel>Sort</FilterLabel>
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-filter-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">Default (Company + Shop)</SelectItem>
                <SelectItem value="ETA_ASC">ETA — Earliest First</SelectItem>
                <SelectItem value="ETA_DESC">ETA — Latest First</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5 text-muted-foreground"
              onClick={clearFilters}
              data-testid="button-reset-filters"
            >
              <RefreshCw className="h-3 w-3" />
              Reset{activeCount > 0 ? ` (${activeCount})` : ""}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
