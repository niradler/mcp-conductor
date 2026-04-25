import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import { buildChannelCredentials } from "../src/credentials.js";

// Arbitrary PEM-shaped strings. The real credentials.ts never parses them in-process —
// grpc-js + BoringSSL do that at connect time, which is exercised by the integration suite.
const CA_PEM = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
const CERT_PEM = "-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n";
const KEY_PEM = "-----BEGIN EC PRIVATE KEY-----\nCCCC\n-----END EC PRIVATE KEY-----\n";

describe("buildChannelCredentials", () => {
  let sslSpy: MockInstance<typeof grpc.credentials.createSsl> | undefined;

  beforeEach(() => {
    sslSpy = vi
      .spyOn(grpc.credentials, "createSsl")
      .mockReturnValue({ _isSecure: () => true } as unknown as grpc.ChannelCredentials);
  });

  afterEach(() => {
    sslSpy?.mockRestore();
    sslSpy = undefined;
  });

  test("insecure mode returns insecure credentials without calling createSsl", () => {
    const creds = buildChannelCredentials({ mode: "insecure" });
    expect(creds._isSecure()).toBe(false);
    expect(sslSpy).not.toHaveBeenCalled();
  });

  test("tls mode forwards inline PEM string as a Buffer (ca only)", () => {
    buildChannelCredentials({ mode: "tls", ca: CA_PEM });
    expect(sslSpy).toHaveBeenCalledTimes(1);
    const [caArg, keyArg, certArg] = sslSpy!.mock.calls[0]!;
    expect(Buffer.isBuffer(caArg)).toBe(true);
    expect((caArg as Buffer).toString("utf8")).toBe(CA_PEM);
    expect(keyArg).toBeUndefined();
    expect(certArg).toBeUndefined();
  });

  test("tls mode with a filesystem path reads the file into a Buffer", () => {
    const dir = mkdtempSync(join(tmpdir(), "osl-creds-"));
    const caPath = join(dir, "ca.pem");
    writeFileSync(caPath, CA_PEM);
    try {
      buildChannelCredentials({ mode: "tls", ca: caPath });
      const [caArg] = sslSpy!.mock.calls[0]!;
      expect(Buffer.isBuffer(caArg)).toBe(true);
      expect((caArg as Buffer).toString("utf8")).toBe(CA_PEM);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tls mode with a Buffer passes the Buffer through untouched", () => {
    const buf = Buffer.from(CA_PEM, "utf8");
    buildChannelCredentials({ mode: "tls", ca: buf });
    const [caArg] = sslSpy!.mock.calls[0]!;
    expect(caArg).toBe(buf);
  });

  test("mtls forwards ca/key/cert in grpc-js positional order (ca, key, cert)", () => {
    buildChannelCredentials({ mode: "mtls", ca: CA_PEM, cert: CERT_PEM, key: KEY_PEM });
    const [caArg, keyArg, certArg] = sslSpy!.mock.calls[0]!;
    expect((caArg as Buffer).toString("utf8")).toBe(CA_PEM);
    expect((keyArg as Buffer).toString("utf8")).toBe(KEY_PEM);
    expect((certArg as Buffer).toString("utf8")).toBe(CERT_PEM);
  });

  test("mtls throws with a key-mentioning message when 'key' is missing", () => {
    expect(() =>
      buildChannelCredentials({ mode: "mtls", ca: CA_PEM, cert: CERT_PEM } as never),
    ).toThrow(/key/);
  });

  test("mtls throws when 'cert' is missing", () => {
    expect(() =>
      buildChannelCredentials({ mode: "mtls", ca: CA_PEM, key: KEY_PEM } as never),
    ).toThrow(/cert/);
  });

  test("mtls throws when 'ca' is missing", () => {
    expect(() =>
      buildChannelCredentials({ mode: "mtls", cert: CERT_PEM, key: KEY_PEM } as never),
    ).toThrow(/ca/);
  });

  test("unknown mode throws", () => {
    expect(() => buildChannelCredentials({ mode: "sploosh" } as never)).toThrow(/unknown tls mode/);
  });
});
