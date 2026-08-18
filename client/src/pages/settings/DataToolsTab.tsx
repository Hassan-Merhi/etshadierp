import { DataToolsView } from "./datatoolstab/DataToolsView";
import { useDataToolsModel } from "./datatoolstab/useDataToolsModel";

export function DataToolsTab() {
  const model = useDataToolsModel();
  return <DataToolsView model={model} />;
}
