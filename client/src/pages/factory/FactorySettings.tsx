import { FactorySettingsView } from "./factorysettings/FactorySettingsView";
import { useFactorySettingsModel } from "./factorysettings/useFactorySettingsModel";

export default function FactorySettings() {
  const model = useFactorySettingsModel();
  return <FactorySettingsView model={model} />;
}
