import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageOnboardingDialog } from "./LanguageOnboardingDialog";

const setLanguage = vi.fn();
let isSaving = false;

vi.mock("@/contexts/ApplicationLanguageContext", () => ({
  useApplicationLanguage: () => ({
    language: "en",
    setLanguage,
    isSaving,
  }),
}));

describe("LanguageOnboardingDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLanguage.mockClear();
    isSaving = false;
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

  it("stays completable while the preference save is still in flight", async () => {
    // The dialog blocks Escape and outside clicks and offers no close control,
    // so Continue is the only way out. If it were gated on the background save,
    // a slow or stalled request would trap the user in an undismissable modal.
    isSaving = true;
    render(<LanguageOnboardingDialog userId="slow-network-user" />);

    expect(await screen.findByTestId("language-onboarding-dialog")).toBeVisible();

    const continueButton = screen.getByTestId("language-onboarding-continue");
    expect(continueButton).not.toBeDisabled();
    expect(continueButton).toHaveAttribute("aria-busy", "true");
    expect(continueButton).toHaveAccessibleName("Continue · متابعة · Continuer");

    fireEvent.click(continueButton);
    await waitFor(() => expect(screen.queryByTestId("language-onboarding-dialog")).not.toBeInTheDocument());
    expect(window.localStorage.getItem("application-language-onboarding:v1:slow-network-user")).toBe("completed");
  });
});
