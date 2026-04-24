const SENSITIVE_KEY_RE =
  /password|secret|token|api[_-]?key|apikey|authorization|auth|credential|private[_-]?key|bearer/i;
const DEFAULT_MAX_BYTES = 4096;

export interface RedactOptions {
  maxBytes?: number;
  extraKeys?: string[];
}

function isSensitiveKey(key: string, extra: string[]): boolean {
  if (SENSITIVE_KEY_RE.test(key)) return true;
  const lower = key.toLowerCase();
  return extra.some((k) => k.toLowerCase() === lower);
}

function redactValue(value: unknown, extra: string[], seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[CIRCULAR]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extra, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k, extra) ? "[REDACTED]" : redactValue(v, extra, seen);
  }
  return out;
}

export function redactArgs(args: unknown, options: RedactOptions = {}): string {
  const extra = options.extraKeys ?? [];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const redacted = redactValue(args, extra, new WeakSet());
  let json: string;
  try {
    json = JSON.stringify(redacted);
  } catch {
    json = '"[UNSERIALIZABLE]"';
  }
  if (json.length > maxBytes) json = json.slice(0, maxBytes) + '..."[TRUNCATED]"';
  return json;
}
