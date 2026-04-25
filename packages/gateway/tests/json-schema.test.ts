import { describe, test, expect } from "vitest";
import { z } from "zod";
import { jsonSchemaToZodRawShape } from "../src/mcp-app.js";

describe("jsonSchemaToZodRawShape", () => {
  test("should return empty shape for schema with no properties", () => {
    expect(jsonSchemaToZodRawShape({})).toEqual({});
    expect(jsonSchemaToZodRawShape({ type: "object" })).toEqual({});
  });

  test("should map string property to z.string()", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(shape["name"]).toBeDefined();
    expect(shape["name"]!.parse("hello")).toBe("hello");
    expect(() => shape["name"]!.parse(42)).toThrow();
  });

  test("should mark non-required properties as optional", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: {
        required_field: { type: "string" },
        optional_field: { type: "string" },
      },
      required: ["required_field"],
    });
    expect(shape["required_field"]!.parse("x")).toBe("x");
    expect(shape["optional_field"]!.parse(undefined)).toBeUndefined();
  });

  test("should mark all fields optional when required array is absent", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { x: { type: "string" } },
    });
    expect(shape["x"]!.parse(undefined)).toBeUndefined();
  });

  test("should map integer property with min/max constraints", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { count: { type: "integer", minimum: 0, maximum: 100 } },
      required: ["count"],
    });
    expect(shape["count"]!.parse(50)).toBe(50);
    expect(() => shape["count"]!.parse(-1)).toThrow();
    expect(() => shape["count"]!.parse(101)).toThrow();
    expect(() => shape["count"]!.parse(1.5)).toThrow(); // not integer
  });

  test("should map number property with min/max constraints", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { ratio: { type: "number", minimum: 0.0, maximum: 1.0 } },
      required: ["ratio"],
    });
    expect(shape["ratio"]!.parse(0.5)).toBe(0.5);
    expect(() => shape["ratio"]!.parse(1.5)).toThrow();
  });

  test("should map boolean property", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { flag: { type: "boolean" } },
      required: ["flag"],
    });
    expect(shape["flag"]!.parse(true)).toBe(true);
    expect(() => shape["flag"]!.parse("yes")).toThrow();
  });

  test("should map string enum to z.enum()", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { color: { type: "string", enum: ["red", "green", "blue"] } },
      required: ["color"],
    });
    expect(shape["color"]!.parse("red")).toBe("red");
    expect(() => shape["color"]!.parse("purple")).toThrow();
  });

  test("should map mixed enum to union of literals", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { val: { enum: [1, "two", null] } },
      required: ["val"],
    });
    expect(shape["val"]!.parse(1)).toBe(1);
    expect(shape["val"]!.parse("two")).toBe("two");
    expect(shape["val"]!.parse(null)).toBeNull();
    expect(() => shape["val"]!.parse("other")).toThrow();
  });

  test("should map array property with typed items", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
      required: ["tags"],
    });
    expect(shape["tags"]!.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => shape["tags"]!.parse([1, 2])).toThrow();
  });

  test("should map array with minItems/maxItems", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { ids: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 3 } },
      required: ["ids"],
    });
    expect(shape["ids"]!.parse([1])).toEqual([1]);
    expect(() => shape["ids"]!.parse([])).toThrow();
    expect(() => shape["ids"]!.parse([1, 2, 3, 4])).toThrow();
  });

  test("should map nested object property", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
      required: ["address"],
    });
    expect(shape["address"]!.parse({ city: "NYC" })).toMatchObject({ city: "NYC" });
    expect(() => shape["address"]!.parse({ city: 123 })).toThrow();
  });

  test("should map nullable type (string | null)", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { note: { type: ["string", "null"] } },
      required: ["note"],
    });
    expect(shape["note"]!.parse("hello")).toBe("hello");
    expect(shape["note"]!.parse(null)).toBeNull();
    expect(() => shape["note"]!.parse(42)).toThrow();
  });

  test("should map anyOf to z.union()", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: {
        val: {
          anyOf: [{ type: "string" }, { type: "integer" }],
        },
      },
      required: ["val"],
    });
    expect(shape["val"]!.parse("hello")).toBe("hello");
    expect(shape["val"]!.parse(42)).toBe(42);
  });

  test("should preserve description via .describe()", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { name: { type: "string", description: "The user name" } },
      required: ["name"],
    });
    expect((shape["name"] as z.ZodString).description).toBe("The user name");
  });

  test("should handle unknown type as z.unknown()", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: { anything: {} },
      required: ["anything"],
    });
    expect(shape["anything"]!.parse("x")).toBe("x");
    expect(shape["anything"]!.parse(42)).toBe(42);
    expect(shape["anything"]!.parse(null)).toBeNull();
  });

  test("should apply string constraints (minLength, maxLength, pattern)", () => {
    const shape = jsonSchemaToZodRawShape({
      type: "object",
      properties: {
        code: { type: "string", minLength: 3, maxLength: 6, pattern: "^[A-Z]+$" },
      },
      required: ["code"],
    });
    expect(shape["code"]!.parse("ABC")).toBe("ABC");
    expect(() => shape["code"]!.parse("AB")).toThrow();       // too short
    expect(() => shape["code"]!.parse("ABCDEFG")).toThrow(); // too long
    expect(() => shape["code"]!.parse("abc")).toThrow();     // pattern mismatch
  });
});
