import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { FactoryWorkerCategoriesPanel } from "./FactoryWorkerCategoriesPanel";
import { FactoryWorkersDialogs } from "./FactoryWorkersDialogs";
import { FactoryWorkersRosterPanel } from "./FactoryWorkersRosterPanel";
import type { useFactoryWorkersModel } from "./useFactoryWorkersModel";

interface FactoryWorkersModelProps {
  model: ReturnType<typeof useFactoryWorkersModel>;
}

export function FactoryWorkersView({ model }: FactoryWorkersModelProps) {
  const { showCategories, categories } = model;

  return (
    <div className="space-y-5">
      <Tabs defaultValue="workers">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList>
            <TabsTrigger value="workers" data-testid="tab-workers">
              Workers
            </TabsTrigger>
            {showCategories && (
              <TabsTrigger value="categories" data-testid="tab-categories">
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Categories
                {categories.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-xs no-default-active-elevate">
                    {categories.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <FactoryWorkersRosterPanel model={model} />
        <FactoryWorkerCategoriesPanel model={model} />
      </Tabs>
      <FactoryWorkersDialogs model={model} />
    </div>
  );
}
