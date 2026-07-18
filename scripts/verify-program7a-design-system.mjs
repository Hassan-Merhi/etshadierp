#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const requiredFiles = {
  tokens: "client/src/index.css",
  button: "client/src/components/ui/button.tsx",
  states: "client/src/components/ui/page-state.tsx",
};

const [tokens, button, states] = await Promise.all(
  Object.values(requiredFiles).map((path) => readFile(path, "utf8")),
);

const failures = [];

for (const token of [
  "--background:",
  "--foreground:",
  "--primary:",
  "--destructive:",
  "--success:",
  "--warning:",
  "--info:",
  "--radius:",
  "--shadow-sm:",
  "--module-erp:",
  "--module-factory:",
]) {
  if (!tokens.includes(token)) failures.push(`Missing design token ${token}`);
}

if (!tokens.includes(".dark")) failures.push("Dark-mode token scope is missing");
if (!button.includes("buttonVariants")) failures.push("Shared button variants are missing");
if (!button.includes("focus-visible:ring")) failures.push("Shared button focus treatment is missing");

for (const primitive of ["PageState", "LoadingState", "EmptyState", "ErrorState"]) {
  if (!states.includes(primitive)) failures.push(`Missing shared state primitive ${primitive}`);
}

for (const accessibilityContract of ["role=\"status\"", "aria-live=\"polite\""]) {
  if (!states.includes(accessibilityContract)) {
    failures.push(`Missing page-state accessibility contract ${accessibilityContract}`);
  }
}

if (failures.length > 0) {
  console.error("Program 7A design-system verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 7A design-system contracts verified.");
