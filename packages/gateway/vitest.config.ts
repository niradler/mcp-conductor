import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "gateway",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    environment: "node",
    clearMocks: true,
  },
});
