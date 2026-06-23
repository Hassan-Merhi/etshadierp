import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  FileDown, MoreHorizontal, Eye, Upload, Download,
  FileText, FileSpreadsheet, Save, Check,
} from "lucide-react";
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
  lastAutosaved?: Date | null;
  drafts?: any[];
  onOpenDraftDialog?: () => void;
  onUpdateDraft?: () => void;
  onSummaryExport?: () => void;
  onDetailedExport?: () => void;
}

function useRelativeTime(date: Date | null | undefined) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!date) { setLabel(null); return; }
    const update = () => {
      const secs = Math.floor((Date.now() - date.getTime()) / 1000);
      if (secs < 10) setLabel("Autosaved just now");
      else if (secs < 60) setLabel(`Autosaved ${secs}s ago`);
      else setLabel(`Autosaved ${Math.floor(secs / 60)}m ago`);
    };
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, [date]);

  return label;
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
  lastAutosaved,
  drafts = [],
  onOpenDraftDialog,
  onUpdateDraft,
  onSummaryExport,
  onDetailedExport,
}: POSHeaderProps) {
  const autosaveLabel = useRelativeTime(lastAutosaved);

  return (
    <PageHeader title={editVoucherId ? "Edit Transaction" : "Point of Sale"}>
      {editVoucherId ? null : (
        <>
          {autosaveLabel && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {autosaveLabel}
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" data-testid="button-pos-options">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {showPosImport && (
                <DropdownMenuItem onClick={onImportClick} className="gap-2 cursor-pointer">
                  <Upload className="h-4 w-4" />
                  Import Sales
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={onOpenDraftDialog}
                className="gap-2 cursor-pointer"
                data-testid="button-load-draft"
              >
                <Download className="h-4 w-4" />
                Load Draft{drafts.length > 0 ? ` (${drafts.length})` : ""}
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={onUpdateDraft}
                className="gap-2 cursor-pointer"
                data-testid="button-update-draft"
              >
                <Save className="h-4 w-4" />
                Update Draft
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={onSummaryExport} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4" />
                Summary Export
              </DropdownMenuItem>

              <DropdownMenuItem onClick={onDetailedExport} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" />
                Detailed Export
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={onShowStockReport} className="gap-2 cursor-pointer">
                <Eye className="h-4 w-4" />
                Stock Report
              </DropdownMenuItem>

              <DropdownMenuItem onClick={onExportInventory} className="gap-2 cursor-pointer">
                <FileDown className="h-4 w-4" />
                Export Inventory
              </DropdownMenuItem>

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
              <Check className="h-4 w-4" />
              {editVoucherId ? "Update" : "Save"}
            </>
          )}
        </Button>
      )}
    </PageHeader>
  );
}
