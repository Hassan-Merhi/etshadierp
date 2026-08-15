/**
 * The convergence report tells the truth about itself.
 *
 * The reconciler had been running behind an endpoint that nothing rendered, so
 * the only way to read it was curl. Putting it on a screen is only worth doing
 * if the screen preserves the two distinctions the endpoint is careful about:
 * "everything agrees" is not the same as "we could not trust what we read", and
 * a report is not a repair tool.
 *
 * These tests pin exactly that. The endpoint answers 409 when the evidence is
 * untrustworthy, and a page that rendered a 409 as an empty, clean-looking
 * report would turn a fail-closed guarantee into a false all-clear — the one
 * failure mode that makes the whole reconciliation worse than useless.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ConvergenceReconciliation from "./ConvergenceReconciliation";

interface Discrepancy {
  domain: "accounting" | "inventory";
  identity: string;
  code: string;
  expected: string;
  actual: string;
}

function renderWithResult(result: unknown | (() => never)) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async () => (typeof result === "function" ? (result as () => never)() : result),
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ConvergenceReconciliation />
    </QueryClientProvider>
  );
}

function report(overrides: { discrepancies?: Discrepancy[]; clean?: boolean } = {}) {
  const discrepancies = overrides.discrepancies ?? [];
  return {
    companyId: 7,
    accountingSnapshots: 128,
    stockSnapshots: 44,
    discrepancies,
    clean: overrides.clean ?? discrepancies.length === 0,
  };
}

function rejection(status: number, code: string, message: string) {
  return () => {
    const error = Object.assign(new Error(message), { status, code });
    throw error;
  };
}

describe("ConvergenceReconciliation page", () => {
  it("reports a clean run with the volume it actually checked", async () => {
    renderWithResult(report());

    expect(await screen.findByTestId("card-status")).toHaveTextContent("Everything agrees");
    // A clean verdict means nothing without the sample size behind it: "no
    // discrepancies" over zero documents is a broken loader, not a healthy ledger.
    expect(screen.getByTestId("card-accounting-snapshots")).toHaveTextContent("128");
    expect(screen.getByTestId("card-stock-snapshots")).toHaveTextContent("44");
    expect(screen.getByTestId("text-no-discrepancies")).toBeInTheDocument();
  });

  it("lists each discrepancy with the evidence that disagreed", async () => {
    renderWithResult(
      report({
        discrepancies: [
          {
            domain: "accounting",
            identity: "voucher:912",
            code: "VOUCHER_LEDGER_CREDIT_MISMATCH",
            expected: "500.00",
            actual: "450.00",
          },
          {
            domain: "inventory",
            identity: "stock-transfer:44",
            code: "STOCK_MOVEMENT_QUANTITY_MISMATCH",
            expected: "12",
            actual: "10",
          },
        ],
      })
    );

    const row = await screen.findByTestId("row-voucher:912");
    expect(row).toHaveTextContent("VOUCHER_LEDGER_CREDIT_MISMATCH");
    expect(row).toHaveTextContent("500.00");
    expect(row).toHaveTextContent("450.00");
    expect(screen.getByTestId("row-stock-transfer:44")).toHaveTextContent("STOCK_MOVEMENT_QUANTITY_MISMATCH");

    expect(screen.getByTestId("text-discrepancy-count")).toHaveTextContent("2");
    expect(screen.getByTestId("badge-accounting-count")).toHaveTextContent("1");
    expect(screen.getByTestId("badge-inventory-count")).toHaveTextContent("1");
  });

  it("shows rejected evidence as its own state, never as a clean report", async () => {
    renderWithResult(
      rejection(409, "DUPLICATE_DAYBOOK_MIRROR", "Voucher 912 has two Daybook mirror rows in company 7")
    );

    const rejected = await screen.findByTestId("card-evidence-rejected");
    expect(rejected).toHaveTextContent("DUPLICATE_DAYBOOK_MIRROR");
    expect(rejected).toHaveTextContent("two Daybook mirror rows");

    // The failure this test exists for: a 409 rendered through the ordinary
    // empty state would read as "every document checked agrees with its
    // evidence" when in fact nothing was successfully checked.
    expect(screen.queryByTestId("text-no-discrepancies")).toBeNull();
    expect(screen.queryByTestId("card-status")).toBeNull();
  });

  it("does not mistake an ordinary failure for rejected evidence", async () => {
    renderWithResult(rejection(500, "INTERNAL", "boom"));

    await expect(screen.findByTestId("card-evidence-rejected", {}, { timeout: 250 })).rejects.toThrow();
    expect(screen.queryByTestId("card-status")).toBeNull();
  });

  it("offers no control that could change what it reports", async () => {
    renderWithResult(
      report({
        discrepancies: [
          {
            domain: "accounting",
            identity: "voucher:912",
            code: "VOUCHER_LEDGER_CREDIT_MISMATCH",
            expected: "500.00",
            actual: "450.00",
          },
        ],
      })
    );

    await screen.findByTestId("row-voucher:912");

    // A "fix it" button here would let someone erase the evidence that a
    // discrepancy ever existed. Corrections belong in the posting and reversal
    // services, which leave their own trail. Refresh re-reads; nothing writes.
    // Every button, named — not just the ones carrying a test id, so an
    // unlabelled write control cannot slip past this assertion.
    const buttons = screen.getAllByRole("button").map((button) => button.textContent?.trim());
    expect(buttons).toEqual(["Refresh"]);
    expect(screen.getByTestId("text-read-only-notice")).toHaveTextContent("never changes data");
  });
});
