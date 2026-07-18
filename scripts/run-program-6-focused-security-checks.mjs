import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "check"]],
  [
    "node",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/named-permission-service.test.ts",
      "tests/credential-version-service.test.ts",
      "tests/company-context-enforcement.test.ts",
      "tests/legacy-privileged-write-guard.test.ts",
      "tests/raw-stock-sensitive-input-guard.test.ts",
      "tests/stored-file-protected-access.test.ts",
      "tests/program-5-end-to-end-security.test.ts",
      "tests/program-4-end-to-end-enforcement.test.ts",
      "tests/protected-asset-download-adapter.test.ts",
      "tests/security-audit-runtime.test.ts",
    ],
  ],
];

for (const [command, args] of commands) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_ENV: "test" },
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nProgram 6 focused security checks passed.");
