import { BarcodeLookupView } from "./barcodelookup/BarcodeLookupView";
import { useBarcodeLookupModel } from "./barcodelookup/useBarcodeLookupModel";

export default function BarcodeLookup() {
  const model = useBarcodeLookupModel();
  return <BarcodeLookupView model={model} />;
}
