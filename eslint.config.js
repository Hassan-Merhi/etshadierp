import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
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
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
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
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],

      "no-console": "off",
      "no-undef": "off",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "no-var": "warn",

      // ESLint 10 promoted these rules into the recommended baseline. Keep them
      // visible while the legacy code is repaired incrementally, without turning
      // a toolchain upgrade into a repository-wide CI outage.
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "no-control-regex": "warn",
      "no-extra-boolean-cast": "warn",

      // A violation here is a crash, not a style opinion: React fails the render
      // outright when the hook count changes between renders. The repository was
      // carrying 36 of these as warnings, including a dispatch on `?view=` that
      // reshaped a page's hook list whenever the query string changed. All are
      // fixed, so this is an error now — the rule has no false positives worth
      // tolerating a silent regression for.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  configPrettier,
);
