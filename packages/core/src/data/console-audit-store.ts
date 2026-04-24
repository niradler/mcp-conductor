import type { AuditCall, AuditQuery, AuditStore } from "./audit-store.js";

function matches(c: AuditCall, q: AuditQuery): boolean {
  if (q.user && c.user !== q.user) return false;
  if (q.provider && c.provider !== q.provider) return false;
  if (q.tool && c.tool !== q.tool) return false;
  if (q.status && c.status !== q.status) return false;
  if (q.since && c.ts < q.since) return false;
  if (q.requestId && c.requestId !== q.requestId) return false;
  return true;
}

export interface ConsoleAuditStoreOptions {
  /** Max rows retained in memory for queryCalls. Oldest evicted. Default 1000. */
  bufferSize?: number;
  /** Writer for audit lines. Defaults to `console.error` so audit goes to stderr alongside logs. */
  writer?: (line: string) => void;
}

export class ConsoleAuditStore implements AuditStore {
  private readonly bufferSize: number;
  private readonly writer: (line: string) => void;
  private readonly buffer: AuditCall[] = [];
  private nextId = 1;

  constructor(options: ConsoleAuditStoreOptions = {}) {
    this.bufferSize = options.bufferSize ?? 1000;
    this.writer = options.writer ?? ((line) => console.error(line));
  }

  async insertCall(call: Omit<AuditCall, "id">): Promise<number> {
    const id = this.nextId++;
    const row: AuditCall = { id, ...call };
    this.writer(JSON.stringify({ kind: "audit", ...row }));
    this.buffer.push(row);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    return id;
  }

  async queryCalls(q: AuditQuery = {}): Promise<AuditCall[]> {
    const limit = q.limit ?? 100;
    const matched = this.buffer.filter((c) => matches(c, q));
    matched.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return matched.slice(0, limit);
  }

  async count(q: AuditQuery = {}): Promise<number> {
    return this.buffer.filter((c) => matches(c, q)).length;
  }

  async flush(): Promise<void> {
    /* stderr is line-buffered; nothing to flush */
  }

  async close(): Promise<void> {
    /* no resources */
  }
}
