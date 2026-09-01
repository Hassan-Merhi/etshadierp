#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function detectBackupFormat(header) {
  if (header.subarray(0, 5).toString("ascii") === "PGDMP") return "postgres-custom";

  const text = header.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (
    text.startsWith("--") ||
    /PostgreSQL database dump/i.test(text) ||
    /^(CREATE|ALTER|SET|COPY|INSERT)\s/im.test(text)
  ) {
    return "postgres-plain-sql";
  }

  return "unknown";
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inspectBackup(filePath, { maxAgeHours = 24 } = {}) {
  const absolutePath = path.resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new Error("Backup path is not a regular file.");
  if (fileStat.size <= 0) throw new Error("Backup file is empty.");

  const handle = await open(absolutePath, "r");
  let header;
  try {
    const bytesToRead = Math.min(4096, fileStat.size);
    header = Buffer.alloc(bytesToRead);
    await handle.read(header, 0, bytesToRead, 0);
  } finally {
    await handle.close();
  }

  const format = detectBackupFormat(header);
  const ageHours = Math.max(0, (Date.now() - fileStat.mtimeMs) / 3_600_000);
  const errors = [];
  const warnings = [];

  if (format === "unknown") errors.push("File does not look like a PostgreSQL custom or plain-SQL backup.");
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    errors.push("maxAgeHours must be a positive number.");
  } else if (ageHours > maxAgeHours) {
    errors.push(`Backup is ${ageHours.toFixed(2)} hours old; maximum allowed age is ${maxAgeHours} hours.`);
  }

  if (fileStat.size < 1024) warnings.push("Backup is smaller than 1 KiB; confirm this is expected for the database.");

  return {
    ok: errors.length === 0,
    fileName: path.basename(absolutePath),
    absolutePath,
    format,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    ageHours: Number(ageHours.toFixed(3)),
    sha256: await sha256File(absolutePath),
    warnings,
    errors,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const json = args.includes("--json");
  const filtered = args.filter((arg) => arg !== "--json");
  const ageArg = filtered.find((arg) => arg.startsWith("--max-age-hours="));
  const maxAgeHours = ageArg ? Number(ageArg.split("=", 2)[1]) : 24;
  const filePath = filtered.find((arg) => !arg.startsWith("--"));
  return { filePath, json, maxAgeHours };
}

async function main() {
  const { filePath, json, maxAgeHours } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    console.error("Usage: node scripts/verify-database-backup.mjs <backup-file> [--max-age-hours=24] [--json]");
    process.exitCode = 2;
    return;
  }

  try {
    const result = await inspectBackup(filePath, { maxAgeHours });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Backup: ${result.fileName}`);
      console.log(`Format: ${result.format}`);
      console.log(`Size: ${result.sizeBytes} bytes`);
      console.log(`Age: ${result.ageHours} hours`);
      console.log(`SHA-256: ${result.sha256}`);
      for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
      for (const error of result.errors) console.error(`ERROR: ${error}`);
      console.log(result.ok ? "Backup verification passed." : "Backup verification failed.");
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ ok: false, errors: [message] }, null, 2));
    else console.error(`Backup verification failed: ${message}`);
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) await main();
