#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const feedback = await read("client/src/components/ui/action-feedback.tsx");
const pageState = await read("client/src/components/ui/page-state.tsx");
const errorBoundary = await read("client/src/components/ErrorBoundary.tsx");
const failures = [];

for (const token of [
  "ActionFeedback",
  "SavingFeedback",
  "SuccessFeedback",
  "WarningFeedback",
  "ErrorFeedback",
  'aria-live={config.live}',
  'aria-atomic="true"',
  'aria-busy={tone === "progress"',
  "motion-reduce:animate-none",
  "text-success",
  "text-warning",
  "text-destructive",
  "break-words",
]) {
  if (!feedback.includes(token)) failures.push(`Feedback contract missing: ${token}`);
}

for (const token of ["LoadingState", "EmptyState", "ErrorState", 'role="alert"', 'aria-live="assertive"']) {
  if (!pageState.includes(token)) failures.push(`Page-state recovery contract missing: ${token}`);
}

for (const token of ["MAX_RETRIES", "canAutoRetry", "Page not available offline", "Reload page", "Try again", "Go back"]) {
  if (!errorBoundary.includes(token)) failures.push(`Error-boundary recovery contract missing: ${token}`);
}

for (const forbidden of ["/api/", "useMutation(", "useQuery(", "queryClient", "stockQuantity", "saleTotal", "costPerKg"]) {
  if (feedback.includes(forbidden)) failures.push(`Feedback primitive contains business logic: ${forbidden}`);
}

if (failures.length) {
  console.error("Phase 8 feedback and recovery verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: 8, status: "ok", protectedContracts: 29 }, null, 2));
