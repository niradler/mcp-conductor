import { readFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";

export type TlsOptions =
  | { mode: "insecure" }
  | { mode: "tls"; ca: string | Buffer }
  | { mode: "mtls"; ca: string | Buffer; cert: string | Buffer; key: string | Buffer };

function toBuffer(input: string | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  // Inline PEM (string starts with a BEGIN header) vs. filesystem path.
  if (input.includes("-----BEGIN")) return Buffer.from(input, "utf8");
  return readFileSync(input);
}

export function buildChannelCredentials(tls: TlsOptions): grpc.ChannelCredentials {
  switch (tls.mode) {
    case "insecure":
      return grpc.credentials.createInsecure();
    case "tls":
      if (!tls.ca) throw new Error("tls mode requires 'ca' (PEM path, string, or Buffer)");
      return grpc.credentials.createSsl(toBuffer(tls.ca));
    case "mtls": {
      if (!tls.ca) throw new Error("mtls mode requires 'ca' (PEM path, string, or Buffer)");
      if (!tls.cert) throw new Error("mtls mode requires 'cert' (PEM path, string, or Buffer)");
      if (!tls.key) throw new Error("mtls mode requires 'key' (PEM path, string, or Buffer)");
      // grpc-js positional order: (rootCerts, privateKey, certChain)
      return grpc.credentials.createSsl(toBuffer(tls.ca), toBuffer(tls.key), toBuffer(tls.cert));
    }
    default:
      throw new Error(`unknown tls mode: ${(tls as { mode: string }).mode}`);
  }
}
