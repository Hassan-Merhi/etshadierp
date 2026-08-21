from pathlib import Path
import json, re


def read(p):
    return Path(p).read_text()


def write(p, s):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(s if s.endswith("\n") else s + "\n")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Missing replacement target: {label}")
    return text.replace(old, new, 1)


def extract_logic(src, signature, label):
    start = src.find(signature)
    if start < 0:
        raise RuntimeError(f"Missing signature: {label}")
    body_start = start + len(signature)
    ret = src.rfind("\n  return (\n")
    if ret < body_start:
        raise RuntimeError(f"Missing final return: {label}")
    return src[body_start:ret], ret


def build_hook(imports, hook_sig, logic, returns):
    ret_lines = ",\n    ".join(returns)
    return imports.rstrip() + "\n\n" + hook_sig + logic + f"\n  return {{\n    {ret_lines},\n  }};\n}}\n"


# CreateProformaV5Drawer -> model hook
page = "client/src/pages/factory/CreateProformaV5Drawer.tsx"
src = read(page)
sig = 'export default function CreateProformaV5Drawer({ open, onClose, articleRows, onSuccess }: Props) {'
logic, ret = extract_logic(src, sig, "CreateProformaV5Drawer")
returns = [
    "customerId", "setCustomerId", "proformaName", "setProformaName", "isActive", "setIsActive",
    "quantities", "setQuantities", "sellingPrices", "setSellingPrices", "sendToLoading", "setSendToLoading",
    "containerCount", "setContainerCount", "containerNames", "pricingModes", "setPricingModes", "kgPrices", "setKgPrices",
    "draftStatus", "appliedPrice", "setAppliedPrice", "errors", "setErrors", "showZeroItems", "setShowZeroItems",
    "hideNonPositive", "setHideNonPositive", "showNegativeOnly", "setShowNegativeOnly", "showGarbageWipers",
    "setShowGarbageWipers", "articleSearch", "setArticleSearch", "qtyRefs", "customersQuery", "productsQuery",
    "customerPriceListQuery", "createMutation", "handleQtyChange", "handleQtyKeyDown", "applyCatalogSellingPrice",
    "applyCatalogProductionPrice", "updateContainerName", "addContainer", "removeContainer", "handleSubmit", "map", "n",
    "garbageWipersCount", "totalQty", "totalExpected", "totalKg", "filledLines", "warningCount", "zeroItemCount",
    "nonPositiveCount", "totalValue", "negativeCount", "visibleRows", "visibleTotalBalance",
]
hook_imports = '''import type { ClientErrorLike } from "@/lib/clientError";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ArticleRow, BaleProduct, Draft, Props } from "./types";
import { clearDraft, loadDraft, saveDraft } from "./utils";'''
hook = build_hook(
    hook_imports,
    'export function useCreateProformaV5Model({ open, onClose, articleRows, onSuccess }: Props) {',
    logic,
    returns,
)
write("client/src/pages/factory/createproformav5drawer/useCreateProformaV5Model.ts", hook)

destructure = ",\n    ".join(returns)
parent = src[:src.find(sig)] + sig + f"\n  const {{\n    {destructure},\n  }} = useCreateProformaV5Model({{ open, onClose, articleRows, onSuccess }});\n" + src[ret:]
parent = replace_once(parent, 'import type { ClientErrorLike } from "@/lib/clientError";\n', '', "create client error import")
parent = replace_once(parent, 'import { useState, useEffect, useRef, useCallback } from "react";', 'import type React from "react";', "create react import")
parent = replace_once(parent, 'import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";\n', '', "create query imports")
parent = replace_once(parent, 'import { apiRequest } from "@/lib/queryClient";\n', '', "create api import")
parent = replace_once(parent, 'import { useToast } from "@/hooks/use-toast";\n', '', "create toast import")
parent = replace_once(parent, 'import type { ArticleRow, BaleProduct, Draft, FactoryCustomer, Props } from "./createproformav5drawer/types";', 'import type { Props } from "./createproformav5drawer/types";', "create types import")
parent = replace_once(parent, 'import { clearDraft, loadDraft, saveDraft } from "./createproformav5drawer/utils";\n', '', "create utils import")
anchor = 'import type { Props } from "./createproformav5drawer/types";\n'
parent = replace_once(parent, anchor, anchor + 'import { useCreateProformaV5Model } from "./createproformav5drawer/useCreateProformaV5Model";\n', "create hook import")
write(page, parent)


