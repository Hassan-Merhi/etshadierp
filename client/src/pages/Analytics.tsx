import { useState, useEffect, useRef, Fragment } from "react";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { useQuery } from "@tanstack/react-query";
import { useAnalyticsQueries } from "./analytics/useAnalyticsQueries";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { TableCell, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { PageHeader } from "@/components/PageHeader";
import { ChevronRight, ChevronDown } from "lucide-react";
import { drCrClass } from "@/lib/formatNumber";
import { useAppMode } from "@/contexts/AppModeContext";
import { 
  Account, 
  LocationSales, 
  POSTransaction, 
  ContainerData, 
  Location, 
  StockGroup, 
  Supplier, 
  OpeningStockItemsData, 
  NetProfitAccount, 
  NetProfitStatementData,
  StockMovementData,
  OpeningStockSummaryData
} from "./analytics/analyticsTypes";
import { AccountsPanel } from "./analytics/AccountsPanel";
import { SalesReportPanel } from "./analytics/SalesReportPanel";
import { ContainerReportPanel } from "./analytics/ContainerReportPanel";
import { NetProfitPanel } from "./analytics/NetProfitPanel";
import { StockReportPanel } from "./analytics/StockReportPanel";
import { AnalyticsSidebar, sidebarGroups } from "./analytics/AnalyticsSidebar";
import { NetProfitAccountsList } from "./analytics/NetProfitAccountsList";
import { HierarchicalAccounts } from "./analytics/HierarchicalAccounts";
import {
  parseBalance,
  calculateChildrenTotal,
  calculateTotal,
  groupAccountsByParent,
  formatSmartCurrency,
  goToStatement
} from "./analytics/analyticsHelpers";

export default function Analytics() {
  const { formatDisplayDate } = useDateFormat();
  const appMode = useAppMode();
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const [, navigate] = useLocation();
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [detailsPeriod, setDetailsPeriod] = useState("all");
  const [periodFilter, setPeriodFilter] = useState(() => getDefaultPeriodValue("all_time"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [selectedLocationForDetails, setSelectedLocationForDetails] = useState<number | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set());
  
  // Report filters
  const [reportSupplierId, setReportSupplierId] = useState("all");
  const [reportContainerStatus, setReportContainerStatus] = useState("Offloaded");
  const [reportAllCompanies, setReportAllCompanies] = useState("all");
  const [containerPeriodFilter, setContainerPeriodFilter] = useState(() => getDefaultPeriodValue("this_month"));
  const containerCompanyInitialized = useRef(false);
  
  useEffect(() => {
    if (!containerCompanyInitialized.current && selectedCompany?.id) {
      setReportAllCompanies(String(selectedCompany.id));
      containerCompanyInitialized.current = true;
    }
  }, [selectedCompany?.id]);
  
  // Opening Stock Summary state
  const [openingStockLocationId, setOpeningStockLocationId] = useState("all");
  const [expandedStockGroups, setExpandedStockGroups] = useState<Set<number>>(new Set());
  const [stockGroupItems, setStockGroupItems] = useState<Map<number, OpeningStockItemsData>>(new Map());
  
  // Net Profit Report state
  const [expandedNetProfitSections, setExpandedNetProfitSections] = useState<Set<string>>(new Set());

  // Derive P&L and Balance date filters from the global period filter
  const plStartDate = periodFilter.fromDate;
  const plEndDate = periodFilter.toDate;
  const balStartDate = periodFilter.fromDate;
  const balEndDate = periodFilter.toDate;

  // Stock Movement state
  const [reportStartDate, setReportStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [reportEndDate, setReportEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reportLocationId, setReportLocationId] = useState("all");
  const [reportStockGroupId, setReportStockGroupId] = useState("all");

  // Factory-specific filters
  const [factoryContainerCustomerId, setFactoryContainerCustomerId] = useState("all");
  const [factoryContainerStartDate, setFactoryContainerStartDate] = useState("");
  const [factoryContainerEndDate, setFactoryContainerEndDate] = useState("");
  const [factoryContainerPaymentStatus, setFactoryContainerPaymentStatus] = useState("all");
  
  const [activeSection, setActiveSection] = useState("assets");
  useEscapeBack(activeSection !== "assets" ? () => setActiveSection("assets") : null);

  const {
    locations,
    stockGroups,
    suppliers,
    accounts,
    accountsLoading,
    salesData,
    salesLoading,
    transactions,
    transactionsLoading,
    userCompanies,
    containerData,
    loadingContainers,
    factorySalesByCustomer,
    loadingFactorySales,
    factoryPosSummary,
    loadingFactoryPos,
    factoryContainerSales,
    loadingFactoryContainerSales,
    netProfitData,
    loadingNetProfit,
    stockMovementData,
    loadingStock,
    openingStockData,
    loadingOpeningStock,
  } = useAnalyticsQueries({
    selectedCompanyId: selectedCompany?.id,
    activeSection,
    balStartDate,
    balEndDate,
    dateRange,
    selectedLocationForDetails,
    detailsDateRange,
    buildContainerUrl,
    appMode,
    buildFactorySalesUrl,
    buildFactoryContainerSalesUrl,
    plStartDate,
    plEndDate,
    buildStockMovementUrl,
    openingStockLocationId,
  });

  const toggleNetProfitSection = (section: string) => {
    const newExpanded = new Set(expandedNetProfitSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedNetProfitSections(newExpanded);
  };

  const toggleAccount = (accountId: number) => {
    const newExpanded = new Set(expandedAccounts);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedAccounts(newExpanded);
  };

  const toggleStockGroup = async (groupId: number) => {
    const newExpanded = new Set(expandedStockGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
      if (!stockGroupItems.has(groupId)) {
        try {
          const url = `/api/reports/opening-stock-summary/group/${groupId}${openingStockLocationId !== "all" ? `?locationId=${openingStockLocationId}` : ""}`;
          const response = await fetch(url, { credentials: "include" });
          if (response.ok) {
            const data = await response.json();
            setStockGroupItems(prev => new Map(prev).set(groupId, data));
          }
        } catch (error) {
          console.error("Failed to fetch stock group items:", error);
        }
      }
    }
    setExpandedStockGroups(newExpanded);
  };

  const handleOpeningStockLocationChange = (id: string) => {
    setOpeningStockLocationId(id);
    setExpandedStockGroups(new Set());
    setStockGroupItems(new Map());
  };

  const cashAccounts = accounts.filter(
    (acc) => 
      (acc.type === "ledger" && acc.accountType === "Cash") ||
      (acc.type === "bank" && (
        (acc.name || "").toLowerCase().includes("cash") || 
        (acc.code || "").toLowerCase().includes("cash")
      ))
  );

  const assetAccounts = accounts.filter(
    (acc) =>
      acc.type === "fixedAsset" ||
      (acc.type === "ledger" && acc.accountType === "Asset") ||
      acc.type === "bank"
  );

  const expenseAccounts = accounts.filter((acc) => {
    if (acc.type !== "ledger") return false;
    return acc.accountType === "Expense" || acc.accountType === "Indirect Expense" || acc.accountType === "Direct Expense";
  });

  const directExpenseAccounts = expenseAccounts.filter(
    (acc) => acc.subType === "Direct Expense" || acc.accountType === "Direct Expense"
  );

  const indirectExpenseAccounts = expenseAccounts.filter(
    (acc) => acc.subType === "Indirect Expense" || acc.accountType === "Indirect Expense"
  );

  const liabilityAccounts = accounts.filter(
    (acc) => 
      (acc.type === "ledger" && (
        acc.accountType === "Liability" ||
        acc.accountType === "Accounts Payable" ||
        acc.accountType === "Loans" ||
        acc.accountType === "Duty Agent" ||
        acc.accountType === "Transporter Agent"
      ))
  );

  const loansBanksAccounts = accounts.filter(
    (acc) =>
      acc.type === "bank" ||
      (acc.type === "ledger" && acc.accountType === "Loans")
  );


  return (
    <div className="flex flex-col h-full md:flex-row">
      <div className="md:hidden border-b bg-muted/30 px-3 py-2 shrink-0">
        <Select value={activeSection} onValueChange={setActiveSection}>
          <SelectTrigger className="w-full" data-testid="select-analytics-section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sidebarGroups.map(group => (
              <Fragment key={group.label}>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map(item => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </Fragment>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav className="hidden md:block w-56 shrink-0 border-r bg-muted/30 p-3 space-y-4 overflow-y-auto" data-testid="tabs-analytics">
        <AnalyticsSidebar activeSection={activeSection} setActiveSection={setActiveSection} />
      </nav>

      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <PageHeader title="Analytics" subtitle="Comprehensive financial analysis and reporting" />
          </div>
          {activeSection !== "containers" && (
            <PeriodFilter
              value={periodFilter}
              onChange={setPeriodFilter}
              data-testid="analytics-period-filter"
            />
          )}
        </div>

        <AccountsPanel 
          activeSection={activeSection}
          accountsLoading={accountsLoading}
          assetAccounts={assetAccounts}
          liabilityAccounts={liabilityAccounts}
          cashAccounts={cashAccounts}
          loansBanksAccounts={loansBanksAccounts}
          expenseAccounts={expenseAccounts}
          directExpenseAccounts={directExpenseAccounts}
          indirectExpenseAccounts={indirectExpenseAccounts}
          netProfitData={netProfitData}
          loadingNetProfit={loadingNetProfit}
          renderHierarchicalAccounts={(list) => {
            const { parentAccounts, accountMap } = groupAccountsByParent(list);
            return (
              <HierarchicalAccounts
                accountList={list}
                expandedAccounts={expandedAccounts}
                toggleAccount={toggleAccount}
                appMode={appMode}
                accountMap={accountMap}
                parentAccounts={parentAccounts}
              />
            );
          }}
          renderNetProfitAccountsList={(accts) => (
            <NetProfitAccountsList accts={accts} appMode={appMode} />
          )}
          calculateTotal={calculateTotal}
          formatSmartCurrency={formatSmartCurrency}
        />

        {activeSection === "sales" && (
          <SalesReportPanel 
            appMode={appMode}
            factorySalesStartDate={factorySalesStartDate}
            setFactorySalesStartDate={setFactorySalesStartDate}
            factorySalesEndDate={factorySalesEndDate}
            setFactorySalesEndDate={setFactorySalesEndDate}
            loadingFactorySales={loadingFactorySales}
            factorySalesByCustomer={factorySalesByCustomer}
            loadingFactoryPos={loadingFactoryPos}
            factoryPosSummary={factoryPosSummary}
            formatAmount={formatAmount}
            formatNumber={(num) => num.toLocaleString()}
            selectedPeriod={selectedPeriod}
            setSelectedPeriod={setSelectedPeriod}
            rangeStart={rangeStart}
            setRangeStart={setRangeStart}
            rangeEnd={rangeEnd}
            setRangeEnd={setRangeEnd}
            salesLoading={salesLoading}
            salesData={salesData}
            selectedLocationForDetails={selectedLocationForDetails}
            setSelectedLocationForDetails={setSelectedLocationForDetails}
            detailsPeriod={detailsPeriod}
            setDetailsPeriod={setDetailsPeriod}
            transactionsLoading={transactionsLoading}
            transactions={transactions}
            formatDisplayDate={formatDisplayDate}
          />
        )}

        {activeSection === "containers" && (
          <ContainerReportPanel 
            appMode={appMode}
            factoryContainerSales={factoryContainerSales}
            loadingFactoryContainerSales={loadingFactoryContainerSales}
            formatAmount={formatAmount}
            containerPeriodFilter={containerPeriodFilter}
            setContainerPeriodFilter={setContainerPeriodFilter}
            reportSupplierId={reportSupplierId}
            setReportSupplierId={setReportSupplierId}
            suppliers={suppliers}
            reportContainerStatus={reportContainerStatus}
            setReportContainerStatus={setReportContainerStatus}
            reportAllCompanies={reportAllCompanies}
            setReportAllCompanies={setReportAllCompanies}
            userCompanies={userCompanies}
            loadingContainers={loadingContainers}
            containerData={containerData}
          />
        )}

        {activeSection === "reports" && (
          <NetProfitPanel 
            loadingNetProfit={loadingNetProfit}
            netProfitData={netProfitData}
            plStartDate={plStartDate}
            plEndDate={plEndDate}
            formatAmount={formatAmount}
            appMode={appMode}
            navigate={navigate}
            toggleNetProfitSection={toggleNetProfitSection}
            expandedNetProfitSections={expandedNetProfitSections}
            setActiveSection={setActiveSection}
          />
        )}

        {(activeSection === "stock" || activeSection === "opening-stock") && (
          <StockReportPanel
            activeSection={activeSection}
            reportStartDate={reportStartDate}
            setReportStartDate={setReportStartDate}
            reportEndDate={reportEndDate}
            setReportEndDate={setReportEndDate}
            reportLocationId={reportLocationId}
            setReportLocationId={setReportLocationId}
            locations={locations}
            reportStockGroupId={reportStockGroupId}
            setReportStockGroupId={setReportStockGroupId}
            stockGroups={stockGroups}
            loadingStock={loadingStock}
            stockMovementData={stockMovementData}
            formatNumber={(num) => num.toLocaleString()}
            formatAmount={formatAmount}
            openingStockLocationId={openingStockLocationId}
            handleOpeningStockLocationChange={handleOpeningStockLocationChange}
            loadingOpeningStock={loadingOpeningStock}
            openingStockData={openingStockData}
            expandedStockGroups={expandedStockGroups}
            toggleStockGroup={toggleStockGroup}
            stockGroupItems={stockGroupItems}
          />
        )}
      </div>
    </div>
  );
}
