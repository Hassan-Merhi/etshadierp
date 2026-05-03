import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Package, MapPin, Users, DollarSign, FileCheck, AlertTriangle, ChevronDown, ChevronRight, ArrowLeft, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useState, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { useDateFormat } from "@/contexts/DateFormatContext";

type POLineItem = {
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  rate: string;
  lineTotal: string;
};

type POData = {
  id: number;
  poNumber: string;
  currency: string;
  itemsTotal: string;
  freight: string;
  surcharge: string;
  fumigation: string;
  documentCharges: string;
  discount: string;
  otherCharges: string;
  status: string;
  lineItems: POLineItem[];
};

type ContainerPOResponse = {
  container: {
    id: number;
    containerNumber: string;
    status: string;
    importDate: string;
    grandTotal: string;
  };
  supplier: { id: number; legalName: string } | null;
  purchaseOrders: POData[];
};

type Container = {
  id: number;
  containerNumber: string;
  companyId: number;
  companyName: string;
  companyCode: string;
  supplierId: number;
  supplierName: string;
  grandTotal: string;
  shopName: string | null;
  eta: string | null;
  transporter: string | null;
  transportFee: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  borderDate: string | null;
  offloadDate: string | null;
  agent: string | null;
  dutyFee: string | null;
  docReceived: boolean;
  itemCount?: number;
};

type TransporterData = {
  otw: Container[];
  offloaded: Container[];
  otwTotal: number;
  offloadedTotal: number;
};

type AgentData = {
  containers: Container[];
  offloadedContainers: Container[];
  total: number;
  offloadedTotal: number;
  balance: number;
};

type DashboardData = {
  containers: Container[];
  byRoute: Record<string, Container[]>;
  byAgent: Record<string, AgentData>;
  byLocation: Record<string, { count: number; total: number }>;
  byTransporter: Record<string, TransporterData>;
  totals: { count: number; amount: number; totalItems?: number };
};

