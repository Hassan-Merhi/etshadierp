import React from "react";
import { Search, Filter, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface OtwContainerFiltersProps {
  otwSearchTerm: string;
  setOtwSearchTerm: (v: string) => void;
  otwSupplierFilter: string[];
  setOtwSupplierFilter: React.Dispatch<React.SetStateAction<string[]>>;
  otwLocationFilter: string;
  setOtwLocationFilter: (v: string) => void;
  otwTruckFilter: string;
  setOtwTruckFilter: (v: string) => void;
  otwAgentFilter: string;
  setOtwAgentFilter: (v: string) => void;
  otwTransporterFilter: string;
  setOtwTransporterFilter: (v: string) => void;
  otwDocReceivedFilter: string;
  setOtwDocReceivedFilter: (v: string) => void;
  otwFreightStatusFilter: string;
  setOtwFreightStatusFilter: (v: string) => void;
  otwNotesFilter: string;
  setOtwNotesFilter: (v: string) => void;
  uniqueOtwLocations: string[];
  uniqueOtwSuppliers: number[];
  uniqueOtwAgents: string[];
  uniqueOtwTransporters: string[];
  uniqueOtwTrucks: string[];
  getSupplierName: (id: number) => string;
}

export function OtwContainerFilters({
  otwSearchTerm,
  setOtwSearchTerm,
  otwSupplierFilter,
  setOtwSupplierFilter,
  otwLocationFilter,
  setOtwLocationFilter,
  otwTruckFilter,
  setOtwTruckFilter,
  otwAgentFilter,
  setOtwAgentFilter,
  otwTransporterFilter,
  setOtwTransporterFilter,
  otwDocReceivedFilter,
  setOtwDocReceivedFilter,
  otwFreightStatusFilter,
  setOtwFreightStatusFilter,
  otwNotesFilter,
  setOtwNotesFilter,
  uniqueOtwLocations,
  uniqueOtwSuppliers,
  uniqueOtwAgents,
  uniqueOtwTransporters,
  uniqueOtwTrucks,
  getSupplierName,
}: OtwContainerFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by container, shop, or agent..."
          value={otwSearchTerm}
          onChange={(e) => setOtwSearchTerm(e.target.value)}
          className="pl-10"
          data-testid="input-search-otw"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1" data-testid="select-otw-supplier">
            <Filter className="h-3.5 w-3.5" />
            {otwSupplierFilter.length === 0
              ? "All Suppliers"
              : otwSupplierFilter.length === 1
                ? getSupplierName(Number(otwSupplierFilter[0]))
                : `${otwSupplierFilter.length} Suppliers`}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[200px]">
          {uniqueOtwSuppliers.map((id) => {
            const val = id.toString();
            const checked = otwSupplierFilter.includes(val);
            return (
              <DropdownMenuItem
                key={id}
                className="flex items-center gap-2 cursor-pointer"
                onSelect={(e) => {
                  e.preventDefault();
                  setOtwSupplierFilter((prev) => (checked ? prev.filter((v) => v !== val) : [...prev, val]));
                }}
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="truncate">{getSupplierName(id)}</span>
              </DropdownMenuItem>
            );
          })}
          {otwSupplierFilter.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-muted-foreground text-xs cursor-pointer justify-center"
                onSelect={(e) => {
                  e.preventDefault();
                  setOtwSupplierFilter([]);
                }}
              >
                Clear selection
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Select value={otwLocationFilter} onValueChange={setOtwLocationFilter}>
        <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-otw-location">
          <SelectValue placeholder="Location" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Locations</SelectItem>
          {uniqueOtwLocations.map((loc) => (
            <SelectItem key={loc} value={loc}>{loc}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwTruckFilter} onValueChange={setOtwTruckFilter}>
        <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-otw-truck">
          <SelectValue placeholder="Truck #" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Trucks</SelectItem>
          {uniqueOtwTrucks.map((truck) => (
            <SelectItem key={truck} value={truck}>{truck}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwAgentFilter} onValueChange={setOtwAgentFilter}>
        <SelectTrigger className="w-full sm:w-[100px]" data-testid="select-otw-agent">
          <SelectValue placeholder="Agent" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Agents</SelectItem>
          {uniqueOtwAgents.map((agent) => (
            <SelectItem key={agent} value={agent}>{agent}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwTransporterFilter} onValueChange={setOtwTransporterFilter}>
        <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-otw-transporter">
          <SelectValue placeholder="Transporter" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Transporters</SelectItem>
          {uniqueOtwTransporters.map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwDocReceivedFilter} onValueChange={setOtwDocReceivedFilter}>
        <SelectTrigger className="w-full sm:w-[100px]" data-testid="select-otw-doc">
          <SelectValue placeholder="Doc" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Docs</SelectItem>
          <SelectItem value="YES">Doc Received</SelectItem>
          <SelectItem value="NO">No Doc</SelectItem>
        </SelectContent>
      </Select>

      <Select value={otwFreightStatusFilter} onValueChange={setOtwFreightStatusFilter}>
        <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-otw-freight">
          <SelectValue placeholder="Freight" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Freight</SelectItem>
          <SelectItem value="Yes">Freight Yes</SelectItem>
          <SelectItem value="No">Freight No</SelectItem>
          <SelectItem value="Pending">Pending</SelectItem>
          <SelectItem value="NONE">Not Set</SelectItem>
        </SelectContent>
      </Select>

      <Select value={otwNotesFilter} onValueChange={setOtwNotesFilter}>
        <SelectTrigger className="w-full sm:w-[110px]" data-testid="select-otw-notes">
          <SelectValue placeholder="Notes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Notes</SelectItem>
          <SelectItem value="WITH">Has Notes</SelectItem>
          <SelectItem value="WITHOUT">No Notes</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
