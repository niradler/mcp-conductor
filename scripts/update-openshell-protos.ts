import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO = "NVIDIA/OpenShell";
const PROTOS = ["openshell.proto", "sandbox.proto", "datamodel.proto"] as const;
const PROTO_DIR = "packages/provider-openshell/proto";
const VERSION_FILE = "packages/provider-openshell/PROTO_VERSION.md";

async function main(): Promise<void> {
  let sha = process.argv[2];

  if (!sha) {
    const existing = await readFile(VERSION_FILE, "utf8").catch(() => "");
    const match = existing.match(/\*\*Pinned commit:\*\*\s+`([a-f0-9]{7,40})`/);
    sha = match?.[1];
    if (!sha) {
      console.error("usage: pnpm update-openshell-protos <commit-sha>");
      console.error("  (or have a pinned SHA already in PROTO_VERSION.md to re-fetch it)");
      process.exit(1);
    }
    console.log(`using pinned SHA from ${VERSION_FILE}: ${sha}`);
  }

  const commitRes = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}`);
  if (!commitRes.ok) {
    console.error(`commit ${sha} not found on ${REPO}: ${commitRes.status} ${commitRes.statusText}`);
    process.exit(1);
  }
  const commit = (await commitRes.json()) as {
    sha: string;
    commit: { message: string; author: { date: string } };
  };
  const fullSha = commit.sha;
  const subject = commit.commit.message.split("\n", 1)[0] ?? "";
  const date = commit.commit.author.date.slice(0, 10);

  await mkdir(PROTO_DIR, { recursive: true });
  for (const name of PROTOS) {
    const url = `https://raw.githubusercontent.com/${REPO}/${fullSha}/proto/${name}`;
    console.log(`fetching ${name}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`failed to fetch ${name} (${res.status} ${res.statusText}): ${url}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(PROTO_DIR, name), buf);
  }

  const body = `# Vendored Proto Versions

Protos in \`packages/provider-openshell/proto/\` are vendored from [NVIDIA/OpenShell](https://github.com/${REPO}).
**Do not edit by hand** — run the update script instead.

**Pinned commit:** \`${fullSha}\`
**Commit date:** ${date}
**Commit subject:** ${subject}

## Files

${PROTOS.map((p) => `- \`${p}\``).join("\n")}

## Update

\`\`\`bash
pnpm update-openshell-protos <new-commit-sha>   # pin to a new upstream commit
pnpm update-openshell-protos                    # re-fetch the currently pinned commit
\`\`\`

The script verifies the commit on GitHub, downloads the three proto files from
\`raw.githubusercontent.com\`, writes them into the proto directory, and rewrites
this file. After any update run:

\`\`\`bash
pnpm -F @conductor/provider-openshell test
\`\`\`

Any breakage is a signal that upstream changed a message shape we depend on —
address it explicitly (schema bump, new field handling) in the same PR.
`;
  await writeFile(VERSION_FILE, body);
  console.log(`\npinned to ${fullSha.slice(0, 12)} (${date}) — ${subject}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
