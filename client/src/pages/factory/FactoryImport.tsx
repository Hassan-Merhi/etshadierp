import {useState} from "react";
import {Users, Package, Boxes} from "lucide-react";
import {Button} from "@/components/ui/button";
import {} from "@/components/ui/dialog";
import {useToast} from "@/hooks/use-toast";

import type {ImportTab} from "./factoryimport/types";
import {SupplierImport} from "./factoryimport/components/SupplierImport";
import {RawStockImport} from "./factoryimport/components/RawStockImport";
import {BaleImport} from "./factoryimport/components/BaleImport";
import {OpeningStockImport} from "./factoryimport/components/OpeningStockImport";
import {SupplierObEdit} from "./factoryimport/components/SupplierObEdit";
export default function FactoryImport() {
  const [activeTab, setActiveTab] = useState<ImportTab>("suppliers");
  const { toast } = useToast();

  const tabs: { key: ImportTab; label: string; icon: typeof Users }[] = [
    { key: "suppliers", label: "Supplier Balances", icon: Users },
    { key: "raw-stock", label: "Raw Stock", icon: Package },
    { key: "bales", label: "Bales Inventory", icon: Boxes },
    { key: "opening-stock", label: "Opening Raw Stock", icon: Package },
    { key: "ob-edit", label: "Edit Opening Balance", icon: Users },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "default" : "outline"}
              onClick={() => setActiveTab(tab.key)}
              data-testid={`tab-import-${tab.key}`}
            >
              <Icon className="h-4 w-4 mr-2" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {activeTab === "suppliers" && <SupplierImport />}
      {activeTab === "raw-stock" && <RawStockImport />}
      {activeTab === "bales" && <BaleImport />}
      {activeTab === "opening-stock" && <OpeningStockImport />}
      {activeTab === "ob-edit" && <SupplierObEdit />}
    </div>
  );
}
