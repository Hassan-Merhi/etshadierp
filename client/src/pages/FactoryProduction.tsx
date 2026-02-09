import { useState, lazy, Suspense } from "react";
import { Factory, Package, Boxes, Layers, Tags, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const Bales = lazy(() => import("./Bales"));
const MixBatches = lazy(() => import("./MixBatches"));
const ProductionBales = lazy(() => import("./ProductionBales"));
const BaleProducts = lazy(() => import("./BaleProducts"));

function LoadingFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

type SectionKey = "bales" | "mix-batches" | "production-bales" | "bale-products";

interface SidebarItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export default function FactoryProduction() {
  const [activeSection, setActiveSection] = useState<SectionKey>("bales");

  const sidebarGroups: SidebarGroup[] = [
    {
      label: "Raw Materials",
      items: [
        { key: "bales", label: "Factory Bales", icon: Package },
        { key: "mix-batches", label: "Mix Batches", icon: Boxes },
      ],
    },
    {
      label: "Production",
      items: [
        { key: "production-bales", label: "Production Bales", icon: Layers },
        { key: "bale-products", label: "Bale Products", icon: Tags },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Factory className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Factory Production</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage bales, batches, and production
          </p>
        </div>
      </div>

      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActiveSection(item.key)}
                      data-testid={`tab-factory-${item.key}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <Suspense fallback={<LoadingFallback />}>
            {activeSection === "bales" && <Bales />}
            {activeSection === "mix-batches" && <MixBatches />}
            {activeSection === "production-bales" && <ProductionBales />}
            {activeSection === "bale-products" && <BaleProducts />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
