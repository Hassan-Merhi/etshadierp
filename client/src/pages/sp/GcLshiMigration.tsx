import { GcLshiMigrationView } from "./gclshimigration/GcLshiMigrationView";
import { useGcLshiMigrationModel } from "./gclshimigration/useGcLshiMigrationModel";

export default function GcLshiMigration() {
  const model = useGcLshiMigrationModel();
  return <GcLshiMigrationView model={model} />;
}
