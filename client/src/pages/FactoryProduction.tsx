import { useState } from "react";
import { Factory, Package, Boxes, Layers, Tags } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Bales from "./Bales";
import MixBatches from "./MixBatches";
import ProductionBales from "./ProductionBales";
import BaleProducts from "./BaleProducts";

export default function FactoryProduction() {
  const [activeTab, setActiveTab] = useState("bales");

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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="bales" data-testid="tab-factory-bales">
            <Package className="h-4 w-4 mr-2" />
            Factory Bales
          </TabsTrigger>
          <TabsTrigger value="mix-batches" data-testid="tab-mix-batches">
            <Boxes className="h-4 w-4 mr-2" />
            Mix Batches
          </TabsTrigger>
          <TabsTrigger value="production-bales" data-testid="tab-production-bales">
            <Layers className="h-4 w-4 mr-2" />
            Production Bales
          </TabsTrigger>
          <TabsTrigger value="bale-products" data-testid="tab-bale-products">
            <Tags className="h-4 w-4 mr-2" />
            Bale Products
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bales" className="mt-4">
          <Bales />
        </TabsContent>

        <TabsContent value="mix-batches" className="mt-4">
          <MixBatches />
        </TabsContent>

        <TabsContent value="production-bales" className="mt-4">
          <ProductionBales />
        </TabsContent>

        <TabsContent value="bale-products" className="mt-4">
          <BaleProducts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
