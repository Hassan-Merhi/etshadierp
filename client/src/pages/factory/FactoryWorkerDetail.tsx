import { FactoryWorkerDetailView } from "./factoryworkerdetail/FactoryWorkerDetailView";
import { useFactoryWorkerDetailModel } from "./factoryworkerdetail/useFactoryWorkerDetailModel";

export default function FactoryWorkerDetail() {
  const model = useFactoryWorkerDetailModel();
  return <FactoryWorkerDetailView model={model} />;
}
