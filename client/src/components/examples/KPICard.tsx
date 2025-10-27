import { KPICard } from "../KPICard";
import { DollarSign } from "lucide-react";

export default function KPICardExample() {
  return (
    <div className="p-4 max-w-sm">
      <KPICard
        title="Total Revenue"
        value="$328,500"
        change="+12.5% from last month"
        changeType="positive"
        icon={DollarSign}
      />
    </div>
  );
}
