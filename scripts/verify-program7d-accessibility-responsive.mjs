#!/usr/bin/env node
import fs from "node:fs";

const files = {
  responsive: "client/src/components/ui/responsive-accessibility.tsx",
  financial: "client/src/components/financial/financial-screen.tsx",
  operations: "client/src/components/operations/operations-screen.tsx",
  dialog: "client/src/components/ui/dialog.tsx",
};

const sources = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, fs.readFileSync(path, "utf8")]),
);

const failures = [];

for (const token of [
  "SkipLink",
  "ResponsiveActions",
  "ResponsiveToolbar",
  "ResponsiveGrid",
  "AccessibleRegion",
  "HorizontalScrollRegion",
  "focus-visible:ring-2",
  "focus:ring-offset-2",
  "aria-label",
  'role="region"',
  'role="search"',
  'role="group"',
  "overflow-x-auto",
  "sm:flex-row",
  "auto-fit",
  "minmax",
  "motion-reduce:transition-none",
]) {
  if (!sources.responsive.includes(token)) failures.push(`Responsive primitive contract missing: ${token}`);
}

for (const [name, source] of [
  ["financial", sources.financial],
  ["operations", sources.operations],
]) {
  for (const token of [
    "ResponsiveActions",
    "ResponsiveToolbar",
    "aria-labelledby",
    "React.useId()",
    "break-words",
    "grid-cols-1",
    "max-w-full",
    "overflow-x-auto",
    "overscroll-x-contain",
  ]) {
    if (!source.includes(token)) failures.push(`${name} responsive screen contract missing: ${token}`);
  }
}

for (const token of [
  "100dvh",
  "overflow-y-auto",
  "overscroll-contain",
  "min-h-10",
  "min-w-10",
  "motion-reduce:animate-none",
  "[&>*]:w-full",
]) {
  if (!sources.dialog.includes(token)) failures.push(`Responsive dialog contract missing: ${token}`);
}

if (failures.length) {
  console.error("Program 7D accessibility and responsive verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 7D accessibility and responsive contracts verified.");
