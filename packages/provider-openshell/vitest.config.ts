import { defineConfig } from "vitest/config";

const runIntegration = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  test: {
    name: "provider-openshell",
    include: ["tests/**/*.test.ts"],
    exclude: runIntegration ? [] : ["tests/integration/**"],
    testTimeout: runIntegration ? 120_000 : 15_000,
    environment: "node",
    clearMocks: true,
  },
});
