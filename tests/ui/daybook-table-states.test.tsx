import { render, screen } from "@testing-library/react";
import { DaybookTable } from "@/pages/daybook/DaybookTable";
import type { DaybookRow, Voucher } from "@/pages/daybook/types";

const voucher: Voucher = {
  id: 1,
  voucherNumber: "PV-1",
  voucherType: "Payment",
  voucherDate: "2026-08-04",
  description: "Payment (SAFE)",
  totalAmount: "119830.00",
  optional: false,
  createdAt: "2026-08-04T09:00:00.000Z",
} as Voucher;

const rows: DaybookRow[] = [{ _type: "voucher", data: voucher }];

function renderTable(overrides: Partial<React.ComponentProps<typeof DaybookTable>> = {}) {
  const props: React.ComponentProps<typeof DaybookTable> = {
    displayedRows: rows,
    visibleRows: rows,
    viewMode: "detailed",
    selectedRowId: null,
    setSelectedRowId: () => {},
    hiddenRowIds: new Set(),
    setHiddenRowIds: () => {},
    showHidden: false,
    expandedVoucherId: null,
    setExpandedVoucherId: () => {},
    expandedCondensedGroups: new Set(),
    setExpandedCondensedGroups: () => {},
    hideAmounts: false,
    accountNameCache: {},
    expandedLoading: false,
    expandedEntries: [],
    formatAmount: (amount: any) => String(amount),
    formatDisplayDate: (date: any) => String(date),
    formatDisplayTime: (date: string) => date,
    handleView: () => {},
    handleEdit: () => {},
    handleDelete: () => {},
    canEdit: () => true,
    canDelete: () => true,
    daybookRowLimit: 200,
    setDaybookRowLimit: () => {},
    DAYBOOK_PAGE_SIZE: 200,
    navigate: () => {},
    ...overrides,
  };
  return render(<DaybookTable {...props} />);
}

describe("Daybook transactions table states", () => {
  it("renders the vouchers it is given", () => {
    renderTable();
    expect(screen.getAllByTestId("row-voucher-1").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("daybook-empty")).toBeNull();
  });

  it("shows a skeleton while the page is loading instead of a bare header", () => {
    renderTable({ displayedRows: [], visibleRows: [], isLoading: true });
    expect(screen.getByTestId("daybook-loading")).toBeTruthy();
    expect(screen.queryByTestId("daybook-empty")).toBeNull();
  });

  it("surfaces a failed request rather than looking like an empty day", () => {
    renderTable({
      displayedRows: [],
      visibleRows: [],
      errorMessage: "No access to this company",
      onRetry: () => {},
    });
    expect(screen.getByTestId("daybook-error").textContent).toContain("No access to this company");
    expect(screen.getByTestId("button-daybook-retry")).toBeTruthy();
  });

  it("states plainly when the period really has no transactions", () => {
    renderTable({ displayedRows: [], visibleRows: [] });
    expect(screen.getByTestId("daybook-empty")).toBeTruthy();
  });
});
