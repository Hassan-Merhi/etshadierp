#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const workflowDialog = await read("client/src/components/ui/workflow-dialog.tsx");
const confirmDialog = await read("client/src/components/ConfirmDialog.tsx");
const confirmationShim = await read("client/src/components/ConfirmationDialog.tsx");
const dialog = await read("client/src/components/ui/dialog.tsx");
const form = await read("client/src/components/ui/form.tsx");
const failures = [];

for (const token of [
  "WorkflowDialog",
  "WorkflowDialogTone",
  "DialogHeader",
  "DialogTitle",
  "DialogDescription",
  "DialogFooter",
  'tone === "destructive" ? "destructive"',
  "max-h-[calc(100dvh-1rem)]",
  "overflow-y-auto",
  "break-words",
  'aria-busy={isPending ? "true"',
  "motion-reduce:animate-none",
  "disableConfirm || isPending",
  'type="button"',
]) {
  if (!workflowDialog.includes(token)) failures.push(`Workflow dialog contract missing: ${token}`);
}

for (const token of [
  "ConfirmDialog",
  "doubleConfirm",
  "requirePhrase",
  "confirmDisabled",
  "max-h-[calc(100dvh-1rem)]",
  "overflow-y-auto",
  "break-words",
  'aria-busy={isLoading ? "true"',
  "motion-reduce:animate-none",
  "w-full sm:w-auto",
  "bg-destructive",
  "bg-warning",
  "disabled={isLoading}",
]) {
  if (!confirmDialog.includes(token)) failures.push(`Canonical confirmation contract missing: ${token}`);
}

for (const token of ["ConfirmDialog", "DeleteConfirmDialog", 'tone="destructive"']) {
  if (!confirmationShim.includes(token)) failures.push(`Confirmation compatibility contract missing: ${token}`);
}

for (const token of ["DialogContent", "focus-visible"]) {
  if (!dialog.includes(token)) failures.push(`Base dialog contract missing: ${token}`);
}

for (const token of ["FormField", "FormLabel", "FormControl", "FormMessage"]) {
  if (!form.includes(token)) failures.push(`Form consistency contract missing: ${token}`);
}

for (const source of [workflowDialog, confirmDialog]) {
  for (const forbidden of [
    "/api/",
    "useMutation(",
    "useQuery(",
    "queryClient",
    "stockQuantity",
    "saleTotal",
    "costPerKg",
    "ledgerAccount",
  ]) {
    if (source.includes(forbidden)) failures.push(`Dialog primitive contains business logic: ${forbidden}`);
  }
}

if (failures.length) {
  console.error("Phase 10 dialog and form consistency verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: 10, status: "complete", protectedContracts: 39 }, null, 2));
