// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  // Next.js defaults (includes TypeScript rules)
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Project-wide ignores
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },

  // Explicit rule override: downgrade no-explicit-any to a warning
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
