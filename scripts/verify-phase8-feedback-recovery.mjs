#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const feedback = await read("client/src/components/ui/action-feedback.tsx");
const pageState = await read("client/src/components/ui/page-state.tsx");
const errorBoundary = await read("client/src/components/ErrorBoundary.tsx");
const offlineBanner = await read("client/src/components/OfflineBanner.tsx");
const erpShell = await read("client/src/app/ErpShell.tsx");
const factoryShell = await read("client/src/app/FactoryShell.tsx");
const posShell = await read("client/src/app/PosShell.tsx");
const dialog = await read("client/src/components/ui/dialog.tsx");
const failures = [];

for (const token of [
  "ActionFeedback",
  "SavingFeedback",
  "SuccessFeedback",
  "WarningFeedback",
  "ErrorFeedback",
  "RecoveryFeedback",
  "ConfirmationFeedback",
  'aria-live={config.live}',
  'aria-atomic="true"',
  'aria-busy={tone === "progress"',
  "motion-reduce:animate-none",
  "text-success",
  "text-warning",
  "text-destructive",
  "break-words",
  "sm:flex-row",
  "sm:w-auto",
  'actionVariant="destructive"',
]) {
  if (!feedback.includes(token)) failures.push(`Feedback contract missing: ${token}`);
}

for (const token of ["LoadingState", "EmptyState", "ErrorState", 'role="alert"', 'aria-live="assertive"']) {
  if (!pageState.includes(token)) failures.push(`Page-state recovery contract missing: ${token}`);
}

for (const token of ["MAX_RETRIES", "canAutoRetry", "Page not available offline", "Reload page", "Try again", "Go back"]) {
  if (!errorBoundary.includes(token)) failures.push(`Error-boundary recovery contract missing: ${token}`);
}

for (const token of [
  "replayQueue",
  "handleManualSync",
  "handleRetry",
  "confirmDiscard",
  "AlertDialogTitle>Discard this action?",
  "Your offline data has been saved.",
  "failed to sync",
  "Session expired",
]) {
  if (!offlineBanner.includes(token)) failures.push(`Offline recovery contract missing: ${token}`);
}

for (const [name, source] of [
  ["ERP", erpShell],
  ["Factory", factoryShell],
  ["POS", posShell],
]) {
  if (!source.includes("<OfflineBanner />")) failures.push(`${name} shell is missing offline recovery coverage`);
  if (!source.includes("<ErrorBoundary")) failures.push(`${name} shell is missing route recovery coverage`);
  if (!source.includes("LoadingState")) failures.push(`${name} shell is missing consistent loading feedback`);
}

for (const token of ["DialogDescription", "DialogFooter", "sm:flex-row", "max-h-[calc(100dvh-2rem)]"]) {
  if (!dialog.includes(token)) failures.push(`Confirmation-dialog contract missing: ${token}`);
}

for (const forbidden of ["/api/", "useMutation(", "useQuery(", "queryClient", "stockQuantity", "saleTotal", "costPerKg"]) {
  if (feedback.includes(forbidden)) failures.push(`Feedback primitive contains business logic: ${forbidden}`);
}

if (failures.length) {
  console.error("Phase 8 feedback and recovery verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: 8, status: "complete", protectedContracts: 48 }, null, 2));