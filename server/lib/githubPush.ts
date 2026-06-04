/**
 * GitHub Push Helper — commits and pushes changed files using the local git CLI.
 * The authenticated remote URL is composed server-side from separate repoUrl + token
 * loaded from DB at request time; neither field is returned to the client.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { WORKSPACE_ROOT, resolveWorkspacePath } from "./codeAgentTools";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT = 30_000;

async function git(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const cwd = opts.cwd ?? WORKSPACE_ROOT;
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: {
      ...process.env,
      ...(opts.env ?? {}),
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  void stderr;
  return stdout.trim();
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  branch?: string;
  error?: string;
}

/**
 * Compose an authenticated HTTPS remote URL.
 * baseUrl: the plain https URL without credentials (e.g. https://github.com/user/repo.git)
 * token: personal access token or app token
 * If baseUrl already contains credentials, they are preserved as-is.
 */
export function buildAuthenticatedUrl(baseUrl: string, token?: string): string {
  if (!token || !token.trim()) return baseUrl;
  try {
    const u = new URL(baseUrl);
    if (u.username || u.password) return baseUrl; // already has creds
    u.username = token.trim();
    u.password = "";
    return u.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Stage, commit, and push the given files to the remote.
 * @param params.repoUrl  Full authenticated remote URL (composed server-side). Falls back to GITHUB_REPO_URL env.
 */
export async function commitAndPush(params: {
  files: string[];
  message: string;
  repoUrl?: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<CommitResult> {
  const { files, message, authorName = "ERP Agent", authorEmail = "agent@erp.local" } = params;

  if (!files.length) {
    return { success: false, error: "No files to commit" };
  }

  for (const f of files) {
    try {
      resolveWorkspacePath(f);
    } catch {
      return { success: false, error: `Invalid file path: ${f}` };
    }
  }

  const repoUrl = params.repoUrl ?? process.env.GITHUB_REPO_URL;
  if (!repoUrl) {
    return {
      success: false,
      error: "GitHub repository is not configured. Please set it in Chatbot Settings → GitHub Integration.",
    };
  }

  try {
    let branch = "main";
    try {
      branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      // use default
    }

    const relPaths = files.map((f) =>
      path.isAbsolute(f) ? path.relative(WORKSPACE_ROOT, f) : f
    );
    await git(["add", "--", ...relPaths]);

    const status = await git(["status", "--porcelain"]).catch(() => "");
    if (!status.trim()) {
      return { success: false, error: "Nothing to commit — the file content may already be up to date." };
    }

    await git([
      "-c", `user.name=${authorName}`,
      "-c", `user.email=${authorEmail}`,
      "commit", "-m", message,
    ]);

    const commitHash = await git(["rev-parse", "--short", "HEAD"]).catch(() => "");

    // Push directly to the authenticated URL — never write credentials to .git/config
    await git(["push", repoUrl, `HEAD:refs/heads/${branch}`]);

    return { success: true, commitHash, branch };
  } catch (e: any) {
    const raw: string = e.message ?? String(e);
    // Sanitize: strip any credential-bearing URLs before surfacing to callers/logs
    const msg = raw.replace(/https?:\/\/[^@\s]+@[^\s]*/gi, "<redacted-url>");
    if (msg.includes("Authentication failed") || msg.includes("Invalid username") || msg.includes("could not read Username")) {
      return { success: false, error: "Authentication failed. Check your GitHub token in Chatbot Settings." };
    }
    if (msg.includes("rejected") || msg.includes("non-fast-forward")) {
      return { success: false, error: "Push rejected — the remote has conflicting changes. Pull and merge first." };
    }
    if (msg.includes("Repository not found") || msg.includes("not found")) {
      return { success: false, error: "Repository not found. Check your GitHub URL in Chatbot Settings." };
    }
    if (msg.includes("Permission denied") || msg.includes("403")) {
      return { success: false, error: "Permission denied. Ensure your token has the required repository write scope." };
    }
    // Safe fallback: return sanitized message (credentials already stripped above)
    return { success: false, error: msg };
  }
}
