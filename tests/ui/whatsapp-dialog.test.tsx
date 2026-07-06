/**
 * WhatsApp prompt dialog render tests.
 *
 * Renders a minimal harness that mirrors the AlertDialog structure used in
 * JournalForm (lines 1646-1672) so we can assert open/close behaviour
 * without pulling in the full 1600-line form and all its dependencies.
 */
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Minimal harness ───────────────────────────────────────────────────────────

interface HarnessProps {
  /** mirrors the `whatsapp.prompt` flag returned by the voucher-save API */
  initialPrompt: boolean;
  onSend?: () => void;
}

function WaDialogHarness({ initialPrompt, onSend }: HarnessProps) {
  const [open, setOpen] = useState(initialPrompt);

  return (
    <>
      <button
        data-testid="trigger-open"
        onClick={() => setOpen(true)}
      >
        Open
      </button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="dialog-whatsapp-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle>Send Statement via WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              A WhatsApp number is available. Send the statement now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-whatsapp-skip"
              onClick={() => setOpen(false)}
            >
              Skip
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-whatsapp-send"
              onClick={() => {
                onSend?.();
                setOpen(false);
              }}
            >
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WhatsApp prompt dialog", () => {
  it("appears when prompt = true", () => {
    render(<WaDialogHarness initialPrompt={true} />);
    expect(screen.getByTestId("dialog-whatsapp-prompt")).toBeInTheDocument();
    expect(screen.getByText("Send Statement via WhatsApp?")).toBeInTheDocument();
  });

  it("does not appear when prompt = false", () => {
    render(<WaDialogHarness initialPrompt={false} />);
    expect(
      screen.queryByTestId("dialog-whatsapp-prompt")
    ).not.toBeInTheDocument();
  });

  it("closes when Skip is clicked", () => {
    render(<WaDialogHarness initialPrompt={true} />);
    const skip = screen.getByTestId("button-whatsapp-skip");
    fireEvent.click(skip);
    expect(
      screen.queryByTestId("dialog-whatsapp-prompt")
    ).not.toBeInTheDocument();
  });

  it("calls onSend and closes when Send is clicked", () => {
    const onSend = vi.fn();
    render(<WaDialogHarness initialPrompt={true} onSend={onSend} />);
    fireEvent.click(screen.getByTestId("button-whatsapp-send"));
    expect(onSend).toHaveBeenCalledOnce();
    expect(
      screen.queryByTestId("dialog-whatsapp-prompt")
    ).not.toBeInTheDocument();
  });

  it("can be opened imperatively (mimics API response with prompt=true)", () => {
    render(<WaDialogHarness initialPrompt={false} />);
    // Dialog not yet visible
    expect(
      screen.queryByTestId("dialog-whatsapp-prompt")
    ).not.toBeInTheDocument();
    // Simulate voucher-save response returning prompt=true
    fireEvent.click(screen.getByTestId("trigger-open"));
    expect(screen.getByTestId("dialog-whatsapp-prompt")).toBeInTheDocument();
  });
});
