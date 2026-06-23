import type React from "react";

export function handlePaymentKeyDown(
  e: React.KeyboardEvent,
  rowIndex: number,
  fieldName: "account" | "amount",
  fieldsLength: number,
  append: (v: any) => void
): void {
  const isLastRow = rowIndex === fieldsLength - 1;

  if (fieldName === "account" && e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    setTimeout(() => {
      const amountInput = document.querySelector(
        `[data-testid="input-amount-${rowIndex}"]`
      ) as HTMLInputElement;
      if (amountInput) { amountInput.focus(); amountInput.select(); }
    }, 50);
  }

  if (fieldName === "amount") {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rowIndex > 0) {
        setTimeout(() => {
          const prevInput = document.querySelector(`[data-testid="input-amount-${rowIndex - 1}"]`) as HTMLInputElement;
          if (prevInput) { prevInput.focus(); prevInput.select(); }
        }, 50);
      }
      return;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rowIndex < fieldsLength - 1) {
        setTimeout(() => {
          const nextInput = document.querySelector(`[data-testid="input-amount-${rowIndex + 1}"]`) as HTMLInputElement;
          if (nextInput) { nextInput.focus(); nextInput.select(); }
        }, 50);
      }
      return;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setTimeout(() => {
        const accountInput = document.querySelector(`[data-testid="input-account-${rowIndex}"]`) as HTMLInputElement;
        if (accountInput) accountInput.focus();
      }, 50);
      return;
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (rowIndex < fieldsLength - 1) {
        setTimeout(() => {
          const nextAccountInput = document.querySelector(`[data-testid="input-account-${rowIndex + 1}"]`) as HTMLInputElement;
          if (nextAccountInput) nextAccountInput.focus();
        }, 50);
      }
      return;
    }
  }

  if (fieldName === "amount" && ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter")) {
    e.preventDefault();
    if (isLastRow) {
      append({ accountType: "ledger", accountId: 0, accountName: "", amount: "" });
    }
    setTimeout(() => {
      const newRowInput = document.querySelector(
        `[data-testid="input-account-${rowIndex + 1}"]`
      ) as HTMLInputElement;
      if (newRowInput) newRowInput.focus();
    }, 100);
  }
}
