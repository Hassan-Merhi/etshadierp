import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FactoryArabicTranslationActions } from "@/components/FactoryArabicTranslationActions";

function renderActions(role: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["/api/auth/me"], { role });
  return render(
    <QueryClientProvider client={client}>
      <FactoryArabicTranslationActions />
    </QueryClientProvider>
  );
}

describe("Factory Arabic translation actions", () => {
  it("shows the controlled workbook actions to Factory administrators", () => {
    renderActions("Admin");
    expect(screen.getByTestId("button-export-arabic-template")).toHaveTextContent(
      "Export Arabic Names Template"
    );
    expect(screen.getByTestId("button-import-arabic-names")).toHaveTextContent(
      "Import Arabic Names"
    );
  });

  it("opens the preview-first import workflow", () => {
    renderActions("Owner");
    fireEvent.click(screen.getByTestId("button-import-arabic-names"));

    expect(
      screen.getByText("Import Arabic product and category names")
    ).toBeInTheDocument();
    expect(screen.getByTestId("input-arabic-translation-workbook")).toHaveAttribute(
      "accept",
      expect.stringContaining(".xlsx")
    );
    expect(screen.getByTestId("button-preview-arabic-import")).toBeDisabled();
    expect(screen.getByTestId("button-apply-arabic-import")).toBeDisabled();
    expect(screen.getByText("Fill missing Arabic names only")).toBeInTheDocument();
  });

  it("does not expose bulk translation controls to non-admin roles", () => {
    const { container } = renderActions("View Only");
    expect(container).toBeEmptyDOMElement();
  });
});
