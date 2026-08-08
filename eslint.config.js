import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import configPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "artifacts/**",
      "drizzle.config.ts",
      "vite.config.ts",
      "server/vite.ts",
      "postcss.config.js",
      "tailwind.config.ts",
      "capacitor.config.ts",
      "scripts/**",
      "*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // On as a warning so `any` is visible in the editor as it is written.
      // The *gate* is not this rule — it is the per-file ratchet in
      // config/type-escape-boundaries.json, which is exact, counts from the
      // AST, and fails CI when any single file gains an escape. This rule is
      // the feedback loop; `npm run audit:type-escapes` is the enforcement.
      // See Phase 1 in docs/system-quality-program.md.
      "@typescript-eslint/no-explicit-any": "warn",
      // Stays off deliberately: unused-imports/no-unused-vars below replaces it
      // and the plugin requires the base rule disabled to avoid double reports.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "no-console": "off",
      "no-undef": "off",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "no-var": "warn",
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "no-control-regex": "warn",
      "no-extra-boolean-cast": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Blocked, not deferred. CI format-checks every changed file, and Prettier
    // reflow pushes each of these past a size gate:
    //
    //   FactoryBaleProductHistory   849 → 915  (becomes a *new* god file)
    //   FactoryPayrollTab          1573 → 1610 (frozen at 1575)
    //   DailyProductionReport      1328 → 1366 (frozen at 1350)
    //   workerStatsAdvancesRoutes   921 → 928  (frozen at 922)
    //
    // Deleting an unused import from any of them therefore fails either the
    // format gate or the size gate — they cannot be edited at all until they
    // are split. Raising a frozen baseline to absorb formatting churn would
    // leave headroom that silently refills, which working rule 4 of the
    // god-file program exists to prevent.
    //
    // Remove this block when those files are split (that program's Phase 4).
    files: [
      "client/src/pages/factory/FactoryBaleProductHistory.tsx",
      "client/src/pages/factory/FactoryPayrollTab.tsx",
      "client/src/pages/factory/DailyProductionReport.tsx",
      "server/routes/payroll/workerStatsAdvancesRoutes.ts",
    ],
    rules: {
      "unused-imports/no-unused-imports": "off",
    },
  },
  configPrettier
);