# FactoryProformas -> model hook
page = "client/src/pages/factory/FactoryProformas.tsx"
src = read(page)
sig = "export default function FactoryProformas() {"
logic, ret = extract_logic(src, sig, "FactoryProformas")
returns = [
    "formatAmount", "navigate", "selectedCustomerId", "setSelectedCustomerId", "expandedProformaIds", "setExpandedProformaIds",
    "isCreateOpen", "setIsCreateOpen", "newProformaName", "setNewProformaName", "isAddLineOpen", "setIsAddLineOpen",
    "addLineProformaId", "setAddLineProformaId", "newLine", "setNewLine", "editingLine", "setEditingLine",
    "editLineValues", "setEditLineValues", "pendingDelete", "setPendingDelete", "inlineQtyLineId", "setInlineQtyLineId",
    "inlineQtyValue", "setInlineQtyValue", "renamingProforma", "setRenamingProforma", "renameValue", "setRenameValue",
    "addLineMode", "setAddLineMode", "catalogSearch", "setCatalogSearch", "catalogSelectedItem", "setCatalogSelectedItem",
    "createLoadingProforma", "setCreateLoadingProforma", "createLoadingLocationId", "setCreateLoadingLocationId",
    "transferProforma", "setTransferProforma", "transferTargetCustomerId", "setTransferTargetCustomerId", "showInactive",
    "setShowInactive", "proformaSearch", "setProformaSearch", "isExcelImportOpen", "setIsExcelImportOpen", "excelImportName",
    "setExcelImportName", "excelImportLines", "setExcelImportLines", "excelImportErrors", "setExcelImportErrors",
    "excelImportLoading", "excelFileInputRef", "customerId", "hideProformaPrice", "canEdit", "customers", "customersLoading",
    "proformas", "proformasLoading", "expandedProformaStateById", "allStockItems", "priceListMap", "locations",
    "createLoadingMutation", "createProformaMutation", "toggleActiveMutation", "deleteProformaMutation", "renameProformaMutation",
    "transferProformaMutation", "addLineMutation", "editLineMutation", "deleteLineMutation", "inlineQtyMutation", "commitInlineQty",
    "formatProformaDate", "bulkImportMutation", "downloadProformaTemplate", "handleExcelFile", "saveAgreedPricesMutation",
    "applyCatalogPricesMutation", "applyProductionPricesMutation", "handleCreateProforma", "handleAddLine", "handleEditLine",
]
hook_imports = '''import { getErrorDetails } from "@shared/errorUtils";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { read as readExcel, utils as excelUtils, writeFile as writeExcel } from "@/lib/excelHelper";
import type { Customer, Proforma, ProformaLine } from "./types";'''
hook = build_hook(hook_imports, "export function useFactoryProformasModel() {", logic, returns)
write("client/src/pages/factory/factoryproformas/useFactoryProformasModel.ts", hook)
destructure = ",\n    ".join(returns)
parent = src[:src.find(sig)] + sig + f"\n  const {{\n    {destructure},\n  }} = useFactoryProformasModel();\n" + src[ret:]
for old, label in [
    ('import { getErrorDetails } from "@shared/errorUtils";\n', "fp error utils"),
    ('import { useQuery, useMutation, useQueries } from "@tanstack/react-query";\n', "fp query"),
    ('import { useToast } from "@/hooks/use-toast";\n', "fp toast"),
    ('import { queryClient, keyStartsWith } from "@/lib/queryClient";\n', "fp query client"),
    ('import { useAppMode } from "@/contexts/AppModeContext";\n', "fp appmode"),
    ('import { getApiRequest } from "@/lib/factoryApi";\n', "fp api"),
    ('import { useState, useRef } from "react";\n', "fp react"),
    ('import { useLocation } from "wouter";\n', "fp location"),
    ('import { useCurrencyContext } from "@/contexts/CurrencyContext";\n', "fp currency"),
    ('import { useCompany } from "@/contexts/CompanyContext";\n', "fp company"),
    ('import { read as readExcel, utils as excelUtils, writeFile as writeExcel } from "@/lib/excelHelper";\n', "fp excel"),
    ('import type { Customer, Proforma, ProformaLine } from "./factoryproformas/types";\n', "fp types"),
]:
    parent = replace_once(parent, old, '', label)
anchor = 'import { effectivePricePerBale } from "./factoryproformas/utils";\n'
parent = replace_once(parent, anchor, anchor + 'import { useFactoryProformasModel } from "./factoryproformas/useFactoryProformasModel";\n', "fp hook import")

