import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { InventoryLocation as Location } from "./locationInventoryTypes";

interface UseLocationInventoryMutationsParams {
  toast: (opts: any) => void;
  selectedLocationLocal: Location | null;
  setSelectedLocationLocal: (loc: Location | null) => void;
  setRenameDialogOpen: (open: boolean) => void;
  setCreateLocationOpen: (open: boolean) => void;
  setCreateLocationName: (name: string) => void;
  setWaGroupDialogOpen: (open: boolean) => void;
}

export function useLocationInventoryMutations({
  toast,
  selectedLocationLocal,
  setSelectedLocationLocal,
  setRenameDialogOpen,
  setCreateLocationOpen,
  setCreateLocationName,
  setWaGroupDialogOpen,
}: UseLocationInventoryMutationsParams) {
  const renameLocationMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      supplierPartnerPayableDeductionPerQty,
    }: {
      id: number;
      name: string;
      supplierPartnerPayableDeductionPerQty?: number;
    }) => {
      const payload: Record<string, any> = { name };
      if (supplierPartnerPayableDeductionPerQty !== undefined)
        payload.supplierPartnerPayableDeductionPerQty = supplierPartnerPayableDeductionPerQty;
      const res = await apiRequest("PATCH", `/api/locations/${id}`, payload);
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: "Location renamed", description: `Renamed to "${updated.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) setSelectedLocationLocal(updated);
      setRenameDialogOpen(false);
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const createLocationMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/locations", { name });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Location created" });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setCreateLocationOpen(false);
      setCreateLocationName("");
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const waGroupMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      whatsappGroupChatId,
    }: {
      id: number;
      name: string;
      whatsappGroupChatId: string | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, { name, whatsappGroupChatId });
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: updated.whatsappGroupChatId ? "WhatsApp group assigned" : "WhatsApp group removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) setSelectedLocationLocal(updated);
      setWaGroupDialogOpen(false);
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  return { renameLocationMutation, createLocationMutation, waGroupMutation };
}
