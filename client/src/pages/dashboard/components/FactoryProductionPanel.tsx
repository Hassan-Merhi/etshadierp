import { KPICard } from "@/components/KPICard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Layers, Package, Scale, X } from "lucide-react";

import { useDashboard } from "../useDashboard";

interface FactoryProductionPanelProps {
  dashboard: ReturnType<typeof useDashboard>;
}

export function FactoryProductionPanel({ dashboard }: FactoryProductionPanelProps) {
  const { balesExpanded, categoriesExpanded, factoryKPIs, isFactoryMode, setBalesExpanded, setCategoriesExpanded } =
    dashboard;

  if (!isFactoryMode) return null;

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Production Today</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          title="Opening Stock"
          value={factoryKPIs ? `${parseFloat(factoryKPIs.openingStockKg).toLocaleString()} kg` : "Loading..."}
          change="Raw stock at start of today"
          changeType="positive"
          icon={Package}
          data-testid="kpi-opening-stock"
        />
        <KPICard
          title="Closing Stock"
          value={factoryKPIs ? `${parseFloat(factoryKPIs.closingStockKg).toLocaleString()} kg` : "Loading..."}
          change="Current remaining raw stock"
          changeType={factoryKPIs && parseFloat(factoryKPIs.closingStockKg) > 0 ? "positive" : "negative"}
          icon={Scale}
          data-testid="kpi-closing-stock"
        />
        <KPICard
          title="Bales Pressed Today"
          value={factoryKPIs ? String(factoryKPIs.balesPressedToday) : "Loading..."}
          change={factoryKPIs ? `${parseFloat(factoryKPIs.totalBaleWeightToday).toLocaleString()} kg total` : ""}
          changeType="neutral"
          icon={Package}
          onClick={() => setBalesExpanded((v) => !v)}
          data-testid="kpi-bales-pressed"
        />
        <KPICard
          title="Categories Today"
          value={factoryKPIs ? String(factoryKPIs.categories.length) : "Loading..."}
          change={factoryKPIs ? `${factoryKPIs.balesPressedToday} bales across categories` : ""}
          changeType="neutral"
          icon={Layers}
          onClick={() => setCategoriesExpanded((v) => !v)}
          data-testid="kpi-categories"
        />
      </div>

      {/* Bales detail panel */}
      {balesExpanded && factoryKPIs && (
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Bales Pressed Today
            </h4>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setBalesExpanded(false)}
              data-testid="button-close-bales"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {factoryKPIs.balesDetail.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No bales pressed today</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {factoryKPIs.balesDetail.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                  <span className="text-muted-foreground font-mono">{b.baleCode}</span>
                  <span className="font-medium flex-1 mx-3 truncate">{b.productName || b.category || "—"}</span>
                  <span className="font-mono">{parseFloat(b.weightKg).toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Categories detail panel */}
      {categoriesExpanded && factoryKPIs && (
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Categories Today
            </h4>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCategoriesExpanded(false)}
              data-testid="button-close-categories"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {factoryKPIs.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No categories today</p>
          ) : (
            <div className="space-y-1">
              {factoryKPIs.categories.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                  <span className="font-medium truncate flex-1 mr-3">{cat.name}</span>
                  <span className="text-muted-foreground mr-3">{cat.count} bales</span>
                  <span className="font-mono">{cat.totalKg.toLocaleString()} kg</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
