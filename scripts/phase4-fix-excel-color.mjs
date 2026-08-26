#!/usr/bin/env node
import fs from "node:fs";
const file = "client/src/lib/excelImport.ts";
const before = 'const color = !Array.isArray(rule.color) ? rule.color : undefined;';
const after = 'const color = !Array.isArray(rule.color) ? (rule.color as ArgbColor | undefined) : undefined;';
const text = fs.readFileSync(file, "utf8");
if (!text.includes(before)) throw new Error("Excel color narrowing target not found");
fs.writeFileSync(file, text.replace(before, after));