export default function ContainerDashboard() {
  const { selectCompany, companies } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const { formatShortDate } = useDateFormat();
  const [, navigate] = useLocation();
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string[]>([]);
  const [filterTransporter, setFilterTransporter] = useState<string>("all");
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [mainTab, setMainTab] = useState<string>("tracking");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState<number | null>(null);
  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [poData, setPoData] = useState<ContainerPOResponse | null>(null);
  const [loadingPO, setLoadingPO] = useState(false);

  useEscapeBack(selectedAgent ? () => setSelectedAgent(null) : null);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard/container-tracking"],
  });

  const handleContainerNumberClick = async (e: React.MouseEvent, containerId: number) => {
    e.stopPropagation();
    setSelectedContainerId(containerId);
    setPoData(null);
    setLoadingPO(true);
    setPoDialogOpen(true);
    try {
      const response = await apiRequest("GET", `/api/containers/${containerId}/purchase-orders`);
      if (!response.ok) {
        throw new Error("Failed to fetch");
      }
      const data = await response.json();
      setPoData(data);
    } catch (error) {
      console.error("Failed to fetch PO data:", error);
      setPoData(null);
    } finally {
      setLoadingPO(false);
    }
  };

  /**
   * ✅ FIXED SORTING (ONLY CHANGE IN THE FILE)
   * Groups by Supplier first (WH TURKEY together, AL ZAYDAAN together, etc.)
   * Then sorts by earliest ETA first inside each supplier group
   * Then uses location as a tie-breaker
   */
  const sortContainersByLocationAndEta = (containers: Container[]) => {
    return [...containers].sort((a, b) => {
      // 1) Supplier first (groups suppliers together)
      const supplierA = (a.supplierName || "zzz").toLowerCase();
      const supplierB = (b.supplierName || "zzz").toLowerCase();
      if (supplierA !== supplierB) return supplierA.localeCompare(supplierB);

      // 2) ETA earliest first inside supplier group
      const etaA = a.eta ? new Date(a.eta).getTime() : Infinity;
      const etaB = b.eta ? new Date(b.eta).getTime() : Infinity;
      if (etaA !== etaB) return etaA - etaB;

      // 3) Location tie-breaker (only if supplier + ETA are same)
      const locA = (a.trackingLocation || "zzz").toLowerCase();
      const locB = (b.trackingLocation || "zzz").toLowerCase();
      if (locA !== locB) return locA.localeCompare(locB);

      return 0;
    });
  };

  const agents = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.byAgent).filter(a => a !== "Unassigned").sort();
  }, [data]);

  const companyFilterOptions = useMemo(() => {
    if (!data) return [];
    const uniqueCompanies = new Map<string, string>();
    data.containers.forEach(c => {
      uniqueCompanies.set(c.companyCode, c.companyName);
    });
    return Array.from(uniqueCompanies.entries()).sort((a, b) => (a[0] || '').localeCompare(b[0] || ''));
  }, [data]);

  const transporters = useMemo(() => {
    if (!data) return [];
    const unique = new Set<string>();
    data.containers.forEach(c => {
      if (c.transporter) unique.add(c.transporter);
    });
    return Array.from(unique).sort();
  }, [data]);

  const filteredData = useMemo(() => {
    if (!data) return null;

    let containers = data.containers;

    if (filterAgent !== "all") {
      containers = containers.filter(c => c.agent === filterAgent);
    }
    if (filterCompany.length > 0) {
      containers = containers.filter(c => filterCompany.includes(c.companyCode));
    }
    if (filterTransporter !== "all") {
      containers = containers.filter(c => c.transporter === filterTransporter);
    }

    const byRoute: Record<string, Container[]> = {};
    const byAgent: Record<string, AgentData> = {};
    const byLocation: Record<string, { count: number; total: number }> = {};
    const byTransporter: Record<string, TransporterData> = {};
    let totalAmount = 0;

    for (const container of containers) {
      const route = container.shopName || "Unassigned";
      const agent = container.agent || "Unassigned";
      const location = container.trackingLocation || "Unknown";
      const transporter = container.transporter || "Unassigned";
      const amount = parseFloat(String(container.grandTotal || "0"));
      const transportFee = parseFloat(String(container.transportFee || "0"));

      if (!byRoute[route]) byRoute[route] = [];
      byRoute[route].push(container);

      if (!byAgent[agent]) {
        const originalData = data.byAgent[agent];
        byAgent[agent] = {
          containers: [],
          offloadedContainers: originalData?.offloadedContainers || [],
          total: 0,
          offloadedTotal: originalData?.offloadedTotal || 0,
          balance: originalData?.balance || 0
        };
      }
      byAgent[agent].containers.push(container);
      byAgent[agent].total += amount;

      if (!byLocation[location]) byLocation[location] = { count: 0, total: 0 };
      byLocation[location].count++;
      byLocation[location].total += amount;

      if (!byTransporter[transporter]) {
        byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
      }
      byTransporter[transporter].otw.push(container);
      byTransporter[transporter].otwTotal += transportFee;

      totalAmount += amount;
    }

    if (data.byTransporter) {
      for (const [transporter, tData] of Object.entries(data.byTransporter)) {
        if (!byTransporter[transporter]) {
          byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
        }
        let offloaded = tData.offloaded;
        if (filterCompany.length > 0) {
          offloaded = offloaded.filter(c => filterCompany.includes(c.companyCode));
        }
        if (filterAgent !== "all") {
          offloaded = offloaded.filter(c => c.agent === filterAgent);
        }
        byTransporter[transporter].offloaded = offloaded;
        byTransporter[transporter].offloadedTotal = offloaded.reduce(
          (sum, c) => sum + parseFloat(String(c.transportFee || "0")), 0
        );
      }
    }

    return {
      containers,
      byRoute,
      byAgent,
      byLocation,
      byTransporter,
      totals: { count: containers.length, amount: totalAmount, totalItems: containers.reduce((sum, c) => sum + (c.itemCount || 0), 0) },
    };
  }, [data, filterAgent, filterCompany, filterTransporter]);

  const toggleRoute = (route: string) => {
    const newExpanded = new Set(expandedRoutes);
    if (newExpanded.has(route)) {
      newExpanded.delete(route);
    } else {
      newExpanded.add(route);
    }
    setExpandedRoutes(newExpanded);
  };

  const handleContainerClick = (companyId: number) => {
    const company = companies.find(c => c.id === companyId);
    if (company) { selectCompany(company); navigate("/containers"); }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return formatShortDate(dateStr);
    } catch {
      return dateStr;
    }
  };

  const isOverdue = (eta: string | null) => {
    if (!eta) return false;
    try {
      return new Date(eta) < new Date();
    } catch {
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const renderAgentStatement = () => {
    if (!selectedAgent || !data?.byAgent[selectedAgent]) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-4">Select an agent to view their statement</p>
          {agents.map(agent => {
            const agentData = data?.byAgent[agent];
            return (
              <Card
                key={agent}
                className="cursor-pointer hover-elevate"
                onClick={() => setSelectedAgent(agent)}
                data-testid={`card-statement-agent-${agent}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{agent}</span>
                      <Badge variant="secondary" className="text-xs">{agentData?.containers.length || 0} OTW</Badge>
                      <Badge variant="outline" className="text-xs">{agentData?.offloadedContainers?.length || 0} Offloaded</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      );
    }

    const agentData = data.byAgent[selectedAgent];

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedAgent(null)} data-testid="button-back-agents">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h3 className="font-bold text-lg">{selectedAgent}</h3>
        </div>

        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm font-medium text-success">Offloaded Containers (Balance Owed)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left py-1 px-2 font-medium">Container #</th>
                    <th className="text-left py-1 px-2 font-medium">Supplier</th>
                    <th className="text-left py-1 px-2 font-medium">Number Plate</th>
                    <th className="text-left py-1 px-2 font-medium">Border Date</th>
                    <th className="text-left py-1 px-2 font-medium">Transporter</th>
                    <th className="text-left py-1 px-2 font-medium">Location</th>
                    <th className="text-right py-1 px-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {agentData.offloadedContainers?.length > 0 ? (
                    agentData.offloadedContainers.map((container: any) => (
                      <tr key={container.id} className="border-t" data-testid={`row-offloaded-${container.id}`}>
                        <td className="py-1 px-2 font-mono">{container.containerNumber}</td>
                        <td className="py-1 px-2">{container.supplierName || "-"}</td>
                        <td className="py-1 px-2">{container.numberPlate || "-"}</td>
                        <td className="py-1 px-2">{formatDate(container.borderDate)}</td>
                        <td className="py-1 px-2">{container.transporter || "-"}</td>
                        <td className="py-1 px-2">{container.trackingLocation || "-"}</td>
                        <td className="py-1 px-2 text-right">{formatAmount(parseFloat(container.dutyFee || "0"))}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={7} className="py-2 px-2 text-center text-muted-foreground">No offloaded containers</td></tr>
                  )}
                </tbody>
                {agentData.offloadedContainers?.length > 0 && (
                  <tfoot className="bg-success-soft text-success-soft-foreground">
                    <tr>
                      <td colSpan={6} className="py-1 px-2 font-bold">Total Balance Owed</td>
                      <td className="py-1 px-2 text-right font-bold">{formatAmount(agentData.offloadedContainers.reduce((sum: number, c: any) => sum + parseFloat(c.dutyFee || "0"), 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="md:hidden space-y-2 p-2">
              {agentData.offloadedContainers?.length > 0 ? (
                agentData.offloadedContainers.map((container: any) => (
                  <div key={container.id} className="border rounded-md p-2.5 text-xs space-y-1" data-testid={`card-offloaded-mobile-${container.id}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{container.containerNumber}</span>
                      <span className="font-bold">{formatAmount(parseFloat(container.dutyFee || "0"))}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                      <div><span className="text-muted-foreground">Supplier:</span> {container.supplierName || "-"}</div>
                      <div><span className="text-muted-foreground">Plate:</span> {container.numberPlate || "-"}</div>
                      <div><span className="text-muted-foreground">Border:</span> {formatDate(container.borderDate)}</div>
                      <div><span className="text-muted-foreground">Transporter:</span> {container.transporter || "-"}</div>
                      <div><span className="text-muted-foreground">Location:</span> {container.trackingLocation || "-"}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground text-xs py-2">No offloaded containers</p>
              )}
              {agentData.offloadedContainers?.length > 0 && (
                <div className="bg-success-soft text-success-soft-foreground rounded-md p-2 flex justify-between text-xs font-bold">
                  <span>Total Balance Owed</span>
                  <span>{formatAmount(agentData.offloadedContainers.reduce((sum: number, c: any) => sum + parseFloat(c.dutyFee || "0"), 0))}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm font-medium text-warning">OTW Containers (Pending)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left py-1 px-2 font-medium">Container #</th>
                    <th className="text-left py-1 px-2 font-medium">Supplier</th>
                    <th className="text-left py-1 px-2 font-medium">Number Plate</th>
                    <th className="text-left py-1 px-2 font-medium">Border Date</th>
                    <th className="text-left py-1 px-2 font-medium">Transporter</th>
                    <th className="text-left py-1 px-2 font-medium">Location</th>
                    <th className="text-right py-1 px-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {agentData.containers.length > 0 ? (
                    agentData.containers.map((container: any) => (
                      <tr key={container.id} className="border-t" data-testid={`row-otw-${container.id}`}>
                        <td className="py-1 px-2 font-mono">{container.containerNumber}</td>
                        <td className="py-1 px-2">{container.supplierName || "-"}</td>
                        <td className="py-1 px-2">{container.numberPlate || "-"}</td>
                        <td className="py-1 px-2">{formatDate(container.borderDate)}</td>
                        <td className="py-1 px-2">{container.transporter || "-"}</td>
                        <td className="py-1 px-2">{container.trackingLocation || "-"}</td>
                        <td className="py-1 px-2 text-right">{formatAmount(parseFloat(container.dutyFee || "0"))}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={7} className="py-2 px-2 text-center text-muted-foreground">No OTW containers</td></tr>
                  )}
                </tbody>
                {agentData.containers.length > 0 && (
                  <tfoot className="bg-warning-soft text-warning-soft-foreground">
                    <tr>
                      <td colSpan={6} className="py-1 px-2 font-bold">Total OTW</td>
                      <td className="py-1 px-2 text-right font-bold">{formatAmount(agentData.containers.reduce((sum: number, c: any) => sum + parseFloat(c.dutyFee || "0"), 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="md:hidden space-y-2 p-2">
              {agentData.containers.length > 0 ? (
                agentData.containers.map((container: any) => (
                  <div key={container.id} className="border rounded-md p-2.5 text-xs space-y-1" data-testid={`card-otw-mobile-${container.id}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{container.containerNumber}</span>
                      <span className="font-bold">{formatAmount(parseFloat(container.dutyFee || "0"))}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                      <div><span className="text-muted-foreground">Supplier:</span> {container.supplierName || "-"}</div>
                      <div><span className="text-muted-foreground">Plate:</span> {container.numberPlate || "-"}</div>
                      <div><span className="text-muted-foreground">Border:</span> {formatDate(container.borderDate)}</div>
                      <div><span className="text-muted-foreground">Transporter:</span> {container.transporter || "-"}</div>
                      <div><span className="text-muted-foreground">Location:</span> {container.trackingLocation || "-"}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground text-xs py-2">No OTW containers</p>
              )}
              {agentData.containers.length > 0 && (
                <div className="bg-warning-soft text-warning-soft-foreground rounded-md p-2 flex justify-between text-xs font-bold">
                  <span>Total OTW</span>
                  <span>{formatAmount(agentData.containers.reduce((sum: number, c: any) => sum + parseFloat(c.dutyFee || "0"), 0))}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-3 p-3">
      <PageHeader
        title="Container Tracking"
        subtitle="Cross-company view of containers and agent statements"
      />

      <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="tracking" className="text-xs sm:text-sm" data-testid="tab-main-tracking">Tracking</TabsTrigger>
          <TabsTrigger value="statements" className="text-xs sm:text-sm" data-testid="tab-main-statements">Statements</TabsTrigger>
        </TabsList>

        <TabsContent value="tracking" className="mt-3">
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  className="w-full sm:w-[180px] justify-between"
                  data-testid="select-filter-company"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Building2 className="h-4 w-4" />
                    {filterCompany.length === 0 
                      ? "All Companies" 
                      : filterCompany.length === 1 
                        ? filterCompany[0]
                        : `${filterCompany.length} Companies`}
                  </div>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-2" align="start">
                <div className="space-y-1">
                  <div 
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer"
                    onClick={() => setFilterCompany([])}
                    data-testid="option-all-companies"
                  >
                    <Checkbox 
                      checked={filterCompany.length === 0} 
                      className="h-4 w-4"
                    />
                    <span className="text-xs font-medium">All Companies</span>
                  </div>
                  <div className="border-t my-1" />
                  {companyFilterOptions.map(([code, name]) => (
                    <div 
                      key={code}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer"
                      onClick={() => {
                        setFilterCompany(prev => 
                          prev.includes(code) 
                            ? prev.filter(c => c !== code)
                            : [...prev, code]
                        );
                      }}
                      data-testid={`option-company-${code}`}
                    >
                      <Checkbox 
                        checked={filterCompany.includes(code)} 
                        className="h-4 w-4"
                      />
                      <span className="text-xs">{name}</span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Select value={filterAgent} onValueChange={setFilterAgent}>
              <SelectTrigger className="w-full sm:w-[140px]" data-testid="select-filter-agent">
                <SelectValue placeholder="All Agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {agents.map(agent => (
                  <SelectItem key={agent} value={agent}>{agent}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterTransporter} onValueChange={setFilterTransporter}>
              <SelectTrigger className="w-full sm:w-[160px]" data-testid="select-filter-transporter">
                <SelectValue placeholder="All Transporters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Transporters</SelectItem>
                {transporters.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(filterAgent !== "all" || filterCompany.length > 0 || filterTransporter !== "all") && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFilterAgent("all");
                  setFilterCompany([]);
                  setFilterTransporter("all");
                }}
                data-testid="button-clear-filters"
              >
                Clear Filters
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-3">
            <div className="space-y-3 min-w-0">
              {/* Stats bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />OTW Containers</p>
                    <p className="text-2xl font-bold">{filteredData?.totals.count || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" />Total Value</p>
                    <p className="text-2xl font-bold">{formatAmount(filteredData?.totals.amount || 0)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><FileCheck className="h-3.5 w-3.5" />Docs Received</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {filteredData?.containers.filter(c => c.docReceived).length || 0}
                      <span className="text-sm font-normal text-muted-foreground ml-1">/ {filteredData?.totals.count || 0}</span>
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />Routes</p>
                    <p className="text-2xl font-bold">{Object.keys(filteredData?.byRoute || {}).length}</p>
                  </CardContent>
                </Card>
              </div>

              <ScrollArea className="h-[calc(100vh-310px)]">
                <div className="space-y-3">
                  {filteredData && Object.entries(filteredData.byRoute)
                    .sort(([a], [b]) => (a || '').localeCompare(b || ''))
                    .map(([route, containers]) => {
                      const routeTotal = containers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);
                      const isExpanded = expandedRoutes.has(route);
                      const docsOk = containers.filter(c => c.docReceived).length;

                      return (
                        <Card key={route}>
                          <Collapsible open={isExpanded} onOpenChange={() => toggleRoute(route)}>
                            <CollapsibleTrigger asChild>
                              <CardHeader className="cursor-pointer hover-elevate py-3 px-4">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5">
                                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                    <CardTitle className="text-sm font-semibold">
                                      {route === "Unassigned" ? "Unassigned Route" : route}
                                    </CardTitle>
                                    <Badge variant="secondary">{containers.length} container{containers.length !== 1 ? "s" : ""}</Badge>
                                    {docsOk > 0 && <Badge variant="outline" className="text-green-600 border-green-300 dark:border-green-700">{docsOk} docs ready</Badge>}
                                  </div>
                                  <span className="text-sm font-semibold tabular-nums">{formatAmount(routeTotal)}</span>
                                </div>
                              </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <CardContent className="p-0">
                                <div className="hidden md:block overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                                  <table className="w-full text-xs">
                                  <thead className="bg-muted/50 sticky top-0 z-10">
                                    <tr>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground w-7">#</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Container</th>
                                      <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Amount</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Supplier</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">ETA</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Plate</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Location</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Border</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Offload</th>
                                      <th className="text-center py-2 px-2 font-semibold text-muted-foreground w-8">Doc</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Transporter</th>
                                      <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Fee</th>
                                      <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Agent</th>
                                      <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Duty</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sortContainersByLocationAndEta(containers).map((container, idx) => (
                                      <tr
                                        key={container.id}
                                        className={cn(
                                          "border-t hover-elevate cursor-pointer",
                                          container.docReceived && "bg-green-500/10",
                                          isOverdue(container.eta) && !container.docReceived && "bg-yellow-500/10"
                                        )}
                                        onClick={() => handleContainerClick(container.companyId)}
                                        data-testid={`row-container-${container.id}`}
                                      >
                                        <td className="py-2 px-2 text-muted-foreground">{idx + 1}</td>
                                        <td
                                          className="py-2 px-2 font-mono text-primary underline cursor-pointer"
                                          onClick={(e) => handleContainerNumberClick(e, container.id)}
                                          data-testid={`link-container-${container.id}`}
                                        >
                                          {container.containerNumber}
                                        </td>
                                        <td className="py-2 px-2 text-right font-medium tabular-nums">{formatAmount(parseFloat(container.grandTotal || "0"))}</td>
                                        <td className="py-2 px-2">{container.supplierName || "-"}</td>
                                        <td className={cn("py-2 px-2 tabular-nums", isOverdue(container.eta) && "text-yellow-600 dark:text-yellow-400 font-medium")}>
                                          {formatDate(container.eta)}
                                        </td>
                                        <td className="py-2 px-2">{container.numberPlate || "-"}</td>
                                        <td className="py-2 px-2">{container.trackingLocation || "-"}</td>
                                        <td className="py-2 px-2 tabular-nums">{formatDate(container.borderDate)}</td>
                                        <td className="py-2 px-2 tabular-nums">{formatDate(container.offloadDate)}</td>
                                        <td className="py-2 px-2 text-center">
                                          {container.docReceived ? (
                                            <FileCheck className="h-3.5 w-3.5 text-green-600 mx-auto" />
                                          ) : (
                                            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mx-auto" />
                                          )}
                                        </td>
                                        <td className="py-2 px-2">{container.transporter || "-"}</td>
                                        <td className="py-2 px-2 text-right tabular-nums">{container.transportFee ? formatAmount(parseFloat(container.transportFee)) : "-"}</td>
                                        <td className="py-2 px-2">{container.agent || "-"}</td>
                                        <td className="py-2 px-2 text-right tabular-nums">{container.dutyFee ? formatAmount(parseFloat(container.dutyFee)) : "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  </table>
                                </div>
                                <div className="md:hidden space-y-2 p-2">
                                  {sortContainersByLocationAndEta(containers).map((container, idx) => (
                                    <div
                                      key={container.id}
                                      className={cn(
                                        "border rounded-md p-2.5 cursor-pointer text-xs space-y-1.5",
                                        container.docReceived && "bg-green-500/10",
                                        isOverdue(container.eta) && !container.docReceived && "bg-yellow-500/10"
                                      )}
                                      onClick={() => handleContainerClick(container.companyId)}
                                      data-testid={`card-container-mobile-${container.id}`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="font-mono text-primary underline cursor-pointer text-sm font-semibold"
                                          onClick={(e) => handleContainerNumberClick(e, container.id)}
                                        >
                                          {container.containerNumber}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          {container.docReceived ? (
                                            <FileCheck className="h-3.5 w-3.5 text-green-600" />
                                          ) : (
                                            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                                          )}
                                          <span className="font-bold">{formatAmount(parseFloat(container.grandTotal || "0"))}</span>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                        <div><span className="text-muted-foreground">Supplier:</span> {container.supplierName || "-"}</div>
                                        <div className={cn(isOverdue(container.eta) && "text-yellow-600 dark:text-yellow-400")}><span className="text-muted-foreground">ETA:</span> {formatDate(container.eta)}</div>
                                        <div><span className="text-muted-foreground">Plate:</span> {container.numberPlate || "-"}</div>
                                        <div><span className="text-muted-foreground">Location:</span> {container.trackingLocation || "-"}</div>
                                        <div><span className="text-muted-foreground">Border:</span> {formatDate(container.borderDate)}</div>
                                        <div><span className="text-muted-foreground">Offload:</span> {formatDate(container.offloadDate)}</div>
                                        <div><span className="text-muted-foreground">Transporter:</span> {container.transporter || "-"}</div>
                                        <div><span className="text-muted-foreground">Fee:</span> {container.transportFee ? formatAmount(parseFloat(container.transportFee)) : "-"}</div>
                                        <div><span className="text-muted-foreground">Agent:</span> {container.agent || "-"}</div>
                                        <div><span className="text-muted-foreground">Duty:</span> {container.dutyFee ? formatAmount(parseFloat(container.dutyFee)) : "-"}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </CollapsibleContent>
                          </Collapsible>
                        </Card>
                      );
                    })}
                </div>
              </ScrollArea>
            </div>

            <div className="w-full lg:w-[240px] shrink-0 space-y-3">
              {/* Agents panel */}
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Agents
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0 space-y-0.5">
                  {filteredData && Object.entries(filteredData.byAgent)
                    .filter(([agent]) => agent !== "Unassigned")
                    .sort(([, a], [, b]) => Math.abs(b.balance) - Math.abs(a.balance))
                    .map(([agent, agentData]) => (
                      <div
                        key={agent}
                        className={cn(
                          "flex items-center justify-between py-1.5 px-2 rounded-md hover-elevate cursor-pointer text-sm",
                          filterAgent === agent && "bg-accent"
                        )}
                        onClick={() => setFilterAgent(filterAgent === agent ? "all" : agent)}
                        data-testid={`card-agent-${agent}`}
                      >
                        <span className="font-medium truncate">{agent}</span>
                        <Badge variant="secondary">{agentData.containers.length}</Badge>
                      </div>
                    ))}
                  {filteredData?.byAgent["Unassigned"] && (
                    <div className="flex items-center justify-between py-1.5 px-2 rounded-md text-muted-foreground text-sm">
                      <span>Unassigned</span>
                      <Badge variant="outline">{filteredData.byAgent["Unassigned"].containers.length}</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Locations panel */}
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Locations
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0 space-y-0.5">
                  {filteredData && Object.entries(filteredData.byLocation)
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([location, locationData]) => (
                      <div
                        key={location}
                        className="flex items-center justify-between py-1.5 px-2 rounded-md text-sm"
                        data-testid={`card-location-${location}`}
                      >
                        <span className="truncate">{location}</span>
                        <Badge variant="secondary">{locationData.count}</Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>

              {/* Quick totals */}
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    Totals
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Containers</span>
                      <span className="font-semibold">{filteredData?.totals.count || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Value</span>
                      <span className="font-semibold tabular-nums">{formatAmount(filteredData?.totals.amount || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Items</span>
                      <span className="font-semibold">{formatNumber(filteredData?.totals.totalItems || 0)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between">
                      <span className="text-muted-foreground">Docs Ready</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">
                        {filteredData?.containers.filter(c => c.docReceived).length || 0}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pending Docs</span>
                      <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                        {filteredData?.containers.filter(c => !c.docReceived).length || 0}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="statements" className="mt-3">
          <ScrollArea className="h-[calc(100vh-180px)]">
            {renderAgentStatement()}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <Dialog open={poDialogOpen} onOpenChange={setPoDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Container Details: {poData?.container.containerNumber}
            </DialogTitle>
          </DialogHeader>

          {loadingPO ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : poData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={poData.container.status === "OFFLOADED" ? "default" : "secondary"} className="ml-2">
                    {poData.container.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Import Date:</span>
                  <span className="ml-2 font-medium">{formatDate(poData.container.importDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplier:</span>
                  <span className="ml-2 font-medium">{poData.supplier?.legalName || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>
                  <span className="ml-2 font-bold">{formatAmount(parseFloat(poData.container.grandTotal || "0"))}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Qty:</span>
                  <span className="ml-2 font-bold" data-testid="text-total-qty">
                    {poData.purchaseOrders.reduce((sum, po) => 
                      sum + po.lineItems.reduce((itemSum, item) => 
                        itemSum + parseFloat(item.quantity || "0"), 0), 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Items:</span>
                  <span className="ml-2 font-medium">
                    {poData.purchaseOrders.reduce((sum, po) => sum + po.lineItems.length, 0)} line items
                  </span>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3">Purchase Orders ({poData.purchaseOrders.length})</h4>
                {poData.purchaseOrders.map((po) => (
                  <Card key={po.id} className="mb-3">
                    <CardHeader className="py-2 px-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">PO #{po.poNumber}</CardTitle>
                        <Badge variant={po.status === "OFFLOADED" ? "default" : "secondary"} className="text-xs">
                          {po.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="py-2 px-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50 sticky top-0 z-10">
                            <tr>
                              <th className="text-left py-1 px-2">Item</th>
                              <th className="text-right py-1 px-2">Qty</th>
                              <th className="text-right py-1 px-2">Rate</th>
                              <th className="text-right py-1 px-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {po.lineItems.map((item, idx) => (
                              <tr key={idx} className="border-t">
                                <td className="py-1 px-2">
                                  <span className="font-mono text-[10px] text-muted-foreground">{item.stockItemCode}</span>
                                  <span className="ml-1">{item.stockItemName}</span>
                                </td>
                                <td className="py-1 px-2 text-right">{formatNumber(parseFloat(item.quantity || "0"), 0)}</td>
                                <td className="py-1 px-2 text-right">{formatNumber(parseFloat(item.rate || "0"))}</td>
                                <td className="py-1 px-2 text-right font-medium">{formatAmount(parseFloat(item.lineTotal || "0"))}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-muted/30">
                            <tr className="border-t font-medium">
                              <td className="py-1 px-2 text-right">Total Qty:</td>
                              <td className="py-1 px-2 text-right" data-testid="text-total-qty">{formatNumber(po.lineItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0))}</td>
                              <td className="py-1 px-2 text-right"></td>
                              <td className="py-1 px-2 text-right"></td>
                            </tr>
                            <tr className="font-medium">
                              <td colSpan={3} className="py-1 px-2 text-right">Items Total:</td>
                              <td className="py-1 px-2 text-right" data-testid="text-items-total">{formatAmount(parseFloat(po.itemsTotal || "0"))}</td>
                            </tr>
                            {parseFloat(po.freight || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Freight:</td>
                                <td className="py-0.5 px-2 text-right">{formatAmount(parseFloat(po.freight || "0"))}</td>
                              </tr>
                            )}
                            {parseFloat(po.surcharge || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Surcharge:</td>
                                <td className="py-0.5 px-2 text-right">{formatAmount(parseFloat(po.surcharge || "0"))}</td>
                              </tr>
                            )}
                            {parseFloat(po.otherCharges || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Other Charges:</td>
                                <td className="py-0.5 px-2 text-right">{formatAmount(parseFloat(po.otherCharges || "0"))}</td>
                              </tr>
                            )}
                            {parseFloat(po.discount || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Discount:</td>
                                <td className="py-0.5 px-2 text-right">-{formatAmount(parseFloat(po.discount || "0"))}</td>
                              </tr>
                            )}
                          </tfoot>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground py-4">No data available</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

