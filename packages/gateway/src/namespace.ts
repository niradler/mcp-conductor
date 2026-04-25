const SEP = "__";

export function encodeToolName(provider: string, tool: string): string {
  if (provider.includes(SEP)) throw new Error(`invalid provider name (contains __): ${provider}`);
  return `${provider}${SEP}${tool}`;
}

export function decodeToolName(encoded: string): { provider: string; tool: string } | null {
  const idx = encoded.indexOf(SEP);
  if (idx <= 0) return null;
  const provider = encoded.slice(0, idx);
  const tool = encoded.slice(idx + SEP.length);
  if (!tool) return null;
  return { provider, tool };
}
