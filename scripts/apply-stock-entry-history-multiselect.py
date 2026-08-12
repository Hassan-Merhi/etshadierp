from pathlib import Path

PATH = Path("client/src/pages/StockEntryHistory.tsx")
text = PATH.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'import {ChevronDown, ChevronRight, Download, Search, RotateCcw, List, AlignJustify, FileDown, MoreVertical, CalendarRange, MessageCircle, Loader2, History, Users, Package, MapPin, Tag, Layers, Check} from "lucide-react";',
    'import {ChevronDown, ChevronRight, Download, Search, RotateCcw, List, AlignJustify, FileDown, MoreVertical, CalendarRange, MessageCircle, Loader2, History, Users, Package, MapPin, Tag, Layers} from "lucide-react";',
    "remove obsolete Check import",
)
replace_once(
    'import ProductionPlannerDialog from "./factory/ProductionPlannerDialog";\n',
    'import ProductionPlannerDialog from "./factory/ProductionPlannerDialog";\nimport {MultiSelectFilter} from "./factory/productioncomparison/components/MultiSelectFilter";\n',
    "add MultiSelectFilter import",
)
replace_once(
    'import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";\n',
    "",
    "remove obsolete popover imports",
)

replace_once(
    '''  const [categoryFilter, setCategoryFilter] = useState("all");
  const [productCategoryFilter, setProductCategoryFilter] = useState<string[]>([]);
  const [workerIdFilter, setWorkerIdFilter] = useState("all");
  const [productIdFilter, setProductIdFilter] = useState("all");
  const [locationIdFilter, setLocationIdFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");''',
    '''  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [productCategoryFilter, setProductCategoryFilter] = useState<string[]>([]);
  const [workerIdFilter, setWorkerIdFilter] = useState<string[]>([]);
  const [productIdFilter, setProductIdFilter] = useState<string[]>([]);
  const [locationIdFilter, setLocationIdFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);''',
    "convert filter state to arrays",
)

replace_once(
    '''        workerIdFilter,
        productIdFilter,
        locationIdFilter,
        categoryFilter,
        productCategoryFilter.join(","),
        statusFilter,''',
    '''        workerIdFilter.join(","),
        productIdFilter.join(","),
        locationIdFilter.join(","),
        categoryFilter.join(","),
        productCategoryFilter.join(","),
        statusFilter.join(","),''',
    "serialize multi-select filters in cache key",
)

replace_once(
    '''  if (workerIdFilter !== "all") params.set("workerId", workerIdFilter);
  if (productIdFilter !== "all") params.set("productId", productIdFilter);
  if (locationIdFilter !== "all") params.set("locationId", locationIdFilter);
  if (productCategoryFilter.length > 0) params.set("categoryId", productCategoryFilter.join(","));
  if (statusFilter !== "all") params.set("status", statusFilter);''',
    '''  if (workerIdFilter.length > 0) params.set("workerId", workerIdFilter.join(","));
  if (productIdFilter.length > 0) params.set("productId", productIdFilter.join(","));
  if (locationIdFilter.length > 0) params.set("locationId", locationIdFilter.join(","));
  if (categoryFilter.length > 0) params.set("workerCategoryId", categoryFilter.join(","));
  if (productCategoryFilter.length > 0) params.set("categoryId", productCategoryFilter.join(","));
  if (statusFilter.length > 0) params.set("status", statusFilter.join(","));''',
    "send multi-select query params",
)

replace_once(
    '''  const selectedCategoryWorkerIds: number[] | null = useMemo(() => {
    if (categoryFilter === "all") return null;
    const cat = categories.find((c: any) => String(c.id) === categoryFilter);
    if (!cat) return null;
    const ids = Array.isArray(cat.workerIds) ? (cat.workerIds as number[]) : [];
    return workers.filter((w: any) => w.active && ids.includes(w.id)).map((w: any) => w.id);
  }, [categoryFilter, categories, workers]);

  const filteredWorkers = useMemo(() => {
    if (!selectedCategoryWorkerIds) return workers;
    return workers.filter((w: any) => selectedCategoryWorkerIds.includes(w.id));
  }, [workers, selectedCategoryWorkerIds]);

  const filteredGroups = useMemo(() => {
    if (!selectedCategoryWorkerIds || workerIdFilter !== "all") return groups;
    return groups.filter((g) => g.workerId !== null && selectedCategoryWorkerIds.includes(g.workerId));
  }, [groups, selectedCategoryWorkerIds, workerIdFilter]);''',
    '''  const selectedCategoryWorkerIds: number[] | null = useMemo(() => {
    if (categoryFilter.length === 0) return null;
    const selectedCategoryIds = new Set(categoryFilter);
    const ids = new Set<number>();
    for (const cat of categories) {
      if (!selectedCategoryIds.has(String(cat.id))) continue;
      for (const id of Array.isArray(cat.workerIds) ? (cat.workerIds as number[]) : []) {
        ids.add(Number(id));
      }
    }
    return workers.filter((w: any) => w.active && ids.has(w.id)).map((w: any) => w.id);
  }, [categoryFilter, categories, workers]);

  const filteredWorkers = useMemo(() => {
    if (!selectedCategoryWorkerIds) return workers;
    return workers.filter((w: any) => selectedCategoryWorkerIds.includes(w.id));
  }, [workers, selectedCategoryWorkerIds]);

  // Every history filter is applied by the API, so the screen, totals, and exports share one dataset.
  const filteredGroups = groups;''',
    "support multiple worker groups",
)

