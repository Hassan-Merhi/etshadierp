import { Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  AccountGroups,
  Agents,
  BalanceRepair,
  ChatbotSettings,
  CompanyDataReset,
  CompanyTransfer,
  DeletedItems,
  ImportCycleDiagnostics,
  InventoryRepair,
  MySettings,
  NetProfitDetails,
  OrphanedRecords,
  PropertiesAccounts,
  PropertiesAnalytics,
  PropertiesCreate,
  PropertiesDashboard,
  PropertiesDaybook,
  PropertiesLedgerMonthly,
  PropertiesLedgerVouchers,
  PropertiesRentalPayments,
  PropertiesRentalShops,
  PropertiesRentalWarehouses,
  PropertiesSettings,
  PropertiesVoucherDetail,
  PropertiesVoucherEdit,
  PropertiesVouchers,
} from "@/lazyPages";

interface PropertiesRoutesProps {
  user: any;
  currentLocation: string;
}

/**
 * Route switch for the Properties company shell.
 * Rendered inside the Properties sidebar layout when
 * `isPropertiesCompany && (isPropertiesRoute || currentLocation === "/balance-repair")`.
 */
export function PropertiesRoutes({ user, currentLocation }: PropertiesRoutesProps) {
  return (
    <ErrorBoundary resetKey={currentLocation}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Loading...
          </div>
        }
      >
        <Switch>
          <Route path="/properties/dashboard" component={PropertiesDashboard} />
          <Route path="/properties/accounts" component={PropertiesAccounts} />
          <Route path="/properties/vouchers/:id/edit" component={PropertiesVoucherEdit} />
          <Route path="/properties/voucher-detail/:voucherId" component={PropertiesVoucherDetail} />
          <Route path="/properties/vouchers">{() => <PropertiesVouchers />}</Route>
          <Route path="/properties/create" component={PropertiesCreate} />
          <Route path="/properties/analytics" component={PropertiesAnalytics} />
          <Route path="/properties/agents" component={Agents} />
          <Route path="/properties/daybook" component={PropertiesDaybook} />
          <Route path="/properties/rental/warehouses" component={PropertiesRentalWarehouses} />
          <Route path="/properties/rental/shops" component={PropertiesRentalShops} />
          <Route path="/properties/rental/payments" component={PropertiesRentalPayments} />
          {user?.role === "Developer" && (
            <Route path="/properties/transfer" component={CompanyTransfer} />
          )}
          <Route path="/properties/ledger-monthly/:accountId" component={PropertiesLedgerMonthly} />
          <Route
            path="/properties/ledger-vouchers/:accountId/:year/:month"
            component={PropertiesLedgerVouchers}
          />
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/settings" component={PropertiesSettings} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/net-position-details" component={NetProfitDetails} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/deleted-items" component={DeletedItems} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/orphaned-records" component={OrphanedRecords} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/chatbot-settings" component={ChatbotSettings} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/import-cycle-diagnostics" component={ImportCycleDiagnostics} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/inventory-repair" component={InventoryRepair} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/company-data-reset" component={CompanyDataReset} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/properties/account-groups" component={AccountGroups} />
          )}
          {(user?.role === "Admin" || user?.role === "Developer") && (
            <Route path="/balance-repair" component={BalanceRepair} />
          )}
          <Route path="/my-settings" component={MySettings} />
          <Route>
            <Redirect to="/properties/daybook" />
          </Route>
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}
