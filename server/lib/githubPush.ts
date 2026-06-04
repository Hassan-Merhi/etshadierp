/**
 * GitHub Push Helper — commits and pushes changed files using the local git CLI.
 * Reads GITHUB_REPO_URL from env (set by the admin in ChatbotSettings).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { WORKSPACE_ROOT, resolveWorkspacePath } from "./codeAgentTools";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT = 30_000;

async function git(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  const cwd = opts.cwd ?? WORKSPACE_ROOT;
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (stderr && !stderr.includes("warning:") && !stderr.toLowerCase().includes("hint:")) {
    // Only surface actual errors, not routine git messages
  }
  return stdout.trim();
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  branch?: string;
  error?: string;
}

/**
 * Stage, commit, and push the given files to the remote.
 * Requires GITHUB_REPO_URL (e.g. https://<token>@github.com/user/repo.git) in env.
 */
export async function commitAndPush(params: {
  files: string[];
  message: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<CommitResult> {
  const { files, message, authorName = "ERP Agent", authorEmail = "agent@erp.local" } = params;

  if (!files.length) {
    return { success: false, error: "No files to commit" };
  }

  // Validate all paths are inside workspace
  for (const f of files) {
    try {
      resolveWorkspacePath(f);
    } catch {
      return { success: false, error: `Invalid file path: ${f}` };
    }
  }

  // Check for remote configuration
  const repoUrl = process.env.GITHUB_REPO_URL;
  if (!repoUrl) {
    return {
      success: false,
      error:
        "GITHUB_REPO_URL is not configured. Please add it in Chatbot Settings → GitHub Integration.",
    };
  }

  try {
    // Set remote if not already set (or update it)
    try {
      const remotes = await git(["remote"]);
      if (remotes.includes("origin")) {
        await git(["remote", "set-url", "origin", repoUrl]);
      } else {
        await git(["remote", "add", "origin", repoUrl]);
      }
    } catch {
      // Continue even if setting remote fails
    }

    // Get current branch
    let branch = "main";
    try {
      branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      // Use default
    }

    // Stage the files
    const relPaths = files.map((f) =>
      path.isAbsolute(f) ? path.relative(WORKSPACE_ROOT, f) : f
    );
    await git(["add", "--", ...relPaths]);

    // Check if there is anything staged
    const status = await git(["status", "--porcelain"]).catch(() => "");
    if (!status.trim()) {
      return {
        success: false,
        error: "Nothing to commit — the file content may already be up to date.",
      };
    }

    // Commit
    await git([
      "-c",
      `user.name=${authorName}`,
      "-c",
      `user.email=${authorEmail}`,
      "commit",
      "-m",
      message,
    ]);

    // Get the new commit hash
    const commitHash = await git(["rev-parse", "--short", "HEAD"]).catch(() => "");

    // Push
    await git(["push", "origin", branch]);

    return { success: true, commitHash, branch };
  } catch (e: any) {
    const msg: string = e.message ?? String(e);

    // Provide friendlier error messages
    if (msg.includes("Authentication failed") || msg.includes("remote: Invalid username")) {
      return {
        success: false,
        error:
          "Authentication failed. Please check your GITHUB_REPO_URL includes a valid token (e.g. https://<token>@github.com/user/repo.git).",
      };
    }
    if (msg.includes("rejected") || msg.includes("non-fast-forward")) {
      return {
        success: false,
        error:
          "Push rejected — the remote has changes that conflict with yours. Pull and merge first.",
      };
    }
    if (msg.includes("Repository not found")) {
      return {
        success: false,
        error: "Repository not found. Check that GITHUB_REPO_URL is correct.",
      };
    }

    return { success: false, error: msg };
  }
}
