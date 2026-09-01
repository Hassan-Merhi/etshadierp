#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const requiredFiles = {
  tokens: "client/src/index.css",
  button: "client/src/components/ui/button.tsx",
  input: "client/src/components/ui/input.tsx",
  textarea: "client/src/components/ui/textarea.tsx",
  form: "client/src/components/ui/form.tsx",
  states: "client/src/components/ui/page-state.tsx",
};

const [tokens, button, input, textarea, form, states] = await Promise.all(
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

for (const contract of [
  "buttonVariants",
  "focus-visible:ring-2",
  "isLoading",
  "aria-busy",
  "motion-reduce:transition-none",
]) {
  if (!button.includes(contract)) failures.push(`Missing shared button contract ${contract}`);
}

for (const [name, source] of [
  ["input", input],
  ["textarea", textarea],
]) {
  for (const contract of [
    "focus-visible:ring-2",
    "aria-invalid:border-destructive",
    "disabled:bg-muted",
    "motion-reduce:transition-none",
  ]) {
    if (!source.includes(contract)) failures.push(`Missing shared ${name} contract ${contract}`);
  }
}

for (const contract of [
  "React.createContext<FormFieldContextValue | undefined>(undefined)",
  "React.createContext<FormItemContextValue | undefined>(undefined)",
  "role=\"alert\"",
  "aria-invalid={Boolean(error)}",
]) {
  if (!form.includes(contract)) failures.push(`Missing shared form contract ${contract}`);
}

for (const primitive of ["PageState", "LoadingState", "EmptyState", "ErrorState"]) {
  if (!states.includes(primitive)) failures.push(`Missing shared state primitive ${primitive}`);
}

for (const accessibilityContract of [
  "role=\"status\"",
  "aria-live=\"polite\"",
  "aria-atomic=\"true\"",
  "aria-busy",
  "motion-reduce:animate-none",
]) {
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
