import React, { createContext, useContext } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
}));

const analysisRow = {
  stockItemId: 7,
  code: "SH-1",
  name: "Shirts",
  salesQty: 10,
  avgSellingPrice: 20,
  groupSellingPrice: 22,
  poPrice: 12,
  poPriceSource: "supplier_po",
  nCost: 11,
  inventoryAvgCost: 9,
  configPrice: 18,
  currentStock: 5,
  proformaQty: 3,
  status: "gaining",
};

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: harness.invalidateQueries }),
  useQuery: ({ queryKey }: any) => {
    const root = queryKey?.[0];
    if (root === "/api/suppliers-all-spc") return { data: [{ id: 2, legalName: "Supplier A", stockGroupId: 5 }] };
    if (root === "/api/stock-groups") return { data: [{ id: 5, name: "Group A" }] };
    if (root === "/api/suppliers") return { data: [{ id: 31, reference: "PF-31" }] };
    if (root === "/api/supplier-profit-check/location-groups") return { data: [{ id: 11, name: "Retail" }] };
    if (root === "/api/supplier-profit-check/otw-containers") return { data: [], isLoading: false };
    if (root === "/api/supplier-profit-check/analyze") return { data: [analysisRow], isLoading: false };
    if (root === "/api/supplier-profit-check/po-overrides") return { data: [] };
    return { data: [] };
  },
  useMutation: (config: any) => ({
    isPending: false,
    mutate: vi.fn(async (value?: any) => {
      try {
        const result = await config.mutationFn(value);
        config.onSuccess?.(result, value);
        return result;
      } catch (error) {
        config.onError?.(error);
        throw error;
      }
    }),
  }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { id: 4, name: "GC Lshi" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: harness.apiRequest }));
