import { FactoryWorkersView } from "./factoryworkers/FactoryWorkersView";
import { useFactoryWorkersModel } from "./factoryworkers/useFactoryWorkersModel";

export default function FactoryWorkers() {
  const model = useFactoryWorkersModel();
  return <FactoryWorkersView model={model} />;
}