start_marker = '      {/* ── Top bar'
end_marker = '      {/* ── Content area'
start = parent.find(start_marker)
end = parent.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("FactoryProformas header markers missing")
header_jsx = parent[start:end].rstrip()
header_imports = '''import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Upload, Users, X } from "lucide-react";
import type { Customer } from "./types";

interface FactoryProformasHeaderProps {
  customerId: number | null;
  setExcelImportName: Dispatch<SetStateAction<string>>;
  setExcelImportLines: Dispatch<SetStateAction<{ articleCode: string; productName: string; quantity: string; pricePerBale: string }[]>>;
  setExcelImportErrors: Dispatch<SetStateAction<string[]>>;
  setIsExcelImportOpen: Dispatch<SetStateAction<boolean>>;
  setIsCreateOpen: Dispatch<SetStateAction<boolean>>;
  customersLoading: boolean;
  selectedCustomerId: string;
  setSelectedCustomerId: Dispatch<SetStateAction<string>>;
  setExpandedProformaIds: Dispatch<SetStateAction<Set<number>>>;
  setProformaSearch: Dispatch<SetStateAction<string>>;
  customers: Customer[];
  proformaSearch: string;
}

export function FactoryProformasHeader(props: FactoryProformasHeaderProps) {
  const {
    customerId,
    setExcelImportName,
    setExcelImportLines,
    setExcelImportErrors,
    setIsExcelImportOpen,
    setIsCreateOpen,
    customersLoading,
    selectedCustomerId,
    setSelectedCustomerId,
    setExpandedProformaIds,
    setProformaSearch,
    customers,
    proformaSearch,
  } = props;
  return (
<>
''' + header_jsx + '''
</>
  );
}
'''
write("client/src/pages/factory/factoryproformas/FactoryProformasHeader.tsx", header_imports)
header_call = '''      <FactoryProformasHeader
        customerId={customerId}
        setExcelImportName={setExcelImportName}
        setExcelImportLines={setExcelImportLines}
        setExcelImportErrors={setExcelImportErrors}
        setIsExcelImportOpen={setIsExcelImportOpen}
        setIsCreateOpen={setIsCreateOpen}
        customersLoading={customersLoading}
        selectedCustomerId={selectedCustomerId}
        setSelectedCustomerId={setSelectedCustomerId}
        setExpandedProformaIds={setExpandedProformaIds}
        setProformaSearch={setProformaSearch}
        customers={customers}
        proformaSearch={proformaSearch}
      />

'''
parent = parent[:start] + header_call + parent[end:]
parent = parent.replace('  Upload,\n', '', 1).replace('  Search,\n', '', 1).replace('  Users,\n', '', 1).replace('  X,\n', '', 1)
parent = replace_once(parent, 'import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";\n', '', "fp select import")
anchor = 'import { useFactoryProformasModel } from "./factoryproformas/useFactoryProformasModel";\n'
parent = replace_once(parent, anchor, anchor + 'import { FactoryProformasHeader } from "./factoryproformas/FactoryProformasHeader";\n', "fp header import")
write(page, parent)


# SalesReportDetail -> model hook
page = "client/src/pages/SalesReportDetail.tsx"
src = read(page)
src = replace_once(src, '  const [, _navigate] = useLocation();\n', '', "sales unused location")
sig = "export default function SalesReportDetail() {"
logic, ret = extract_logic(src, sig, "SalesReportDetail")
returns = [
    "handleBack", "formatAmount", "plFilter", "setPlFilter", "plBasis", "setPlBasis", "expandedItems", "setExpandedItems",
    "expandedLocations", "setExpandedLocations", "viewMode", "setViewMode", "expandedVouchers", "setExpandedVouchers",
    "ITEM_COLUMNS", "hiddenColumns", "setHiddenColumns", "col", "toggleColumn", "displayDate", "grouping", "allCompanies",
    "isCreditSaleParam", "searchTerm", "items", "isLoading", "filteredItems", "itemGroups", "locationColorMap", "multipleLocations",
    "toggleItem", "toggleLocation", "creditCustomerLabel", "totalQty", "totalSales", "totalCost", "totalConfiguredCost", "costProfit",
    "configuredProfit", "voucherGroups", "toggleVoucher",
]
hook_imports = '''import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBackToParent } from "@/hooks/use-back-to-parent";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { ItemGroup, PLBasis, PLFilter, SalesReportItem, VoucherGroup } from "./types";
import { LOCATION_PALETTE } from "./utils";'''
hook = build_hook(hook_imports, "export function useSalesReportDetailModel() {", logic, returns)
write("client/src/pages/salesreportdetail/useSalesReportDetailModel.ts", hook)
destructure = ",\n    ".join(returns)
parent = src[:src.find(sig)] + sig + f"\n  const {{\n    {destructure},\n  }} = useSalesReportDetailModel();\n" + src[ret:]
parent = replace_once(parent, 'import { useState, Fragment } from "react";', 'import { Fragment } from "react";', "sales react")
for old, label in [
    ('import { useQuery } from "@tanstack/react-query";\n', "sales query"),
    ('import { useLocation } from "wouter";\n', "sales wouter"),
    ('import { useBackToParent } from "@/hooks/use-back-to-parent";\n', "sales back"),
    ('import { useEscapeToParent } from "@/hooks/use-escape-to-parent";\n', "sales escape"),
    ('import { useCurrencyContext } from "@/contexts/CurrencyContext";\n', "sales currency"),
    ('import type { ItemGroup, PLBasis, PLFilter, SalesReportItem, VoucherGroup } from "./salesreportdetail/types";\n', "sales types"),
]:
    parent = replace_once(parent, old, '', label)
