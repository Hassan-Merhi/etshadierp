import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Download, Plus, Wrench, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ContainerToolbarProps {
  isDeveloper: boolean;
  syncAllIsPending: boolean;
  onSyncAllClick: () => void;
  onExportExcel: () => void;
  onExportAllFull: () => void;
  isSupplierPartner: boolean;
  onAddDialogOpen: () => void;
}

export function ContainerToolbar({
  isDeveloper,
  syncAllIsPending,
  onSyncAllClick,
  onExportExcel,
  onExportAllFull,
  isSupplierPartner,
  onAddDialogOpen,
}: ContainerToolbarProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {isDeveloper && (
        <Button
          variant="outline"
          className="gap-2"
          onClick={onSyncAllClick}
          disabled={syncAllIsPending}
          data-testid="button-sync-all-vouchers"
        >
          {syncAllIsPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wrench className="h-4 w-4" />
          )}
          Fix All PO &amp; Parent JV Sync
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2" data-testid="button-export-dropdown">
            <Download className="h-4 w-4" />
            Export
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onExportExcel} data-testid="button-export-excel">
            <Download className="h-4 w-4 mr-2" />
            Export
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExportAllFull} data-testid="button-export-all-full">
            <Download className="h-4 w-4 mr-2" />
            Export All (Full)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isSupplierPartner ? (
        <Link href="/po-import">
          <Button className="gap-2" data-testid="button-add-container">
            <Plus className="h-4 w-4" />
            Import Container
          </Button>
        </Link>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-2" data-testid="button-add-dropdown">
              <Plus className="h-4 w-4" />
              Add
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddDialogOpen} data-testid="button-add-container">
              <Plus className="h-4 w-4 mr-2" />
              Add Container
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid="button-import-po">
              <Link href="/po-import" className="flex items-center">
                <Plus className="h-4 w-4 mr-2" />
                Import PO
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