vi.mock("@/components/ui/period-filter", () => ({
  PeriodFilter: ({ onChange }: any) => (
    <button type="button" onClick={() => onChange({ fromDate: "2026-08-01", toDate: "2026-08-12", preset: "custom" })}>
      Set sales period
    </button>
  ),
}));
vi.mock("@/pages/supplierprofitcheck/utils", () => ({
  STORAGE_KEY_COLS: "supplier-profit-columns",
  fmt: (value: number, digits = 2) => Number(value || 0).toFixed(digits),
  STATUS_OPTIONS: [
    { value: "gaining", label: "Gaining", dot: "green" },
    { value: "losing", label: "Losing", dot: "red" },
    { value: "missing_po", label: "Missing PO", dot: "orange" },
  ],
  ALL_COLUMNS: [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "salesQty", label: "Sales Qty" },
    { key: "avgSell", label: "Avg Sell" },
    { key: "dubaiPrice", label: "Dubai Price" },
    { key: "extraPerBale", label: "Extra / Bale" },
    { key: "landingCost", label: "Landing Cost" },
    { key: "costProfit", label: "Cost Profit" },
    { key: "status", label: "Status" },
    { key: "qtyToOrder", label: "Qty to Order" },
    { key: "inventoryAvgCost", label: "Inv Avg Cost" },
    { key: "hassanPrice", label: "Hassan Price" },
    { key: "hassanProfit", label: "Hassan Profit" },
    { key: "currentStock", label: "Stock" },
  ],
  DEFAULT_COL_VISIBILITY: {
    code: true,
    name: true,
    salesQty: true,
    avgSell: true,
    dubaiPrice: true,
    extraPerBale: true,
    landingCost: true,
    costProfit: true,
    status: true,
    qtyToOrder: true,
    inventoryAvgCost: true,
    hassanPrice: true,
    hassanProfit: true,
    currentStock: true,
  },
  loadColVisibility: () => ({
    code: true,
    name: true,
    salesQty: true,
    avgSell: true,
    dubaiPrice: true,
    extraPerBale: true,
    landingCost: true,
    costProfit: true,
    status: true,
    qtyToOrder: true,
    inventoryAvgCost: true,
    hassanPrice: true,
    hassanProfit: true,
    currentStock: true,
  }),
}));
vi.mock("@/pages/supplierprofitcheck/components/ProfitCell", () => ({
  ProfitCell: ({ value, pct }: any) => <span data-testid="profit-cell">{value == null ? "none" : `${value}:${pct}`}</span>,
}));
vi.mock("@/pages/supplierprofitcheck/components/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));
vi.mock("@/pages/supplierprofitcheck/components/StatCard", () => ({
  StatCard: ({ label, value, sub }: any) => (
    <div data-testid={`stat-${String(label).toLowerCase().replace(/\s+/g, "-")}`}>
      {label}:{value}:{sub ?? ""}
    </div>
  ),
}));

const SelectContext = createContext<((value: string) => void) | null>(null);
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => (
    <SelectContext.Provider value={onValueChange}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder ?? "selected"}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => {
    const onChange = useContext(SelectContext);
    return (
      <button type="button" onClick={() => onChange?.(value)}>
        {children}
      </button>
    );
  },
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

import SupplierProfitCheck from "@/pages/SupplierProfitCheck";

describe("supplier profit check page behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.apiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/api/supplier-profit-check/save-proforma") {
        return { ok: true, json: async () => ({ id: 88, reference: "PF-NEW" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}), blob: async () => new Blob() })),
    );
  });

  it("loads supplier analysis and computes profit from the selected quantity", async () => {
    render(<SupplierProfitCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Supplier A" }));

    await waitFor(() => expect(screen.getByTestId("row-item-7")).toBeInTheDocument());
    expect(screen.getByTestId("input-qty-7")).toHaveValue(3);
    expect(screen.getByTestId("stat-items")).toHaveTextContent("Items:1:of 1");
    expect(screen.getByTestId("stat-total-qty")).toHaveTextContent("Total Qty:3");
    expect(screen.getByTestId("stat-total-landing-cost")).toHaveTextContent("$36.00");
    expect(screen.getByTestId("stat-cost-profit")).toHaveTextContent("$24.00");
    expect(screen.getByTestId("status-badge")).toHaveTextContent("gaining");
  });

  it("allocates landing charges per bale and updates total cost profit immediately", async () => {
    render(<SupplierProfitCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Supplier A" }));
    await waitFor(() => expect(screen.getByTestId("input-freight")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-freight"), { target: { value: "6" } });
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByText("$2.00")).toBeInTheDocument();
    expect(screen.getByTestId("stat-total-landing-cost")).toHaveTextContent("$42.00");
    expect(screen.getByTestId("stat-cost-profit")).toHaveTextContent("$18.00");
  });

  it("filters analysis rows by status and search text", async () => {
    render(<SupplierProfitCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Supplier A" }));
    await waitFor(() => expect(screen.getByTestId("row-item-7")).toBeInTheDocument());

    const search = screen.getByPlaceholderText(/search/i);
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("No items match your filters")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "SH-1" } });
    expect(screen.getByTestId("row-item-7")).toBeInTheDocument();
  });

  it("creates a proforma using the computed order quantities", async () => {
    render(<SupplierProfitCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Supplier A" }));
    await waitFor(() => expect(screen.getByTestId("button-create-proforma")).toBeEnabled());
    fireEvent.click(screen.getByTestId("button-create-proforma"));

    fireEvent.change(screen.getByTestId("input-proforma-ref"), { target: { value: "PF-CHECK" } });
    fireEvent.change(screen.getByTestId("input-proforma-notes"), { target: { value: "profit approved" } });
    fireEvent.click(screen.getByTestId("button-confirm-save"));

    await waitFor(() =>
      expect(harness.apiRequest).toHaveBeenCalledWith("POST", "/api/supplier-profit-check/save-proforma", {
        supplierId: 2,
        reference: "PF-CHECK",
        notes: "profit approved",
        items: [
          expect.objectContaining({
            barcode: "SH-1",
            code: "SH-1",
            name: "Shirts",
            qty: 3,
            supplierPrice: 12,
          }),
        ],
      }),
    );
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Proforma saved", description: "Reference: PF-NEW" }),
    );
  });
});