parent = replace_once(parent, 'import { LOCATION_PALETTE, formatNumericValue, profitColor } from "./salesreportdetail/utils";', 'import { formatNumericValue, profitColor } from "./salesreportdetail/utils";', "sales utils")
anchor = 'import { formatNumericValue, profitColor } from "./salesreportdetail/utils";\n'
parent = replace_once(parent, anchor, anchor + 'import { useSalesReportDetailModel } from "./salesreportdetail/useSalesReportDetailModel";\n', "sales model import")

start_marker = '      <div className="flex flex-wrap items-center gap-3">'
end_marker = '      {isLoading ? ('
start = parent.find(start_marker)
end = parent.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("SalesReportDetail header markers missing")
header_jsx = parent[start:end].rstrip()
header = '''import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, LayoutList, Receipt, SlidersHorizontal, TrendingDown, TrendingUp } from "lucide-react";
import type { PLBasis, PLFilter } from "../types";

type ItemColumnId = "qty" | "costPrice" | "hassanPrice" | "pricePerBale" | "costProfitBale" | "hassanProfitBale" | "costProfitTotal" | "hassanProfitTotal";

interface SalesReportDetailHeaderProps {
  handleBack: () => void;
  displayDate: string;
  isCreditSaleParam: string | null;
  creditCustomerLabel: string | null;
  grouping: string;
  searchTerm: string;
  plFilter: PLFilter;
  setPlFilter: Dispatch<SetStateAction<PLFilter>>;
  viewMode: "items" | "bySale";
  setViewMode: Dispatch<SetStateAction<"items" | "bySale">>;
  voucherGroups: { voucherId: number }[];
  expandedVouchers: Set<number>;
  setExpandedVouchers: Dispatch<SetStateAction<Set<number>>>;
  itemGroups: { stockItemId: number }[];
  expandedItems: Set<string>;
  setExpandedItems: Dispatch<SetStateAction<Set<string>>>;
  setExpandedLocations: Dispatch<SetStateAction<Set<string>>>;
  hiddenColumns: Set<ItemColumnId>;
  setHiddenColumns: Dispatch<SetStateAction<Set<ItemColumnId>>>;
  ITEM_COLUMNS: readonly { id: ItemColumnId; label: string }[];
  toggleColumn: (id: ItemColumnId) => void;
  plBasis: PLBasis;
  setPlBasis: Dispatch<SetStateAction<PLBasis>>;
}

export function SalesReportDetailHeader(props: SalesReportDetailHeaderProps) {
  const { handleBack, displayDate, isCreditSaleParam, creditCustomerLabel, grouping, searchTerm, plFilter, setPlFilter, viewMode, setViewMode, voucherGroups, expandedVouchers, setExpandedVouchers, itemGroups, expandedItems, setExpandedItems, setExpandedLocations, hiddenColumns, setHiddenColumns, ITEM_COLUMNS, toggleColumn, plBasis, setPlBasis } = props;
  return (
''' + header_jsx + '''
  );
}
'''
write("client/src/pages/salesreportdetail/components/SalesReportDetailHeader.tsx", header)
header_call = '''      <SalesReportDetailHeader
        handleBack={handleBack}
        displayDate={displayDate}
        isCreditSaleParam={isCreditSaleParam}
        creditCustomerLabel={creditCustomerLabel}
        grouping={grouping}
        searchTerm={searchTerm}
        plFilter={plFilter}
        setPlFilter={setPlFilter}
        viewMode={viewMode}
        setViewMode={setViewMode}
        voucherGroups={voucherGroups}
        expandedVouchers={expandedVouchers}
        setExpandedVouchers={setExpandedVouchers}
        itemGroups={itemGroups}
        expandedItems={expandedItems}
        setExpandedItems={setExpandedItems}
        setExpandedLocations={setExpandedLocations}
        hiddenColumns={hiddenColumns}
        setHiddenColumns={setHiddenColumns}
        ITEM_COLUMNS={ITEM_COLUMNS}
        toggleColumn={toggleColumn}
        plBasis={plBasis}
        setPlBasis={setPlBasis}
      />

'''
parent = parent[:start] + header_call + parent[end:]
for name in ["ArrowLeft", "TrendingUp", "TrendingDown", "LayoutList", "Receipt", "ChevronsDownUp", "ChevronsUpDown", "SlidersHorizontal"]:
    parent = parent.replace(f"  {name},\n", "", 1)
