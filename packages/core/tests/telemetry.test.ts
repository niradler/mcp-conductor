import { describe, test, expect, afterEach } from "vitest";
import { getTracer, getMeter, initTelemetry, shutdownTelemetry } from "../src/telemetry/index.js";

describe("telemetry", () => {
  afterEach(async () => {
    await shutdownTelemetry();
  });

  test("tracer and meter obtainable", () => {
    const t = getTracer("t");
    const s = t.startSpan("op");
    s.end();
    expect(typeof getMeter("t").createCounter).toBe("function");
  });

  test("init is idempotent", () => {
    expect(() => {
      initTelemetry("svc");
      initTelemetry("svc");
    }).not.toThrow();
  });

  test("init without OTLP endpoint is a no-op", () => {
    const saved = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    try {
      expect(() => initTelemetry("no")).not.toThrow();
    } finally {
      if (saved) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved;
    }
  });
});
