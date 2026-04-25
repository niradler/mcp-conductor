import { createHash } from "node:crypto";

const token = process.argv[2];
if (!token) {
  console.error("usage: pnpm hash-key <plaintext-token>");
  process.exit(1);
}

const hex = createHash("sha256").update(token).digest("hex");
process.stdout.write(`sha256:${hex}\n`);
