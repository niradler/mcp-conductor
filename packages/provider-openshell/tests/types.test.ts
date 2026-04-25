import { describe, test, expect } from "vitest";
import {
  L7AllowSchema,
  NetworkEndpointSchema,
  NetworkPolicyRuleSchema,
  SandboxPolicySchema,
  SandboxSpecSchema,
  SandboxTemplateSchema,
} from "../src/types.js";

describe("SandboxPolicySchema", () => {
  test("parses an empty object and applies all defaults", () => {
    const parsed = SandboxPolicySchema.parse({});
    expect(parsed.version).toBe(1);
    expect(parsed.filesystem).toEqual({ include_workdir: true, read_only: [], read_write: [] });
    expect(parsed.landlock).toEqual({ compatibility: "best_effort" });
    expect(parsed.process).toEqual({ run_as_user: "", run_as_group: "" });
    expect(parsed.network_policies).toEqual({});
  });

  test("round-trips a fully-populated policy", () => {
    const input = {
      version: 2,
      filesystem: { include_workdir: false, read_only: ["/etc"], read_write: ["/tmp"] },
      landlock: { compatibility: "hard_requirement" as const },
      process: { run_as_user: "nobody", run_as_group: "nogroup" },
      network_policies: {
        claude_code: {
          name: "claude_code",
          endpoints: [
            {
              host: "api.anthropic.com",
              ports: [443],
              protocol: "rest" as const,
              access: "read-write" as const,
              rules: [{ allow: { method: "POST", path: "/v1/*" } }],
            },
          ],
          binaries: [{ path: "/usr/bin/curl" }],
        },
      },
    };
    const parsed = SandboxPolicySchema.parse(input);
    expect(parsed).toEqual(input);
  });

  test("rejects unknown top-level keys", () => {
    expect(() => SandboxPolicySchema.parse({ totally_made_up: 1 })).toThrow();
  });

  test("rejects unknown keys nested in filesystem", () => {
    expect(() =>
      SandboxPolicySchema.parse({ filesystem: { include_workdir: true, bogus: 1 } }),
    ).toThrow();
  });

  test("rejects an invalid landlock compatibility value", () => {
    expect(() =>
      SandboxPolicySchema.parse({ landlock: { compatibility: "lenient" } }),
    ).toThrow();
  });

  test("rejects negative version", () => {
    expect(() => SandboxPolicySchema.parse({ version: -1 })).toThrow();
  });
});

describe("NetworkEndpointSchema", () => {
  test("accepts an empty endpoint (everything optional)", () => {
    expect(NetworkEndpointSchema.parse({})).toEqual({});
  });

  test("rejects ports outside 1..65535", () => {
    expect(() => NetworkEndpointSchema.parse({ ports: [0] })).toThrow();
    expect(() => NetworkEndpointSchema.parse({ ports: [70_000] })).toThrow();
    expect(() => NetworkEndpointSchema.parse({ ports: [443] })).not.toThrow();
  });

  test("rejects unknown keys", () => {
    expect(() => NetworkEndpointSchema.parse({ host: "x", bogus: 1 })).toThrow();
  });
});

describe("NetworkPolicyRuleSchema", () => {
  test("requires a name and defaults endpoints/binaries to []", () => {
    const parsed = NetworkPolicyRuleSchema.parse({ name: "rule" });
    expect(parsed).toEqual({ name: "rule", endpoints: [], binaries: [] });
  });

  test("rejects missing name", () => {
    expect(() => NetworkPolicyRuleSchema.parse({})).toThrow();
  });
});

describe("L7AllowSchema", () => {
  test("accepts an empty object (all fields optional)", () => {
    expect(L7AllowSchema.parse({})).toEqual({});
  });

  test("rejects unknown keys", () => {
    expect(() => L7AllowSchema.parse({ bogus: 1 })).toThrow();
  });
});

describe("SandboxTemplateSchema", () => {
  test("requires image", () => {
    expect(() => SandboxTemplateSchema.parse({})).toThrow();
    expect(SandboxTemplateSchema.parse({ image: "ubuntu:24.04" })).toEqual({ image: "ubuntu:24.04" });
  });

  test("accepts optional environment + runtime_class_name", () => {
    const parsed = SandboxTemplateSchema.parse({
      image: "ubuntu:24.04",
      runtime_class_name: "kata",
      environment: { FOO: "bar" },
    });
    expect(parsed).toEqual({
      image: "ubuntu:24.04",
      runtime_class_name: "kata",
      environment: { FOO: "bar" },
    });
  });
});

describe("SandboxSpecSchema", () => {
  test("requires template + policy and fills the rest with defaults", () => {
    const parsed = SandboxSpecSchema.parse({
      template: { image: "ubuntu:24.04" },
      policy: {},
    });
    expect(parsed.log_level).toBe("info");
    expect(parsed.environment).toEqual({});
    expect(parsed.providers).toEqual([]);
    expect(parsed.gpu).toBe(false);
    expect(parsed.template).toEqual({ image: "ubuntu:24.04" });
  });

  test("rejects missing template", () => {
    expect(() => SandboxSpecSchema.parse({ policy: {} })).toThrow();
  });

  test("rejects missing policy", () => {
    expect(() => SandboxSpecSchema.parse({ template: { image: "x" } })).toThrow();
  });

  test("rejects unknown top-level keys", () => {
    expect(() =>
      SandboxSpecSchema.parse({
        template: { image: "x" },
        policy: {},
        bogus: 1,
      }),
    ).toThrow();
  });
});
