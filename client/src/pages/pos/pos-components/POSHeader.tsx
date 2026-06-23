import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FileDown, MoreHorizontal, Eye, Plus, Save } from "lucide-react";
import { Link } from "wouter";

export interface POSHeaderProps {
  posUser: any;
  editVoucherId?: string;
  activeLocation: any;
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
  editVoucherId,
  showPosImport,
  onExportInventory,
  onImportClick,
  onShowStockReport,
  saveMutation,
  hasValidItems,
  handleSaveSale,
}: POSHeaderProps) {
  return (
    <PageHeader title={editVoucherId ? "Edit Transaction" : "Point of Sale"}>
      {editVoucherId ? null : (
        <>
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
    </PageHeader>
  );
}
