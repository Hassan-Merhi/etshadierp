import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Package, Eye, Search, X } from "lucide-react";
import { AddContainerDialog } from "../../components/AddContainerDialog";
import type { Container, Supplier } from "@shared/schema";

interface ContainerSpViewProps {
  spContainersList: any[];
  allContainers: Container[];
  suppliers: Supplier[];
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  isSpLoading: boolean;
  addDialogOpen: boolean;
  setAddDialogOpen: (v: boolean) => void;
  setLocation: (path: string) => void;
  formatDisplayDate: (date: string) => string;
}

export function ContainerSpView({
  spContainersList,
  allContainers,
  suppliers,
  searchTerm,
  setSearchTerm,
  isSpLoading,
  addDialogOpen,
  setAddDialogOpen,
  setLocation,
  formatDisplayDate,
}: ContainerSpViewProps) {
  // Normalize sp_containers rows to a common display shape
  const spNative: any[] = (Array.isArray(spContainersList) ? spContainersList : []).map((c) => ({
    _key: `sp-${c.id}`,
    id: c.id,
    _source: "sp",
    displayName: c.invoiceNumber || c.containerNumber || `#${c.id}`,
    subName: c.containerNumber && c.invoiceNumber ? c.containerNumber : null,
    supplierName: c.supplierName ?? "",
    statusLabel: c.status === "offloaded" ? "Offloaded" : "Open / OTW",
    statusOffloaded: c.status === "offloaded",
    date: c.invoiceDate,
    dateLabel: "Invoice Date",
    totalUsd: parseFloat(c.invoiceTotalUsd ?? "0"),
  }));

  // Normalize regular containers (from PO Import) to same shape
  const erpNormalized: any[] = allContainers.map((c) => {
    const sup = suppliers.find((s: any) => s.id === c.supplierId);
    const isOffloaded = c.status === "OFFLOADED";
    return {
      _key: `erp-${c.id}`,
      id: c.id,
      _source: "erp",
      displayName: c.containerNumber,
      subName: null,
      supplierName: (sup as any)?.legalName ?? (sup as any)?.name ?? "",
      statusLabel: isOffloaded ? "Offloaded" : c.status === "OTW" ? "On The Way" : c.status,
      statusOffloaded: isOffloaded,
      date: c.importDate,
      dateLabel: "Import Date",
      totalUsd: parseFloat(c.grandTotal ?? "0"),
    };
  });

  const spSearch = searchTerm.toLowerCase();
  const allSpItems = [...spNative, ...erpNormalized];
  const filtered = allSpItems.filter(
    (c) =>
      !spSearch ||
      (c.displayName ?? "").toLowerCase().includes(spSearch) ||
      (c.subName ?? "").toLowerCase().includes(spSearch) ||
      (c.supplierName ?? "").toLowerCase().includes(spSearch)
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Container Tracking" subtitle="Supplier partner containers">
        <div className="flex gap-2 flex-wrap">
          <Button className="gap-2" onClick={() => setAddDialogOpen(true)} data-testid="button-add-container">
            <Plus className="h-4 w-4" />
            Import Container
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by invoice, container, supplier…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-container"
          />
        </div>
        {searchTerm && (
          <Button variant="ghost" size="sm" onClick={() => setSearchTerm("")} data-testid="button-clear-search">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {isSpLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {allSpItems.length === 0
              ? "No containers yet. Click Import Container to add one."
              : "No containers match your search."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c: any) => (
            <div
              key={c._key}
              className="flex items-center gap-4 p-4 rounded-md border border-border bg-card hover-elevate cursor-pointer"
              onClick={() =>
                setLocation(c._source === "erp" ? `/containers/${c.id}?src=erp` : `/containers/${c.id}`)
              }
              data-testid={`row-sp-container-${c.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{c.displayName}</span>
                  {c.subName && <span className="text-xs text-muted-foreground font-mono">{c.subName}</span>}
                  <Badge
                    variant="outline"
                    className={
                      c.statusOffloaded ? "text-green-600 border-green-600/40" : "text-blue-600 border-blue-600/40"
                    }
                  >
                    {c.statusLabel}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.supplierName}</p>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xs text-muted-foreground">{c.dateLabel}</p>
                <p className="text-sm font-mono">{formatDisplayDate(c.date)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground hidden sm:block">Total (USD)</p>
                <p className="text-sm font-mono font-semibold">
                  ${c.totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <Link
                href={c._source === "erp" ? `/containers/${c.id}?src=erp` : `/containers/${c.id}`}
                onClick={(e) => e.stopPropagation()}
              >
                <Button size="sm" variant="outline" data-testid={`button-view-sp-${c.id}`}>
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}

      <AddContainerDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} isSP={true} />
    </div>
  );
}
