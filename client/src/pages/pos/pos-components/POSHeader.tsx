import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { FileDown, MoreHorizontal, Eye, Plus, Save } from "lucide-react";
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
  saveMutation?: any;
  hasValidItems?: boolean;
  handleSaveSale?: () => void;
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
  saveMutation,
  hasValidItems,
  handleSaveSale,
}: POSHeaderProps) {
  return (
    <PageHeader
      title={editVoucherId ? "Edit Transaction" : "Point of Sale"}
      showBack={!!editVoucherId}
      onBack={() => navigate("/pos-daybook")}
      actions={
        <div className="flex items-center gap-2">
          {editVoucherId ? null : (
            <>
              {posUser && posAssignedLocations.length > 1 && (
                <Select
                  value={posSelectedLocation?.id?.toString()}
                  onValueChange={(val) => {
                    const loc = posAssignedLocations.find(l => l.id.toString() === val);
                    if (loc) setPosSelectedLocation(loc);
                  }}
                >
                  <SelectTrigger className="w-[180px]" data-testid="select-pos-location">
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
                  <Button variant="outline" size="icon" data-testid="button-pos-options">
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

          {handleSaveSale && (
            <Button
              onClick={handleSaveSale}
              disabled={saveMutation?.isPending || !hasValidItems}
              className="gap-2"
              data-testid="button-save-sale"
            >
              {saveMutation?.isPending ? (
                "Saving..."
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {editVoucherId ? "Update" : "Save"}
                </>
              )}
            </Button>
          )}
        </div>
      }
    />
  );
}
