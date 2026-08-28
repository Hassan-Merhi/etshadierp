import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ asChild, children, ...props }: any) =>
    asChild ? React.cloneElement(children, props) : <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

import { InsuranceImportDialog } from "@/pages/factory/factoryinsurance/components/InsuranceImportDialog";

describe("InsuranceImportDialog", () => {
  it("renders the authenticated template download with the expected filename", () => {
    render(<InsuranceImportDialog open onClose={vi.fn()} />);

    const downloadLink = screen.getByRole("link", { name: "Download Template" });

    expect(downloadLink).toBeVisible();
    expect(downloadLink).toHaveAttribute("href", "/api/insurance/import/template");
    expect(downloadLink).toHaveAttribute("download", "Insurance_Import_Template.xlsx");
  });
});