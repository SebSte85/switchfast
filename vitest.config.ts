import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "tests/",
        "dist/",
        "build/",
        "**/*.config.*",
        "**/*.d.ts",
      ],
      // Thresholds nur für CI aktivieren, nicht für Test-Hilfsfunktionen
      thresholds: process.env.CI
        ? {
            statements: 50,
            branches: 40,
            functions: 50,
            lines: 50,
          }
        : {},
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@tests": resolve(__dirname, "./tests"),
    },
  },
});
