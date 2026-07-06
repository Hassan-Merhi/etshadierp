import React from "react";
import { Search, Filter, ChevronDown, Truck, Check } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Container } from "@shared/schema";

interface OtwContainersTableProps {
  filteredOtwContainers: Container[];
  otwContainers: Container[];
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
  formatAmount: (n: number) => string;
  freightStatusMap: Record<number, { totalFreight: number; totalPaid: number; status: string }>;
  getEditValue: (container: Container, field: keyof Container) => any;
  setEditValue: (id: number, field: keyof Container, value: any) => Promise<void>;
  hasChanges: (id: number) => boolean;
  saveTracking: (id: number) => Promise<void>;
  savingIds: Set<number>;
  handleKeyDown: (e: React.KeyboardEvent, id: number, fieldIdx: number) => void;
  autoSizeStyle: (value: unknown, placeholder?: string, minCh?: number, maxCh?: number) => React.CSSProperties;
}

export function OtwContainersTable({
  filteredOtwContainers,
  otwContainers,
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
  formatAmount,
  freightStatusMap,
  getEditValue,
  setEditValue,
  hasChanges,
  saveTracking,
  savingIds,
  handleKeyDown,
  autoSizeStyle,
}: OtwContainersTableProps) {
  return (
    <div className="space-y-4">
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
              <SelectItem key={loc} value={loc}>
                {loc}
              </SelectItem>
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
              <SelectItem key={truck} value={truck}>
                {truck}
              </SelectItem>
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
              <SelectItem key={agent} value={agent}>
                {agent}
              </SelectItem>
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
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
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

      {filteredOtwContainers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Truck className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No OTW containers</h2>
            <p className="text-muted-foreground">
              {otwContainers.length === 0
                ? "All containers have arrived or been offloaded"
                : "No containers match your search"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead className="whitespace-nowrap">Container #</TableHead>
                  <TableHead className="whitespace-nowrap">Supplier</TableHead>
                  <TableHead className="whitespace-nowrap">Amount</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[100px]">Shop</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[130px]">ETA</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[120px]">Transporter</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[80px]">Fee</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[100px]">Plate</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[120px]">Location</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[130px]">Border</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[130px]">Offload</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[80px]">Agent</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[80px]">Duty</TableHead>
                  <TableHead className="whitespace-nowrap">Doc</TableHead>
                  <TableHead className="whitespace-nowrap">Freight</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[150px]">Description</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[130px]">Docs Sent</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[110px]">Freight (GIT)</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[160px]">Link</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOtwContainers.map((container) => (
                  <TableRow key={container.id} data-testid={`row-otw-${container.id}`}>
                    <TableCell className="font-mono font-medium">
                      <Link href={`/containers/${container.id}`} className="text-primary hover:underline">
                        {container.containerNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{getSupplierName(container.supplierId)}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatAmount(parseFloat(container.grandTotal || "0"))}
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-shopName`}
                        value={(getEditValue(container, "shopName") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "shopName", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 0)}
                        style={autoSizeStyle(getEditValue(container, "shopName"), "Shop", 6, 16)}
                        className="h-8 text-sm w-auto"
                        placeholder="Shop"
                        data-testid={`input-shop-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-eta`}
                        type="date"
                        value={(getEditValue(container, "eta") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "eta", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 1)}
                        style={autoSizeStyle(getEditValue(container, "eta"), "yyyy-mm-dd", 12, 12)}
                        className="h-8 text-sm w-auto"
                        data-testid={`input-eta-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-transporter`}
                        value={(getEditValue(container, "transporter") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "transporter", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 2)}
                        style={autoSizeStyle(getEditValue(container, "transporter"), "Transporter", 12, 40)}
                        className="h-8 text-sm w-auto"
                        placeholder="Transporter"
                        data-testid={`input-transporter-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-transportFee`}
                        type="number"
                        value={(getEditValue(container, "transportFee") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "transportFee", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 3)}
                        style={autoSizeStyle(getEditValue(container, "transportFee"), "0.00")}
                        className="h-8 text-sm w-auto"
                        placeholder="0.00"
                        data-testid={`input-transport-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-numberPlate`}
                        value={(getEditValue(container, "numberPlate") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "numberPlate", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 4)}
                        style={autoSizeStyle(getEditValue(container, "numberPlate"), "Plate", 10, 20)}
                        className="h-8 text-sm w-auto"
                        placeholder="Plate"
                        data-testid={`input-plate-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-trackingLocation`}
                        value={(getEditValue(container, "trackingLocation") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "trackingLocation", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 5)}
                        style={autoSizeStyle(getEditValue(container, "trackingLocation"), "Location", 12, 40)}
                        className="h-8 text-sm w-auto"
                        placeholder="Location"
                        data-testid={`input-location-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-borderDate`}
                        type="date"
                        value={(getEditValue(container, "borderDate") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "borderDate", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 6)}
                        style={autoSizeStyle(getEditValue(container, "borderDate"), "yyyy-mm-dd", 12, 12)}
                        className="h-8 text-sm w-auto"
                        data-testid={`input-border-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-offloadDate`}
                        type="date"
                        value={(getEditValue(container, "offloadDate") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "offloadDate", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 7)}
                        style={autoSizeStyle(getEditValue(container, "offloadDate"), "yyyy-mm-dd", 12, 12)}
                        className="h-8 text-sm w-auto"
                        data-testid={`input-offload-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-agent`}
                        value={(getEditValue(container, "agent") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "agent", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 8)}
                        style={autoSizeStyle(getEditValue(container, "agent"), "Agent")}
                        className="h-8 text-sm w-auto"
                        placeholder="Agent"
                        data-testid={`input-agent-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-dutyFee`}
                        type="number"
                        value={(getEditValue(container, "dutyFee") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "dutyFee", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 9)}
                        style={autoSizeStyle(getEditValue(container, "dutyFee"), "0.00")}
                        className="h-8 text-sm w-auto"
                        placeholder="0.00"
                        data-testid={`input-duty-${container.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        id={`tracking-${container.id}-docReceived`}
                        checked={!!getEditValue(container, "docReceived")}
                        onCheckedChange={(checked) => setEditValue(container.id, "docReceived", !!checked)}
                        data-testid={`checkbox-doc-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const fs = freightStatusMap[container.id];
                        if (!fs || fs.status === "NONE")
                          return <span className="text-xs text-muted-foreground">--</span>;
                        return (
                          <Badge
                            variant={
                              fs.status === "PAID"
                                ? "default"
                                : fs.status === "PARTIAL"
                                  ? "secondary"
                                  : "destructive"
                            }
                            data-testid={`badge-freight-${container.id}`}
                          >
                            {fs.status}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-trackingDescription`}
                        value={(getEditValue(container, "trackingDescription") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "trackingDescription", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 11)}
                        style={autoSizeStyle(getEditValue(container, "trackingDescription"), "Notes...", 10, 32)}
                        className="h-8 text-sm w-auto"
                        placeholder="Notes..."
                        data-testid={`input-desc-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-docsSentDate`}
                        type="date"
                        value={(getEditValue(container, "docsSentDate") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "docsSentDate", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 12)}
                        style={autoSizeStyle(getEditValue(container, "docsSentDate"), "yyyy-mm-dd", 12, 12)}
                        className="h-8 text-sm w-auto"
                        data-testid={`input-docs-sent-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        id={`tracking-${container.id}-freightStatus`}
                        value={(getEditValue(container, "freightStatus") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "freightStatus", e.target.value || null)}
                        className="h-8 text-sm rounded-md border border-input bg-background px-2 py-1"
                        data-testid={`select-freight-git-${container.id}`}
                      >
                        <option value="">—</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Pending">Pending</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input
                        id={`tracking-${container.id}-trackingLink`}
                        value={(getEditValue(container, "trackingLink") as string) || ""}
                        onChange={(e) => setEditValue(container.id, "trackingLink", e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, container.id, 13)}
                        style={autoSizeStyle(getEditValue(container, "trackingLink"), "https://...", 12, 32)}
                        className="h-8 text-sm w-auto"
                        placeholder="https://..."
                        data-testid={`input-link-${container.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      {hasChanges(container.id) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => saveTracking(container.id)}
                          disabled={savingIds.has(container.id)}
                          data-testid={`button-save-${container.id}`}
                        >
                          {savingIds.has(container.id) ? (
                            <span className="animate-spin">...</span>
                          ) : (
                            <Check className="h-4 w-4 text-green-600" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
