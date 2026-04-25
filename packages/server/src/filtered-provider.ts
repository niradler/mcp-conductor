import type { ToolProvider } from "@conductor/core";

export interface FilterOptions {
  allowTools?: string[];
  excludeTools?: string[];
}

function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(name, p));
}

export function filteredProvider(inner: ToolProvider, opts: FilterOptions): ToolProvider {
  if (!opts.allowTools?.length && !opts.excludeTools?.length) return inner;

  return {
    name: inner.name,
    connect: () => inner.connect(),
    close: () => inner.close(),
    async listTools() {
      const tools = await inner.listTools();
      return tools.filter((t) => {
        if (opts.allowTools?.length && !matchesAny(t.name, opts.allowTools)) return false;
        if (opts.excludeTools?.length && matchesAny(t.name, opts.excludeTools)) return false;
        return true;
      });
    },
    callTool(name, args, ctx) {
      return inner.callTool(name, args, ctx);
    },
  };
}
