import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { Plus, X, Check, ChevronsUpDown, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Location } from "@shared/schema";

interface OffloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containerId: number;
  containerNumber: string;
  totalBales: number;
}

interface AdditionalCharge {
  id: string;
  description: string;
  amount: string;
  ledgerAccountId: string;
}

interface AccountComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  accounts: any[];
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}

function AccountCombobox({ value, onValueChange, accounts, placeholder = "Select account", disabled = false, testId }: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  
  const selectedAccount = accounts.find((account) => account.id.toString() === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
          data-testid={testId}
        >
          {selectedAccount ? selectedAccount.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.name}
                  onSelect={() => {
                    onValueChange(account.id.toString());
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === account.id.toString() ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {account.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface LocationComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  locations: Location[];
  placeholder?: string;
  testId?: string;
}

function LocationCombobox({ value, onValueChange, locations, placeholder = "Select location", testId }: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  
  const selectedLocation = locations.find((location) => location.id.toString() === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid={testId}
        >
          {selectedLocation ? selectedLocation.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search locations..." />
          <CommandList>
            <CommandEmpty>No location found.</CommandEmpty>
            <CommandGroup>
              {locations.map((location) => (
                <CommandItem
                  key={location.id}
                  value={location.name}
                  onSelect={() => {
                    onValueChange(location.id.toString());
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === location.id.toString() ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {location.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function OffloadDialog({
  open,
  onOpenChange,
  containerId,
  containerNumber,
  totalBales,
}: OffloadDialogProps) {
  const [_location, setLocation] = useLocation();
  const { toast } = useToast();
  const [locationId, setLocationId] = useState<number | null>(null);
  const [offloadDate, setOffloadDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [duties, setDuties] = useState("0");
  const [dutiesAccountId, setDutiesAccountId] = useState("");
  const [officeCharges, setOfficeCharges] = useState("0");
  const [officeChargesAccountId, setOfficeChargesAccountId] = useState("");
  const [officeChargesCashAccountId, setOfficeChargesCashAccountId] = useState("");
  const [transferCharges, setTransferCharges] = useState("0");
  const [transportFees, setTransportFees] = useState("0");
  const [transportAccountId, setTransportAccountId] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalCharge[]>([]);
  const [costCorrections, setCostCorrections] = useState<Record<number, string>>({});
  const [correctionSectionOpen, setCorrectionSectionOpen] = useState(false);

  useEffect(() => {
    setCostCorrections({});
    setCorrectionSectionOpen(false);
  }, [open, containerId, locationId]);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: open,
  });

  // Fetch container with PO data to get charges
  const { data: containerData } = useQuery<any>({
    queryKey: [`/api/containers/${containerId}`],
    enabled: open && !!containerId,
  });

  const containerStockItemIds = (() => {
    if (!containerData?.pos) return [];
    const ids = new Set<number>();
    for (const po of containerData.pos) {
      if (po.items) {
        for (const item of po.items) {
          if (item.stockItemId && item.stockItemId > 0) ids.add(item.stockItemId);
        }
      }
    }
    return Array.from(ids);
  })();

  const { data: inventoryRates = [] } = useQuery<any[]>({
    queryKey: ["/api/locations", locationId, "inventory-rates", containerStockItemIds.join(",")],
    queryFn: async () => {
      if (!locationId || containerStockItemIds.length === 0) return [];
      const res = await factoryApiRequest("GET", `/api/locations/${locationId}/inventory-rates?stockItemIds=${containerStockItemIds.join(",")}`);
      return res.json();
    },
    enabled: open && !!locationId && containerStockItemIds.length > 0,
  });

  const hasExistingInventory = inventoryRates.some((r: any) => parseFloat(r.quantity) > 0);

  // Calculate PO charges (freight, document charges, etc.) from charges array
  let poChargesTotal = 0;
  if (containerData?.charges && Array.isArray(containerData.charges)) {
    containerData.charges.forEach((charge: any) => {
      const amount = parseFloat(charge.amount || "0");
      if (amount > 0) {
        poChargesTotal += amount;
      }
    });
  }

  const manualCharges =
    parseFloat(duties || "0") +
    parseFloat(officeCharges || "0") +
    parseFloat(transferCharges || "0") +
    parseFloat(transportFees || "0") +
    additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || "0"), 0);

  const totalCharges = manualCharges + poChargesTotal;
  const additionalCostPerBale = totalBales > 0 ? totalCharges / totalBales : 0;

  const handleAddCharge = () => {
    setAdditionalCharges([
      ...additionalCharges,
      {
        id: Date.now().toString(),
        description: "",
        amount: "0",
        ledgerAccountId: "",
      },
    ]);
  };

  const handleRemoveCharge = (id: string) => {
    setAdditionalCharges(additionalCharges.filter((charge) => charge.id !== id));
  };

  const handleUpdateCharge = (id: string, field: keyof AdditionalCharge, value: string) => {
    setAdditionalCharges(
      additionalCharges.map((charge) =>
        charge.id === id ? { ...charge, [field]: value } : charge
      )
    );
  };

  const offloadMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) {
        throw new Error("Please select a location");
      }

      // Validate duties account if duties amount is set
      if (parseFloat(duties) > 0 && !dutiesAccountId) {
        throw new Error("Please select an account for duties");
      }

      // Validate office charges account if office charges are set
      if (parseFloat(officeCharges) > 0 && !officeChargesAccountId) {
        throw new Error("Please select an office charges account");
      }

      // Validate office charges cash account if office charges are set
      if (parseFloat(officeCharges) > 0 && !officeChargesCashAccountId) {
        throw new Error("Please select a cash account for office charges");
      }

      // Validate transport account if transport fees are set
      if (parseFloat(transportFees) > 0 && !transportAccountId) {
        throw new Error("Please select an account for transport fees");
      }

      // Validate additional charges
      for (const charge of additionalCharges) {
        if (parseFloat(charge.amount) > 0) {
          if (!charge.description) {
            throw new Error("Please provide a description for all additional charges");
          }
          if (!charge.ledgerAccountId) {
            throw new Error("Please select an account for all additional charges");
          }
        }
      }

      const response = await factoryApiRequest(
        "POST",
        `/api/containers/${containerId}/offload`,
        {
          locationId,
          offloadDate,
          duties: duties,
          dutiesAccountId: dutiesAccountId ? parseInt(dutiesAccountId) : null,
          officeCharges: officeCharges,
          officeChargesAccountId: officeChargesAccountId ? parseInt(officeChargesAccountId) : null,
          officeChargesCashAccountId: officeChargesCashAccountId ? parseInt(officeChargesCashAccountId) : null,
          transferCharges: transferCharges,
          transportFees: transportFees,
          transportAccountId: transportAccountId ? parseInt(transportAccountId) : null,
          additionalCharges: additionalCharges
            .filter((charge) => parseFloat(charge.amount) > 0)
            .map((charge) => ({
              description: charge.description,
              amount: parseFloat(charge.amount),
              ledgerAccountId: parseInt(charge.ledgerAccountId),
            })),
          inventoryCostCorrections: Object.entries(costCorrections)
            .filter(([, rate]) => parseFloat(rate) > 0)
            .map(([stockItemId, rate]) => ({
              stockItemId: parseInt(stockItemId),
              correctRate: parseFloat(rate),
            })),
        }
      );
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      // Invalidate stock item queries so stock query page updates automatically
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/stock-items/');
      }});
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      toast({
        title: "Container offloaded successfully",
        description: `Container ${containerNumber} has been offloaded to the selected location.`,
      });
      onOpenChange(false);
      setLocation("/containers");
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Offload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    offloadMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Offload Container {containerNumber}</DialogTitle>
          <DialogDescription>
            Enter the offload charges, select accounts, and choose a destination location. The additional cost per bale will be calculated and added to each item's rate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Offload Date */}
          <div className="space-y-2">
            <Label htmlFor="offload-date">Offload Date</Label>
            <Input
              id="offload-date"
              type="date"
              value={offloadDate}
              onChange={(e) => setOffloadDate(e.target.value)}
              data-testid="input-offload-date"
            />
          </div>

          {/* Duties Section */}
          <div className="space-y-2">
            <Label>Duties</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={duties}
                onChange={(e) => setDuties(e.target.value)}
                data-testid="input-duties"
              />
              <AccountCombobox
                value={dutiesAccountId}
                onValueChange={setDutiesAccountId}
                accounts={ledgerAccounts}
                placeholder="Select account"
                disabled={parseFloat(duties) === 0}
                testId="select-duties-account"
              />
            </div>
          </div>

          {/* Office Charges Section */}
          <div className="space-y-2">
            <Label>Office Charges</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={officeCharges}
                onChange={(e) => setOfficeCharges(e.target.value)}
                data-testid="input-office-charges"
              />
              <AccountCombobox
                value={officeChargesAccountId}
                onValueChange={setOfficeChargesAccountId}
                accounts={ledgerAccounts}
                placeholder="Office account"
                disabled={parseFloat(officeCharges) === 0}
                testId="select-office-charges-account"
              />
              <AccountCombobox
                value={officeChargesCashAccountId}
                onValueChange={setOfficeChargesCashAccountId}
                accounts={ledgerAccounts}
                placeholder="Cash account"
                disabled={parseFloat(officeCharges) === 0}
                testId="select-office-charges-cash-account"
              />
            </div>
          </div>

          {/* Transfer Charges */}
          <div className="space-y-2">
            <Label htmlFor="transfer-charges">Transfer Charges</Label>
            <Input
              id="transfer-charges"
              type="number"
              step="0.01"
              min="0"
              value={transferCharges}
              onChange={(e) => setTransferCharges(e.target.value)}
              data-testid="input-transfer-charges"
            />
          </div>

          {/* Transport Fees Section */}
          <div className="space-y-2">
            <Label>Transport Fees</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={transportFees}
                onChange={(e) => setTransportFees(e.target.value)}
                data-testid="input-transport-fees"
              />
              <AccountCombobox
                value={transportAccountId}
                onValueChange={setTransportAccountId}
                accounts={ledgerAccounts}
                placeholder="Select account"
                disabled={parseFloat(transportFees) === 0}
                testId="select-transport-account"
              />
            </div>
          </div>

          {/* Additional Charges Section */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label>Additional Charges (Optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCharge}
                className="gap-2"
                data-testid="button-add-charge"
              >
                <Plus className="h-4 w-4" />
                Add Charge
              </Button>
            </div>
            {additionalCharges.length > 0 && (
              <div className="space-y-2">
                {additionalCharges.map((charge) => (
                  <div key={charge.id} className="grid grid-cols-12 gap-2 items-start">
                    <Input
                      placeholder="Description"
                      value={charge.description}
                      onChange={(e) =>
                        handleUpdateCharge(charge.id, "description", e.target.value)
                      }
                      className="col-span-4"
                      data-testid={`input-charge-description-${charge.id}`}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Amount"
                      value={charge.amount}
                      onChange={(e) => handleUpdateCharge(charge.id, "amount", e.target.value)}
                      className="col-span-3"
                      data-testid={`input-charge-amount-${charge.id}`}
                    />
                    <div className="col-span-4">
                      <AccountCombobox
                        value={charge.ledgerAccountId}
                        onValueChange={(value) =>
                          handleUpdateCharge(charge.id, "ledgerAccountId", value)
                        }
                        accounts={ledgerAccounts}
                        placeholder="Select account"
                        testId={`select-charge-account-${charge.id}`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCharge(charge.id)}
                      className="col-span-1"
                      data-testid={`button-remove-charge-${charge.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Destination Location */}
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="location">Destination Location</Label>
            <LocationCombobox
              value={locationId?.toString() || ""}
              onValueChange={(value) => setLocationId(parseInt(value))}
              locations={locations}
              placeholder="Select a location"
              testId="select-location"
            />
          </div>

          {/* Inventory Cost Correction (Advanced) */}
          {hasExistingInventory && locationId && (
            <Collapsible
              open={correctionSectionOpen}
              onOpenChange={setCorrectionSectionOpen}
              className="space-y-2 pt-2 border-t"
            >
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-between gap-2"
                  data-testid="button-toggle-cost-correction"
                >
                  <span className="text-sm font-medium">Inventory Cost Correction (Advanced)</span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", correctionSectionOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Use the closing rate from your monthly location summary to correct existing inventory costs before offloading.
                </p>
                {inventoryRates
                  .filter((r: any) => parseFloat(r.quantity) > 0)
                  .map((r: any) => (
                    <div key={r.stockItemId} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium" data-testid={`text-correction-item-${r.stockItemId}`}>{r.stockItemName}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <div>
                          <span>Qty: </span>
                          <span className="font-medium" data-testid={`text-correction-qty-${r.stockItemId}`}>{formatNumber(parseFloat(r.quantity), 0)}</span>
                        </div>
                        <div>
                          <span>Avg Rate: </span>
                          <span className="font-medium" data-testid={`text-correction-rate-${r.stockItemId}`}>${formatNumber(parseFloat(r.averageRate))}</span>
                        </div>
                        <div>
                          <span>Total: </span>
                          <span className="font-medium">${formatNumber(parseFloat(r.totalValue))}</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Correct rate to ($ per unit)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Leave empty to keep current rate"
                          value={costCorrections[r.stockItemId] || ""}
                          onChange={(e) => setCostCorrections(prev => ({
                            ...prev,
                            [r.stockItemId]: e.target.value,
                          }))}
                          data-testid={`input-correct-rate-${r.stockItemId}`}
                        />
                      </div>
                    </div>
                  ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Calculation Summary */}
          <div className="rounded-md border p-4 space-y-2 bg-muted/50">
            <h4 className="font-semibold text-sm">Calculation Summary</h4>
            <div className="space-y-2 text-sm">
              {manualCharges > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Manual Charges:</span>
                  <span className="font-medium">${formatNumber(manualCharges)}</span>
                </div>
              )}
              {poChargesTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PO Charges (Freight, Document Charges, etc.):</span>
                  <span className="font-medium">${formatNumber(poChargesTotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-2">
                <span className="text-muted-foreground">Total Charges:</span>
                <span data-testid="text-total-charges">
                  ${formatNumber(totalCharges)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bales:</span>
                <span className="font-medium" data-testid="text-total-bales">
                  {formatNumber(totalBales)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <span className="text-muted-foreground">Additional Cost per Bale:</span>
                <span className="font-semibold" data-testid="text-cost-per-bale">
                  ${formatNumber(additionalCostPerBale)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={offloadMutation.isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={offloadMutation.isPending || !locationId}
              data-testid="button-offload"
            >
              {offloadMutation.isPending ? "Offloading..." : "Offload Container"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
