/**
 * Code Agent Tools — sandboxed file-access utilities for the AI coding agent.
 * All paths are resolved relative to the workspace root; traversal is rejected.
 */

import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const WORKSPACE_ROOT = process.cwd();
const MAX_FILE_LINES = 300;

// ── Path safety ────────────────────────────────────────────────────────────────

/**
 * Resolve and validate a relative path. Throws if the path escapes the workspace.
 */
export function resolveWorkspacePath(relPath: string): string {
  // Strip any leading slashes so "abs" paths like /etc/passwd still resolve inside workspace
  const cleaned = relPath.replace(/^\/+/, "");
  const abs = path.resolve(WORKSPACE_ROOT, cleaned);
  const rootWithSep = WORKSPACE_ROOT.endsWith(path.sep)
    ? WORKSPACE_ROOT
    : WORKSPACE_ROOT + path.sep;
  if (abs !== WORKSPACE_ROOT && !abs.startsWith(rootWithSep)) {
    throw new Error(`Path traversal rejected: ${JSON.stringify(relPath)}`);
  }
  return abs;
}

// ── File operations ────────────────────────────────────────────────────────────

export async function readProjectFile(
  relPath: string
): Promise<{ content: string; totalLines: number; truncated: boolean; relPath: string }> {
  const abs = resolveWorkspacePath(relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${relPath}`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relPath}`);
  }

  const raw = fs.readFileSync(abs, "utf8");
  const allLines = raw.split("\n");
  const truncated = allLines.length > MAX_FILE_LINES;
  const content = truncated
    ? allLines.slice(0, MAX_FILE_LINES).join("\n") +
      `\n\n// ... (${allLines.length - MAX_FILE_LINES} more lines — file truncated)`
    : raw;

  return { content, totalLines: allLines.length, truncated, relPath };
}

export async function readProjectFileRaw(relPath: string): Promise<string> {
  const abs = resolveWorkspacePath(relPath);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf8");
}

export async function listProjectDir(relPath: string = "."): Promise<string[]> {
  const abs = resolveWorkspacePath(relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Directory not found: ${relPath}`);
  }
  const IGNORED = new Set([
    "node_modules",
    ".git",
    "dist",
    ".cache",
    ".local",
    "__pycache__",
  ]);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries
    .filter((e) => !IGNORED.has(e.name))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
}

export async function grepProjectFiles(
  pattern: string,
  relDir: string = "."
): Promise<string> {
  const abs = resolveWorkspacePath(relDir);
  try {
    const { stdout } = await execFileAsync(
      "grep",
      [
        "-r",
        "-n",
        "-m",
        "40",
        "--include=*.ts",
        "--include=*.tsx",
        "--include=*.js",
        "--include=*.jsx",
        pattern,
        abs,
      ],
      { timeout: 10_000 }
    );
    // Strip workspace root from paths for cleaner output
    const rootPfx = WORKSPACE_ROOT + path.sep;
    return stdout.replace(new RegExp(rootPfx.replace(/\//g, "\\/"), "g"), "");
  } catch (e: any) {
    if (e.code === 1) return "(no matches found)";
    throw new Error(`grep failed: ${e.message}`);
  }
}

// ── Message parsing helpers ────────────────────────────────────────────────────

const FILE_EXT_RE = /\b((?:server|client|shared|scripts)\/[\w./-]+\.(?:ts|tsx|js|jsx|css|json|md)|[\w-]+\.(?:ts|tsx|js|jsx|css|json|md))\b/gi;

/**
 * Extract all file-path-like tokens from a user message.
 */
export function extractFilePathsFromMessage(msg: string): string[] {
  const matches = [...msg.matchAll(FILE_EXT_RE)];
  // Deduplicate and return
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Extract a keyword likely intended as a grep pattern.
 */
export function extractSearchPattern(msg: string): string | null {
  const m = msg.match(
    /\b(?:find\s+(?:where\s+)?|search\s+(?:for\s+)?|where\s+is\s+|grep\s+(?:for\s+)?|how\s+is\s+|look\s+for\s+)([`"']?)(\w[\w.]+)\1/i
  );
  return m ? m[2] : null;
}
