import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageOnboardingDialog } from "./LanguageOnboardingDialog";

const setLanguage = vi.fn();

vi.mock("@/contexts/ApplicationLanguageContext", () => ({
  useApplicationLanguage: () => ({
    language: "en",
    setLanguage,
    isSaving: false,
  }),
}));

describe("LanguageOnboardingDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLanguage.mockClear();
  });

  it("lets an authenticated browser complete onboarding before testing workspace keyboard navigation", async () => {
    const { unmount } = render(<LanguageOnboardingDialog userId="release-smoke-user" />);

    expect(await screen.findByTestId("language-onboarding-dialog")).toBeVisible();

    fireEvent.click(screen.getByTestId("language-onboarding-fr"));
    expect(setLanguage).toHaveBeenCalledWith("fr");
    expect(screen.getByTestId("language-onboarding-fr")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByTestId("language-onboarding-continue"));
    await waitFor(() => expect(screen.queryByTestId("language-onboarding-dialog")).not.toBeInTheDocument());
    expect(window.localStorage.getItem("application-language-onboarding:v1:release-smoke-user")).toBe("completed");

    unmount();
    render(<LanguageOnboardingDialog userId="release-smoke-user" />);
    await waitFor(() => expect(screen.queryByTestId("language-onboarding-dialog")).not.toBeInTheDocument());
  });
});
