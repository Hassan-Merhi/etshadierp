import { FactoryLocationInventoryLocationView } from "./FactoryLocationInventoryLocationView";
import { useFactoryLocationInventory } from "./FactoryLocationInventoryModel";
import { FactoryLocationInventoryProductView } from "./FactoryLocationInventoryProductView";

export default function FactoryLocationInventory() {
  const inventory = useFactoryLocationInventory();
  return inventory.selectedLocation ? (
    <FactoryLocationInventoryProductView inventory={inventory} />
  ) : (
    <FactoryLocationInventoryLocationView inventory={inventory} />
  );
}
