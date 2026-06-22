import { 
  EnrichedContainerRow, 
  parseNum, 
  fmt 
} from "./gitContainerTypes";

interface ContainerSummaryStatsProps {
  filteredContainers: EnrichedContainerRow[];
}

export function useContainerSummaryStats({ filteredContainers }: ContainerSummaryStatsProps) {
  const atSea = filteredContainers.filter((c) => c.status === "OTW" || c.status === "Sea").length;
  const atPort = filteredContainers.filter((c) => c.status === "At Port").length;
  const leftDar = filteredContainers.filter((c) => c.status === "Left Dar").length;
  const inTransit = filteredContainers.filter((c) => ["At Border", "In Transit"].includes(c.status)).length;
  const arrived = filteredContainers.filter((c) => c.status === "Arrived").length;
  const delayed = filteredContainers.filter((c) => c.daysDelayed !== null && c.daysDelayed > 0).length;
  const offloadOverdue = filteredContainers.filter((c) => c.isOverdue).length;
  
  const totalCost = filteredContainers.reduce((s, c) => s + parseNum(c.grandTotal), 0);
  const totalTransport = filteredContainers.reduce((s, c) => s + parseNum(c.transportFee), 0);
  const totalDuty = filteredContainers.reduce((s, c) => s + parseNum(c.dutyFee), 0);

  return {
    atSea,
    atPort,
    leftDar,
    inTransit,
    arrived,
    delayed,
    offloadOverdue,
    totalCost: `$${fmt(totalCost)}`,
    totalTransportDuty: `$${fmt(totalTransport + totalDuty)}`
  };
}
