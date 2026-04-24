import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";

// Resolves correctly from both `src/proto-loader.ts` (vitest) and `dist/proto-loader.js` (published).
const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(HERE, "..", "proto");

export interface LoadedProto {
  OpenShellService: grpc.ServiceClientConstructor;
}

let cached: LoadedProto | undefined;

export function loadProto(): LoadedProto {
  if (cached) return cached;

  const pkgDef = protoLoader.loadSync(
    [
      join(PROTO_DIR, "openshell.proto"),
      join(PROTO_DIR, "sandbox.proto"),
      join(PROTO_DIR, "datamodel.proto"),
    ],
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    },
  );

  const grpcPkg = grpc.loadPackageDefinition(pkgDef) as unknown as {
    openshell: { v1: { OpenShell: grpc.ServiceClientConstructor } };
  };

  cached = { OpenShellService: grpcPkg.openshell.v1.OpenShell };
  return cached;
}
