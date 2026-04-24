import { describe, test, expect } from "vitest";
import { OpenShellProviderOptionsSchema } from "../src/config.js";

describe("OpenShellProviderOptionsSchema", () => {
  test("accepts minimal input — only 'endpoint' — and fills defaults", () => {
    const parsed = OpenShellProviderOptionsSchema.parse({ endpoint: "127.0.0.1:8080" });

    expect(parsed.name).toBe("openshell");
    expect(parsed.endpoint).toBe("127.0.0.1:8080");
    expect(parsed.tls).toEqual({ mode: "insecure" });
    expect(parsed.sandboxNamePattern).toBe("^[a-zA-Z0-9_-]{1,64}$");
    expect(parsed.timeouts.connect).toBe(15_000);
    expect(parsed.timeouts.create).toBe(120_000);
    expect(parsed.timeouts.destroy).toBe(60_000);
    expect(parsed.timeouts.exec).toBe(120_000);
    expect(parsed.timeouts.list).toBe(15_000);
    expect(parsed.timeouts.get).toBe(15_000);
    expect(parsed.timeouts.logs).toBe(15_000);
    expect(parsed.timeouts.policySet).toBe(60_000);
    expect(parsed.timeouts.policyStatus).toBe(15_000);
  });

  test("accepts a fully-specified mtls config with custom timeouts and name", () => {
    const input = {
      name: "sandbox-prod",
      endpoint: "openshell.internal:8443",
      tls: {
        mode: "mtls" as const,
        ca: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
        cert: Buffer.from("-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n"),
        key: "/etc/openshell/client.key",
      },
      timeouts: {
        connect: 5_000,
        create: 30_000,
        destroy: 10_000,
        exec: 60_000,
        list: 5_000,
        get: 5_000,
        logs: 5_000,
        policySet: 20_000,
        policyStatus: 5_000,
      },
      sandboxNamePattern: "^sbx-[a-z0-9]{1,32}$",
    };

    const parsed = OpenShellProviderOptionsSchema.parse(input);
    expect(parsed.name).toBe("sandbox-prod");
    expect(parsed.tls.mode).toBe("mtls");
    if (parsed.tls.mode === "mtls") {
      expect(parsed.tls.ca).toBe(input.tls.ca);
      expect(parsed.tls.cert).toBe(input.tls.cert);
      expect(parsed.tls.key).toBe(input.tls.key);
    }
    expect(parsed.timeouts.exec).toBe(60_000);
    expect(parsed.sandboxNamePattern).toBe("^sbx-[a-z0-9]{1,32}$");
  });

  test("accepts tls mode with only ca (server-auth only)", () => {
    const parsed = OpenShellProviderOptionsSchema.parse({
      endpoint: "x:1",
      tls: { mode: "tls", ca: "/etc/ca.pem" },
    });
    expect(parsed.tls).toEqual({ mode: "tls", ca: "/etc/ca.pem" });
  });

  test("rejects missing 'endpoint'", () => {
    expect(() => OpenShellProviderOptionsSchema.parse({})).toThrow();
  });

  test("rejects empty 'endpoint'", () => {
    expect(() => OpenShellProviderOptionsSchema.parse({ endpoint: "" })).toThrow();
  });

  test("rejects unknown top-level keys (strict mode)", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({ endpoint: "x:1", bogus: true }),
    ).toThrow(/bogus|unrecognized/i);
  });

  test("rejects negative timeouts", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        timeouts: { connect: -1 },
      }),
    ).toThrow();
  });

  test("rejects zero timeouts (must be positive)", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        timeouts: { exec: 0 },
      }),
    ).toThrow();
  });

  test("rejects non-integer timeouts", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        timeouts: { exec: 1.5 },
      }),
    ).toThrow();
  });

  test("rejects mtls without cert", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        tls: { mode: "mtls", ca: "/ca", key: "/k" },
      }),
    ).toThrow();
  });

  test("rejects mtls without key", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        tls: { mode: "mtls", ca: "/ca", cert: "/c" },
      }),
    ).toThrow();
  });

  test("rejects mtls without ca", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        tls: { mode: "mtls", cert: "/c", key: "/k" },
      }),
    ).toThrow();
  });

  test("rejects unknown tls mode", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        tls: { mode: "sploosh" },
      }),
    ).toThrow();
  });

  test("rejects empty-string PEM source in tls", () => {
    expect(() =>
      OpenShellProviderOptionsSchema.parse({
        endpoint: "x:1",
        tls: { mode: "tls", ca: "" },
      }),
    ).toThrow();
  });

  test("partial timeouts are merged with defaults", () => {
    const parsed = OpenShellProviderOptionsSchema.parse({
      endpoint: "x:1",
      timeouts: { exec: 999 },
    });
    expect(parsed.timeouts.exec).toBe(999);
    expect(parsed.timeouts.connect).toBe(15_000);
    expect(parsed.timeouts.create).toBe(120_000);
  });
});
