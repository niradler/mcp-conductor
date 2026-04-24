import { describe, test, expect } from "vitest";
import { encodeToolName, decodeToolName } from "../src/namespace.js";

describe("namespace", () => {
  test("encode joins with __", () => {
    expect(encodeToolName("gh", "create_issue")).toBe("gh__create_issue");
  });
  test("decode splits on first __", () => {
    expect(decodeToolName("gh__create_issue")).toEqual({ provider: "gh", tool: "create_issue" });
  });
  test("decode handles __ in tool name", () => {
    expect(decodeToolName("gh__run__fast")).toEqual({ provider: "gh", tool: "run__fast" });
  });
  test("decode returns null for invalid", () => {
    expect(decodeToolName("noseparator")).toBeNull();
    expect(decodeToolName("__noprov")).toBeNull();
    expect(decodeToolName("prov__")).toBeNull();
  });
  test("encode rejects provider with __", () => {
    expect(() => encodeToolName("a__b", "t")).toThrow();
  });
});
