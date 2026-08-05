import { useCompany } from "@/contexts/CompanyContext";
import GITContainers from "@/pages/GITContainers";

export default function TrackingContainersTab() {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id ?? null;

  if (!companyId) return null;

  return <GITContainers key={`tracking-containers-${companyId}`} embedded />;
}
