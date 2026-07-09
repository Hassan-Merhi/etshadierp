import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StockMovementDialog } from "./StockMovementDialog";
import type { InventoryLocation as Location } from "./locationInventoryTypes";

interface LocationDialogsProps {
  // Rename Dialog
  renameDialogOpen: boolean;
  setRenameDialogOpen: (o: boolean) => void;
  renamingLocation: Location | null;
  renameInput: string;
  setRenameInput: (s: string) => void;
  renameDeductionInput: string;
  setRenameDeductionInput: (s: string) => void;
  renameLocationMutation: any;

  // Delete Dialog
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (o: boolean) => void;
  isDeleting: boolean;
  handleDeleteLocation: () => void;
  selectedLocationLocal: Location | null;

  // Archive Dialog
  archiveDialogOpen: boolean;
  setArchiveDialogOpen: (o: boolean) => void;
  isArchiving: boolean;
  handleArchiveStockGroup: () => void;
  selectedGroup: any;

  // WhatsApp Dialog
  waGroupDialogOpen: boolean;
  setWaGroupDialogOpen: (o: boolean) => void;
  waChats: any[];
  waChatsLoading: boolean;
  waGroupSearch: string;
  setWaGroupSearch: (s: string) => void;
  waGroupSelectedId: string;
  setWaGroupSelectedId: (s: string) => void;
  waGroupMutation: any;
  waGroupLocation: Location | null;

  // Stock Movement Dialog
  stockMovementOpen: boolean;
  setStockMovementOpen: (o: boolean) => void;
  stockMovementItem: any;
  setStockMovementItem: (item: any) => void;
  stockMovementPeriod: any;
  setStockMovementPeriod: (p: any) => void;
  drillMonth: any;
  setDrillMonth: (m: any) => void;
  formatAmount: (amt: number) => string;
  navigate: (path: string) => void;
}

export function LocationDialogs({
  renameDialogOpen,
  setRenameDialogOpen,
  renamingLocation,
  renameInput,
  setRenameInput,
  renameDeductionInput,
  setRenameDeductionInput,
  renameLocationMutation,
  deleteDialogOpen,
  setDeleteDialogOpen,
  isDeleting,
  handleDeleteLocation,
  selectedLocationLocal,
  archiveDialogOpen,
  setArchiveDialogOpen,
  isArchiving,
  handleArchiveStockGroup,
  selectedGroup,
  waGroupDialogOpen,
  setWaGroupDialogOpen,
  waChats,
  waChatsLoading,
  waGroupSearch,
  setWaGroupSearch,
  waGroupSelectedId,
  setWaGroupSelectedId,
  waGroupMutation,
  waGroupLocation,
  stockMovementOpen,
  setStockMovementOpen,
  stockMovementItem,
  setStockMovementItem,
  stockMovementPeriod,
  setStockMovementPeriod,
  drillMonth,
  setDrillMonth,
  formatAmount,
  navigate,
}: LocationDialogsProps) {
  // Fetch stock movement data inside the component if needed, or pass it as prop
  return (
    <>
      {/* Rename Location Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Location</DialogTitle>
            <DialogDescription>Update the name and settings for this location.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename-input">Location Name</Label>
              <Input
                id="rename-input"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                placeholder="Enter new name"
                data-testid="input-rename-location"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deduction-input">Supplier Partner Deduction (per BL)</Label>
              <Input
                id="deduction-input"
                type="number"
                step="0.01"
                value={renameDeductionInput}
                onChange={(e) => setRenameDeductionInput(e.target.value)}
                placeholder="0.00"
                data-testid="input-rename-deduction"
              />
              <p className="text-[10px] text-muted-foreground">
                Amount automatically deducted from SP payables for this location.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                renameLocationMutation.mutate({
                  id: renamingLocation!.id,
                  name: renameInput,
                  supplierPartnerPayableDeductionPerQty: parseFloat(renameDeductionInput),
                })
              }
              disabled={renameLocationMutation.isPending || !renameInput.trim()}
              data-testid="button-confirm-rename"
            >
              {renameLocationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Location Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedLocationLocal?.name}</strong>? This will also delete all
              associated inventory records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteLocation();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-location"
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Stock Group Dialog */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Stock Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive the group <strong>{selectedGroup?.groupName}</strong> from{" "}
              <strong>{selectedLocationLocal?.name}</strong>? This will remove all items in this group from this godown.
              You can restore them later from the Orphaned Records page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleArchiveStockGroup();
              }}
              disabled={isArchiving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-archive-group"
            >
              {isArchiving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Archive Group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* WhatsApp Group Dialog */}
      <Dialog open={waGroupDialogOpen} onOpenChange={setWaGroupDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>WhatsApp Group Assignment</DialogTitle>
            <DialogDescription>
              Select the WhatsApp group where stock PDFs for <strong>{waGroupLocation?.name}</strong> should be sent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Input
                placeholder="Search groups..."
                value={waGroupSearch}
                onChange={(e) => setWaGroupSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="max-h-60 overflow-y-auto border rounded-md p-1 space-y-1">
              {waChatsLoading ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : waChats.filter((c) => c.name.toLowerCase().includes(waGroupSearch.toLowerCase())).length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No groups found</div>
              ) : (
                waChats
                  .filter((c) => c.name.toLowerCase().includes(waGroupSearch.toLowerCase()))
                  .map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => setWaGroupSelectedId(chat.id)}
                      className={cn(
                        "flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors",
                        waGroupSelectedId === chat.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      )}
                    >
                      <span className="text-sm font-medium">{chat.name}</span>
                      {waGroupSelectedId === chat.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  ))
              )}
            </div>
            {waGroupSelectedId && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive"
                onClick={() => setWaGroupSelectedId("")}
              >
                Clear selection / Unlink group
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaGroupDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                waGroupMutation.mutate({
                  id: waGroupLocation!.id,
                  name: waGroupLocation!.name,
                  whatsappGroupChatId: waGroupSelectedId || null,
                })
              }
              disabled={waGroupMutation.isPending}
              data-testid="button-confirm-wa-group"
            >
              {waGroupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Movement Dialog */}
      <StockMovementDialog
        stockMovementOpen={stockMovementOpen}
        setStockMovementOpen={setStockMovementOpen}
        stockMovementItem={stockMovementItem}
        setStockMovementItem={setStockMovementItem}
        stockMovementPeriod={stockMovementPeriod}
        setStockMovementPeriod={setStockMovementPeriod}
        drillMonth={drillMonth}
        setDrillMonth={setDrillMonth}
        formatAmount={formatAmount}
        navigate={navigate}
      />
    </>
  );
}

function fmtQ(n: number) {
  return n === 0 ? (
    <span className="opacity-30">—</span>
  ) : (
    <>{n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</>
  );
}
function fmtR(n: number) {
  return n === 0 ? (
    <span className="opacity-30">—</span>
  ) : (
    <>{n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
  );
}