parent = replace_once(parent, 'import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";\n', '', "sales popover")
parent = replace_once(parent, 'import { Checkbox } from "@/components/ui/checkbox";\n', '', "sales checkbox")
parent = replace_once(parent, 'import { Badge } from "@/components/ui/badge";\n', '', "sales badge")
anchor = 'import { useSalesReportDetailModel } from "./salesreportdetail/useSalesReportDetailModel";\n'
parent = replace_once(parent, anchor, anchor + 'import { SalesReportDetailHeader } from "./salesreportdetail/components/SalesReportDetailHeader";\n', "sales header import")

start_marker = '          {/* Summary Cards */}'
end_marker = '          {/* By-Sale table */}'
start = parent.find(start_marker)
end = parent.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("SalesReportDetail summary markers missing")
summary_jsx = parent[start:end].rstrip()
summary = '''import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/formatNumber";
import { profitColor } from "../utils";

interface SalesReportSummaryCardsProps {
  totalQty: number;
  totalSales: number;
  totalCost: number;
  costProfit: number;
  totalConfiguredCost: number;
  configuredProfit: number;
  formatAmount: (value: number) => string;
}

export function SalesReportSummaryCards(props: SalesReportSummaryCardsProps) {
  const { totalQty, totalSales, totalCost, costProfit, totalConfiguredCost, configuredProfit, formatAmount } = props;
  return (
<>
''' + summary_jsx + '''
</>
  );
}
'''
write("client/src/pages/salesreportdetail/components/SalesReportSummaryCards.tsx", summary)
summary_call = '''          <SalesReportSummaryCards
            totalQty={totalQty}
            totalSales={totalSales}
            totalCost={totalCost}
            costProfit={costProfit}
            totalConfiguredCost={totalConfiguredCost}
            configuredProfit={configuredProfit}
            formatAmount={formatAmount}
          />

'''
parent = parent[:start] + summary_call + parent[end:]
anchor = 'import { SalesReportDetailHeader } from "./salesreportdetail/components/SalesReportDetailHeader";\n'
parent = replace_once(parent, anchor, anchor + 'import { SalesReportSummaryCards } from "./salesreportdetail/components/SalesReportSummaryCards";\n', "sales summary import")
write(page, parent)


# God-file ratchet: current main postOffload retirement + Wave 4
cfg_path = Path("config/god-file-boundaries.json")
cfg = json.loads(cfg_path.read_text())
cfg["version"] = 29
cfg["description"] = (
    "Version 29 reconciles the cumulative branch with current main, preserves main's postOffloadPhase6Safety retirement, "
    "and completes cumulative God Files Wave 4 by moving CreateProformaV5Drawer, SalesReportDetail and FactoryProformas "
    "state/query logic into focused model hooks plus small presentation components. "
    + cfg.get("description", "")
)
remove_paths = [
    "server/services/factory/postOffloadPhase6Safety.ts",
    "client/src/pages/factory/CreateProformaV5Drawer.tsx",
    "client/src/pages/SalesReportDetail.tsx",
    "client/src/pages/factory/FactoryProformas.tsx",
]
for p in remove_paths:
    cfg["repositoryScan"]["grandfathered"].pop(p, None)
remaining = cfg["repositoryScan"]["grandfathered"]
if len(remaining) != 8:
    raise RuntimeError(f"Expected 8 remaining God Files after main sync + Wave 4, got {len(remaining)}")
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")

test_path = Path("tests/god-file-boundaries.test.ts")
text = test_path.read_text()
text = re.sub(r"expect\(report\.version\)\.toBe\(\d+\);", "expect(report.version).toBe(29);", text, count=1)
text = re.sub(r"expect\(report\.summary\.grandfatheredFiles\)\.toBeLessThanOrEqual\(\d+\);", "expect(report.summary.grandfatheredFiles).toBeLessThanOrEqual(8);", text, count=1)
test_path.write_text(text)

print("WAVE4_TRANSFORM_APPLIED")
