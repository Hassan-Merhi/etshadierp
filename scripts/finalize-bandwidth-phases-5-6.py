#!/usr/bin/env python3
from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, source: str) -> None:
    Path(path).write_text(source)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    if old not in source:
        raise RuntimeError(f"Could not find {label}")
    return source.replace(old, new, 1)


# Remove integration-only unused symbols and ensure list mutations refetch the whole query family.
path = "client/src/pages/GITContainers.tsx"
source = read(path)
source = source.replace("import { useState, useMemo, useEffect, useRef, ChangeEvent } from \"react\";", "import { useState, useEffect, useRef, ChangeEvent } from \"react\";")
source = source.replace("  GitContainersResponse,\n", "")
write(path, source)

path = "server/routes/git/gitReportRoutes.ts"
source = read(path).replace(
    "      const { page, pageSize, offset } = parseGitPagination(listingQuery);",
    "      const { page, pageSize } = parseGitPagination(listingQuery);",
)
write(path, source)

path = "server/routes/git/gitListingProfiles.ts"
source = read(path)
pattern = r"export function toGitCompactRow\(row: EnrichedContainer\) \{.*?\n\}"
replacement = '''export function toGitCompactRow(row: EnrichedContainer) {
  const compact: Record<string, unknown> = { ...row };
  for (const key of [
    "trackingProvider",
    "trackingEnabled",
    "trackingAutoUpdate",
    "trackingCarrierHint",
    "trackingLastCheckedAt",
    "trackingLastStatus",
    "trackingLastLocation",
    "trackingLastEventDate",
    "trackingLastDescription",
    "trackingError",
    "trackingChangedAt",
    "trackingDetectedCarrier",
    "trackingFallbackUsed",
    "trackingFallbackReason",
    "trackingNextCheckAt",
    "trackingLastSkipReason",
    "trackingLink",
    "createdAt",
  ]) {
    delete compact[key];
  }
  return compact;
}'''
source, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
if count != 1:
    raise RuntimeError("Could not finalize compact container projection")
write(path, source)

path = "client/src/pages/git-containers/ContainerDrawer.tsx"
source = read(path)
old_effect = '''  useEffect(() => {
    if (open && container && container.id !== lastId) {
      setForm(seedForm(container));
      setTrackEnabled(container.trackingEnabled ?? false);
      setTrackAutoUpdate(container.trackingAutoUpdate ?? true);
      setTrackCarrierHint(container.trackingCarrierHint ?? "");
      setLastId(container.id);
    }
  }, [open, container?.id, lastId]);'''
new_effect = '''  useEffect(() => {
    if (open && container) {
      setForm(seedForm(container));
      setTrackEnabled(container.trackingEnabled ?? false);
      setTrackAutoUpdate(container.trackingAutoUpdate ?? true);
      setTrackCarrierHint(container.trackingCarrierHint ?? "");
      setLastId(container.id);
    }
  }, [open, container]);'''
source = replace_once(source, old_effect, new_effect, "drawer detail hydration")
source = source.replace(
    'queryClient.invalidateQueries({ queryKey: [queryKey] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/git/containers"] });',
)
write(path, source)

# The new voucher-detail helper owns these references; keep the route import surface compact.
path = "server/routes/vouchers/voucherQueryRoutes.ts"
source = read(path)
old_import = '''import {
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  vouchers,
  posShifts,
  salesItems,
  userLocations,
} from "@shared/schema";'''
new_import = '''import { containers, vouchers, posShifts, userLocations } from "@shared/schema";'''
source = replace_once(source, old_import, new_import, "voucher route import cleanup")
write(path, source)

# Remove the remaining purchase-list full scan from the Daybook view endpoint.
path = "server/routes/voucher-entries/reads.ts"
source = read(path)
source = replace_once(
    source,
    "  salesItems,\n  locations,\n",
    "  salesItems,\n  purchaseOrders,\n  locations,\n",
    "purchase order schema import",
)
old_purchase_lookup = '''        // Find the purchase order linked to this voucher
        const allPOs = await storage.getAllPurchaseOrders(voucher.companyId);
        const purchaseOrder = allPOs.find((po: any) => po.voucherId === id);'''
new_purchase_lookup = '''        // Resolve only the purchase order linked to this voucher instead of loading
        // every purchase order for the company.
        const purchaseOrder = await db.query.purchaseOrders.findFirst({
          where: eq(purchaseOrders.voucherId, id),
        });'''
source = replace_once(source, old_purchase_lookup, new_purchase_lookup, "direct purchase voucher lookup")
old_party_lookup = '''            // Get supplier info (use legalName field from suppliers table)
            const supplier = await storage.getSupplierById(purchaseOrder.supplierId);
            const supplierName = supplier?.legalName || "Unknown Supplier";
            const supplierCode = supplier?.code || "";

            // Get container info
            const container = await storage.getContainerById(purchaseOrder.containerId);
            const containerNumber = container?.containerNumber || "";'''
new_party_lookup = '''            // Supplier and container are independent references; resolve them together.
            const [supplier, container] = await Promise.all([
              storage.getSupplierById(purchaseOrder.supplierId),
              storage.getContainerById(purchaseOrder.containerId),
            ]);
            const supplierName = supplier?.legalName || "Unknown Supplier";
            const supplierCode = supplier?.code || "";
            const containerNumber = container?.containerNumber || "";'''
source = replace_once(source, old_party_lookup, new_party_lookup, "parallel purchase references")
write(path, source)

# Preserve full Daybook export while the interactive table stays paginated.
path = "client/src/pages/daybook/usePaginatedDaybookVouchers.ts"
source = read(path)
old_return = '''  return {
    ...query,
    queryUrl,
    response: query.data,
    vouchers: query.data?.data ?? [],
  };'''
new_return = '''  const loadAllVouchers = async (): Promise<Voucher[]> => {
    const url = new URL(queryUrl, window.location.origin);
    url.searchParams.delete("profile");
    url.searchParams.delete("page");
    url.searchParams.delete("pageSize");
    const response = await fetch(`${url.pathname}?${url.searchParams.toString()}`, { credentials: "include" });
    if (!response.ok) throw new Error("Failed to load complete Daybook export");
    return response.json();
  };

  return {
    ...query,
    queryUrl,
    response: query.data,
    vouchers: query.data?.data ?? [],
    loadAllVouchers,
  };'''
source = replace_once(source, old_return, new_return, "complete Daybook export loader")
write(path, source)

path = "client/src/pages/Daybook.tsx"
source = read(path)
source = replace_once(
    source,
    '  const { response: voucherPageResponse, vouchers, isLoading } = usePaginatedDaybookVouchers({',
    '  const { response: voucherPageResponse, vouchers, isLoading, loadAllVouchers } = usePaginatedDaybookVouchers({',
    "Daybook export loader destructure",
)
old_export = '''  const handleExportToExcel = async () => {
    const data = filteredVouchers.map((v) => ({'''
new_export = '''  const handleExportToExcel = async () => {
    const exportVouchers = await loadAllVouchers();
    const data = exportVouchers.map((v) => ({'''
source = replace_once(source, old_export, new_export, "full Daybook export")
write(path, source)

print("Bandwidth Phases 5 and 6 final integration applied.")
