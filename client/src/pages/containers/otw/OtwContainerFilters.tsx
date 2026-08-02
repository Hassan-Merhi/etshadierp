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
import { useErpText } from "@/i18n/modules/erp";

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
  const tUi = useErpText();
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={tUi("search.by.container.shop.or.agent")}
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
          <SelectValue placeholder={tUi("location")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.locations")}</SelectItem>
          {uniqueOtwLocations.map((loc) => (
            <SelectItem key={loc} value={loc}>
              {loc}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwTruckFilter} onValueChange={setOtwTruckFilter}>
        <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-otw-truck">
          <SelectValue placeholder={tUi("truck")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.trucks")}</SelectItem>
          {uniqueOtwTrucks.map((truck) => (
            <SelectItem key={truck} value={truck}>
              {truck}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwAgentFilter} onValueChange={setOtwAgentFilter}>
        <SelectTrigger className="w-full sm:w-[100px]" data-testid="select-otw-agent">
          <SelectValue placeholder={tUi("agent")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.agents")}</SelectItem>
          {uniqueOtwAgents.map((agent) => (
            <SelectItem key={agent} value={agent}>
              {agent}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwTransporterFilter} onValueChange={setOtwTransporterFilter}>
        <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-otw-transporter">
          <SelectValue placeholder={tUi("transporter")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.transporters")}</SelectItem>
          {uniqueOtwTransporters.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={otwDocReceivedFilter} onValueChange={setOtwDocReceivedFilter}>
        <SelectTrigger className="w-full sm:w-[100px]" data-testid="select-otw-doc">
          <SelectValue placeholder={tUi("doc")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.docs")}</SelectItem>
          <SelectItem value="YES">{tUi("doc.received")}</SelectItem>
          <SelectItem value="NO">{tUi("no.doc")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={otwFreightStatusFilter} onValueChange={setOtwFreightStatusFilter}>
        <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-otw-freight">
          <SelectValue placeholder={tUi("freight")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.freight")}</SelectItem>
          <SelectItem value="Yes">{tUi("freight.yes")}</SelectItem>
          <SelectItem value="No">{tUi("freight.no")}</SelectItem>
          <SelectItem value="Pending">{tUi("pending")}</SelectItem>
          <SelectItem value="NONE">{tUi("not.set")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={otwNotesFilter} onValueChange={setOtwNotesFilter}>
        <SelectTrigger className="w-full sm:w-[110px]" data-testid="select-otw-notes">
          <SelectValue placeholder={tUi("notes")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{tUi("all.notes")}</SelectItem>
          <SelectItem value="WITH">{tUi("has.notes")}</SelectItem>
          <SelectItem value="WITHOUT">{tUi("no.notes")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