replace_once(
    '''      for (const workerIdStr of Object.keys(workerTargets)) {
        const wid = Number(workerIdStr);
        const key = String(wid);''',
    '''      const selectedWorkerIds = new Set(workerIdFilter.map(Number));
      const categoryWorkerIds = selectedCategoryWorkerIds ? new Set(selectedCategoryWorkerIds) : null;
      for (const workerIdStr of Object.keys(workerTargets)) {
        const wid = Number(workerIdStr);
        if (selectedWorkerIds.size > 0 && !selectedWorkerIds.has(wid)) continue;
        if (categoryWorkerIds && !categoryWorkerIds.has(wid)) continue;
        const key = String(wid);''',
    "filter zero-bale planner rows",
)
replace_once(
    '  }, [filteredGroups, workerTargets, workers]);',
    '  }, [filteredGroups, workerTargets, workers, workerIdFilter, selectedCategoryWorkerIds]);',
    "update worker group memo dependencies",
)

replace_once(
    '''    setCategoryFilter("all");
    setProductCategoryFilter([]);
    setWorkerIdFilter("all");
    setProductIdFilter("all");
    setLocationIdFilter("all");
    setStatusFilter("all");''',
    '''    setCategoryFilter([]);
    setProductCategoryFilter([]);
    setWorkerIdFilter([]);
    setProductIdFilter([]);
    setLocationIdFilter([]);
    setStatusFilter([]);''',
    "reset array filters",
)

panel_start_marker = '        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">'
panel_end_marker = '      </div>\n\n      {/* ── Date + Search band ── */}'
panel_start = text.index(panel_start_marker)
panel_end = text.index(panel_end_marker, panel_start)
new_panel = '''        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Layers className="h-3 w-3" />
              Bale Category
            </div>
            <MultiSelectFilter
              options={productCategories.map((c: any) => ({ value: String(c.id), label: c.name }))}
              selected={productCategoryFilter}
              onChange={setProductCategoryFilter}
              placeholder="Bale categories"
              allLabel="All Categories"
              className="h-8 w-full min-w-0 px-2 py-0 text-xs"
              testId="select-product-category"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Users className="h-3 w-3" />
              Worker Group
            </div>
            <MultiSelectFilter
              options={categories.map((c: any) => ({ value: String(c.id), label: c.name }))}
              selected={categoryFilter}
              onChange={(next) => {
                setCategoryFilter(next);
                if (next.length === 0) return;
                const selectedGroups = new Set(next);
                const allowedWorkerIds = new Set<number>();
                for (const category of categories) {
                  if (!selectedGroups.has(String(category.id))) continue;
                  for (const workerId of Array.isArray(category.workerIds) ? category.workerIds : []) {
                    allowedWorkerIds.add(Number(workerId));
                  }
                }
                setWorkerIdFilter((prev) => prev.filter((id) => allowedWorkerIds.has(Number(id))));
              }}
              placeholder="Worker groups"
              allLabel="All Groups"
              className="h-8 w-full min-w-0 px-2 py-0 text-xs"
              testId="select-category"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Users className="h-3 w-3" />
              Worker
            </div>
            <MultiSelectFilter
              options={filteredWorkers.map((w: any) => ({
                value: String(w.id),
                label: w.fullName || w.full_name || w.name || String(w.id),
              }))}
              selected={workerIdFilter}
              onChange={setWorkerIdFilter}
              placeholder="Workers"
              allLabel="All Workers"
              className="h-8 w-full min-w-0 px-2 py-0 text-xs"
              testId="select-worker"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Package className="h-3 w-3" />
              Product
            </div>
            <MultiSelectFilter
              options={products.map((p: any) => ({ value: String(p.id), label: p.name }))}
              selected={productIdFilter}
              onChange={setProductIdFilter}
              placeholder="Products"
              allLabel="All Products"
              className="h-8 w-full min-w-0 px-2 py-0 text-xs"
              testId="select-product"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <MapPin className="h-3 w-3" />
              Location
            </div>
            <MultiSelectFilter
              options={locations.map((l: any) => ({ value: String(l.id), label: l.name }))}
              selected={locationIdFilter}
              onChange={setLocationIdFilter}
              placeholder="Locations"
              allLabel="All Locations"
              className="h-8 w-full min-w-0 px-2 py-0 text-xs"
              testId="select-location"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Tag className="h-3 w-3" />
              Status
            </div>
            <MultiSelectFilter
              options={STATUS_OPTIONS}
              selected={statusFilter}
              onChange={setStatusFilter}
              placeholder="Statuses"
              allLabel="All Statuses"
              className="h-8 w-full min-w-0 px-2 py-0 text-xs"
              testId="select-status"
            />
          </div>
        </div>
'''
text = text[:panel_start] + new_panel + text[panel_end:]

PATH.write_text(text)
print(f"updated {PATH}")
