# Vendored Proto Versions

Protos in `packages/provider-openshell/proto/` are vendored from [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell).
**Do not edit by hand** — run the update script instead.

**Pinned commit:** `d331ed511792e4c4f84b5dff18807d79fcf4df85`
**Commit date:** 2026-04-24
**Commit subject:** feat(ci): add shadow-docker-build workflow for OS-49 Phase 3 (#964)

## Files

- `openshell.proto`
- `sandbox.proto`
- `datamodel.proto`

## Update

```bash
pnpm update-openshell-protos <new-commit-sha>   # pin to a new upstream commit
pnpm update-openshell-protos                    # re-fetch the currently pinned commit
```

The script verifies the commit on GitHub, downloads the three proto files from
`raw.githubusercontent.com`, writes them into the proto directory, and rewrites
this file. After any update run:

```bash
pnpm -F @conductor/provider-openshell test
```

Any breakage is a signal that upstream changed a message shape we depend on —
address it explicitly (schema bump, new field handling) in the same PR.
