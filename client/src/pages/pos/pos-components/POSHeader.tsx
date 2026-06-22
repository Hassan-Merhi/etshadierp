import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { MapPin, ArrowLeft, FileDown, MoreHorizontal, Printer, Trash2, Pencil, Search, Eye, Plus } from "lucide-react";
import { Link } from "wouter";
import type { Location } from "./posTypes";

export interface POSHeaderProps {
  posUser: any;
  editVoucherId?: string;
  activeLocation: any;
  posAssignedLocations: Location[];
  posSelectedLocation: Location | null;
  setPosSelectedLocation: (loc: Location) => void;
  allLocations: Location[];
  setSelectedLocation: (loc: Location) => void;
  hasOpenShift: boolean;
  currentShift: any;
  showPosImport: boolean;
  onExportInventory: () => void;
  onImportClick: () => void;
  onShowStockReport: () => void;
  navigate: (path: string) => void;
}

export function POSHeader({
  posUser,
  editVoucherId,
  activeLocation,
  posAssignedLocations,
  posSelectedLocation,
  setPosSelectedLocation,
  allLocations,
  setSelectedLocation,
  hasOpenShift,
  currentShift,
  showPosImport,
  onExportInventory,
  onImportClick,
  onShowStockReport,
  navigate,
}: POSHeaderProps) {
  return (
    <PageHeader
      title={editVoucherId ? "Edit Transaction" : "Point of Sale"}
      description={activeLocation ? `Location: ${activeLocation.name} (${activeLocation.code})` : "Select a location to begin"}
      showBack={false}
      actions={
        <div className="flex items-center gap-2">
          {editVoucherId ? (
            <Button variant="outline" size="sm" onClick={() => navigate("/pos-daybook")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Daybook
            </Button>
          ) : (
            <>
              {posUser && posAssignedLocations.length > 1 && (
                <Select
                  value={posSelectedLocation?.id?.toString()}
                  onValueChange={(val) => {
                    const loc = posAssignedLocations.find(l => l.id.toString() === val);
                    if (loc) setPosSelectedLocation(loc);
                  }}
                >
                  <SelectTrigger className="w-[180px] h-9" data-testid="select-pos-location">
                    <SelectValue placeholder="Switch Location" />
                  </SelectTrigger>
                  <SelectContent>
                    {posAssignedLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id.toString()}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {!posUser && (
                <Select
                  value={activeLocation?.id?.toString()}
                  onValueChange={(val) => {
                    const loc = allLocations.find(l => l.id.toString() === val);
                    if (loc) setSelectedLocation(loc);
                  }}
                >
                  <SelectTrigger className="w-[180px] h-9" data-testid="select-admin-location">
                    <SelectValue placeholder="Switch Location" />
                  </SelectTrigger>
                  <SelectContent>
                    {allLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id.toString()}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {posUser && (
                <Badge variant={hasOpenShift ? "secondary" : "destructive"} className="h-9 px-3 gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${hasOpenShift ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`} />
                  {hasOpenShift ? "Shift Open" : "No Open Shift"}
                  {currentShift?.startTime && (
                    <span className="text-[10px] opacity-70 ml-1 font-normal">
                      since {new Date(currentShift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </Badge>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" data-testid="button-pos-options">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={onShowStockReport} className="gap-2 cursor-pointer">
                    <Eye className="h-4 w-4" />
                    Stock Report
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onExportInventory} className="gap-2 cursor-pointer">
                    <FileDown className="h-4 w-4" />
                    Export Inventory
                  </DropdownMenuItem>
                  {showPosImport && (
                    <DropdownMenuItem onClick={onImportClick} className="gap-2 cursor-pointer">
                      <Plus className="h-4 w-4" />
                      Import Sales
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/pos-daybook" className="flex items-center gap-2 w-full cursor-pointer">
                      <MoreHorizontal className="h-4 w-4" />
                      POS Daybook
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      }
    />
  );
}
