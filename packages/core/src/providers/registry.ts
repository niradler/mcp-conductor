import { ProviderError } from "../errors/index.js";
import type { ToolProvider } from "./tool-provider.js";

/**
 * Holds the set of providers by name. Names must be unique, must not contain `__`
 * (the gateway uses `__` as the tool-namespace separator), and must match a
 * conservative identifier charset.
 */
export class ProviderRegistry {
  private readonly byName = new Map<string, ToolProvider>();

  register(provider: ToolProvider): void {
    if (this.byName.has(provider.name)) {
      throw new ProviderError(`duplicate provider name: ${provider.name}`, provider.name);
    }
    if (provider.name.includes("__")) {
      throw new ProviderError(`provider name must not contain "__": ${provider.name}`, provider.name);
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(provider.name)) {
      throw new ProviderError(`invalid provider name: ${provider.name}`, provider.name);
    }
    this.byName.set(provider.name, provider);
  }

  get(name: string): ToolProvider | undefined {
    return this.byName.get(name);
  }

  require(name: string): ToolProvider {
    const p = this.byName.get(name);
    if (!p) throw new ProviderError(`unknown provider: ${name}`, name);
    return p;
  }

  names(): string[] {
    return Array.from(this.byName.keys());
  }

  all(): ToolProvider[] {
    return Array.from(this.byName.values());
  }

  async connectAll(): Promise<void> {
    for (const p of this.byName.values()) await p.connect();
  }

  async closeAll(): Promise<void> {
    for (const p of this.byName.values()) {
      try {
        await p.close();
      } catch {
        /* swallow; caller logs */
      }
    }
  }
}
