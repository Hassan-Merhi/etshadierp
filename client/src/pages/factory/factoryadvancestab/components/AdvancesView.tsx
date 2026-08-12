import { AdvancesPanel } from "../advances/AdvancesPanel";
import { useAdvancesModel } from "../advances/useAdvancesModel";

export function AdvancesView() {
  const model = useAdvancesModel();
  return <AdvancesPanel model={model} />;
}
