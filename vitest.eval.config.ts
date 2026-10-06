import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mini-évaluation API réelle : jamais incluse dans `pnpm test` ni en CI.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["evals/**/*.eval.ts"], environment: "node", fileParallelism: false },
});
