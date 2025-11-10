# Publishing MCP Conductor

## Version 0.2.0 - Security Model Fix

This version corrects the security model to align with Deno's official design.

### Changes in v0.2.0
- ✅ Removed invalid `--no-data-urls` flag
- ✅ Corrected security documentation
- ✅ Added permanent default configuration tests
- ✅ Max return size: 256KB with file saving
- ✅ All 31 tests passing

### Publishing to JSR

```bash
# 1. Ensure you're logged in to JSR
deno login

# 2. Publish to JSR
deno publish
```

### Publishing Checklist

- [x] All tests passing (31/31)
- [x] Documentation updated
- [x] Security model corrected
- [x] Version bumped to 0.2.0
- [x] Code formatted and linted
- [x] Changes committed and pushed
- [ ] Run `deno publish --dry-run` to check
- [ ] Run `deno publish` to publish

### Package Info

- **Name**: `@mcp/conductor`
- **Version**: `0.2.0`
- **Registry**: JSR (jsr.io)
- **License**: Apache 2.0

### Installation After Publishing

```bash
# Install via JSR
deno add jsr:@mcp/conductor@^0.2

# Or use directly
deno run jsr:@mcp/conductor@^0.2
```

### Breaking Changes from v0.1.0

The security model has been corrected:
- `eval()`, `Function()`, and data: URLs are now documented as allowed by design
- The security boundary is the permission sandbox, not code execution restrictions
- No functional breaking changes - code that worked before still works

### What's Next

1. Publish to JSR
2. Update GitHub README badges
3. Create GitHub release v0.2.0
4. Consider adding to Deno showcase

---

**Ready to publish!** 🚀

