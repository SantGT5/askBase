import pluginJs from "@eslint/js"
import typescriptEslint from "@typescript-eslint/eslint-plugin"
import typescriptParser from "@typescript-eslint/parser"
import eslintConfigPrettier from "eslint-config-prettier"
import prettierPlugin from "eslint-plugin-prettier"
import reactHooksPlugin from "eslint-plugin-react-hooks"
import globals from "globals"

export default [
  // Global ignores: an object with only `ignores` applies to every config
  {
    ignores: ["dist/", ".idea/", "build/", "public/", ".vscode/", "coverage/", "node_modules/"],
  },

  pluginJs.configs.recommended,

  {
    files: ["src/**/*.{js,jsx,mjs,cjs,mts,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "2020",
        ecmaFeatures: { jsx: true },
        project: ["./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      prettier: prettierPlugin,
      "react-hooks": reactHooksPlugin,
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      // Prettier Rules
      "prettier/prettier": "error",

      // TypeScript Rules
      // The core rules don't understand TS syntax (type-only references, parameter
      // names in function types, ...) and report false positives; tsc covers no-undef.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // React Specific Rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // General Rules
      "arrow-parens": ["error", "as-needed"],
      "no-console": ["error", { allow: ["warn", "error"] }],

      // Padding between statements
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        {
          blankLine: "any",
          prev: ["const", "let", "var"],
          next: ["const", "let", "var"],
        },
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: ["block", "block-like"], next: "*" },
        { blankLine: "always", prev: "*", next: ["block", "block-like"] },
        { blankLine: "always", prev: "*", next: "function" },
        { blankLine: "always", prev: "function", next: "*" },
      ],
    },
  },

  eslintConfigPrettier,
]
