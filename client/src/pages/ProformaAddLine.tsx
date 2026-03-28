import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";

interface StockItem {
  id: number;
  code: string;
  name: string;
  weightPerBaleKg?: string | null;
  salePrice?: string | null;
  stockGroup?: { name: string } | null;
}

interface ProformaLine {
  id: number;
  articleCode: string;
  quantity: number;
  pricePerBale: string;
}

interface Proforma {
  id: number;
  name: string;
  customerId: number;
  lines: ProformaLine[];
}

export default function ProformaAddLine() {
  const { proformaId } = useParams<{ proformaId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const params = new URLSearchParams(window.location.search);
  const customerId = params.get("customerId") || "";
  const proformaName = params.get("proformaName") || "Proforma";

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [addedCodes, setAddedCodes] = useState<Set<string>>(new Set());

  const numericProformaId = parseInt(proformaId);

  const { data: allItems = [], isLoading: itemsLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: proforma } = useQuery<Proforma>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    select: (data: any) => {
      if (Array.isArray(data)) return data.find((p: Proforma) => p.id === numericProformaId) ?? null;
      return null;
    },
    enabled: !!customerId,
  });

  const existingCodes = useMemo(() => {
    const s = new Set<string>();
    proforma?.lines?.forEach((l) => s.add(l.articleCode));
    return s;
  }, [proforma]);

  const groups = useMemo(() => {
    const s = new Set<string>();
    allItems.forEach((it) => { if (it.stockGroup?.name) s.add(it.stockGroup.name); });
    return ["all", ...Array.from(s).sort()];
  }, [allItems]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allItems.filter((it) => {
      const matchGroup = groupFilter === "all" || it.stockGroup?.name === groupFilter;
      const matchSearch = !q || it.name?.toLowerCase().includes(q) || it.code?.toLowerCase().includes(q);
      return matchGroup && matchSearch;
    });
  }, [allItems, search, groupFilter]);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("No item selected");
      const res = await modeApiRequest("POST", "/api/factory/customer-proforma-lines", {
        proformaId: numericProformaId,
        articleCode: selectedItem.code,
        productName: selectedItem.name,
        quantity: parseInt(qty) || 1,
        pricePerBale: price,
        weightPerBaleKg: selectedItem.weightPerBaleKg || null,
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Failed to add line");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setAddedCodes((prev) => new Set([...prev, selectedItem!.code]));
      toast({ title: "Added", description: `${selectedItem!.name} added to proforma` });
      setSelectedItem(null);
      setQty("1");
      setPrice("");
    },
    onError: (e: any) => {
      if (e?._handledGlobally) return;
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const handleSelectItem = (item: StockItem) => {
    if (selectedItem?.id === item.id) {
      setSelectedItem(null);
      return;
    }
    setSelectedItem(item);
    setQty("1");
    setPrice(item.salePrice ? parseFloat(item.salePrice).toFixed(2) : "");
  };

  const goBack = () => {
    navigate(`/factory/sales/proformas${customerId ? `?customerId=${customerId}` : ""}`);
  };

  const isAdded = (item: StockItem) => addedCodes.has(item.code) || existingCodes.has(item.code);
  const isSelected = (item: StockItem) => selectedItem?.id === item.id;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={goBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Adding line to</p>
          <h1 className="text-sm font-semibold truncate">{proformaName}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={goBack} data-testid="button-done">
          Done
        </Button>
      </div>

      {/* Search + Group filters */}
      <div className="sticky top-[57px] z-10 bg-background border-b px-4 py-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or article code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
            data-testid="input-search"
          />
          {search && (
            <button className="absolute right-3 top-2.5" onClick={() => setSearch("")} data-testid="button-clear-search">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {groups.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setGroupFilter(g)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  groupFilter === g
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover-elevate"
                }`}
                data-testid={`button-group-${g}`}
              >
                {g === "all" ? "All" : g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Item count */}
      <div className="px-4 pt-2 pb-1">
        <p className="text-xs text-muted-foreground">
          {itemsLoading ? "Loading..." : `${filtered.length} item${filtered.length !== 1 ? "s" : ""}${search ? ` matching "${search}"` : ""}`}
        </p>
      </div>

      {/* Items grid — padded at bottom for the sticky bar */}
      <div className={`flex-1 overflow-y-auto px-4 pb-${selectedItem ? "44" : "6"}`}>
        {itemsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-24 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No items found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-2">
            {filtered.map((item) => {
              const added = isAdded(item);
              const selected = isSelected(item);
              const wt = item.weightPerBaleKg ? parseFloat(item.weightPerBaleKg) : null;
              return (
                <button
                  key={item.id}
                  onClick={() => !added && handleSelectItem(item)}
                  disabled={added}
                  className={`relative text-left rounded-md border p-3 transition-colors flex flex-col gap-1
                    ${added ? "opacity-50 cursor-default bg-muted" : "cursor-pointer"}
                    ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover-elevate"}
                  `}
                  data-testid={`button-item-${item.id}`}
                >
                  {added && (
                    <span className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-0.5">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  {selected && !added && (
                    <span className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-0.5">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <p className="text-sm font-medium leading-snug line-clamp-2 pr-5">{item.name}</p>
                  {item.code && (
                    <p className="text-xs font-mono text-muted-foreground">{item.code}</p>
                  )}
                  {wt !== null && (
                    <p className="text-xs text-muted-foreground mt-auto">{formatNumber(wt)} kg/bale</p>
                  )}
                  {item.salePrice && parseFloat(item.salePrice) > 0 && (
                    <p className="text-xs text-muted-foreground">${parseFloat(item.salePrice).toFixed(2)}</p>
                  )}
                  {item.stockGroup?.name && (
                    <Badge variant="secondary" className="text-xs mt-1 w-fit no-default-active-elevate">
                      {item.stockGroup.name}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky bottom panel when item selected */}
      {selectedItem && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-background border-t shadow-lg px-4 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{selectedItem.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{selectedItem.code}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={() => setSelectedItem(null)}
                data-testid="button-deselect"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Quantity (bales)</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && qty && price) addMutation.mutate(); }}
                  data-testid="input-qty"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Price per bale</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && qty && price) addMutation.mutate(); }}
                  data-testid="input-price"
                />
              </div>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={!qty || !price || addMutation.isPending}
                data-testid="button-add-line"
              >
                <Plus className="h-4 w-4 mr-1" />
                {addMutation.isPending ? "Adding..." : "Add"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
