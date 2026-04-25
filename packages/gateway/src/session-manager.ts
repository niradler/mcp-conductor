import type { Logger } from "@conductor/core";

export interface Session<Mcp, Tr> {
  id: string;
  user: string;
  mcp: Mcp;
  transport: Tr;
  createdAt: number;
}

export interface SessionClosers<Mcp, Tr> {
  closeMcp(mcp: Mcp): Promise<void>;
  closeTransport(tr: Tr): Promise<void>;
}

export class SessionManager<Mcp, Tr> {
  private readonly map = new Map<string, Session<Mcp, Tr>>();
  private readonly order: string[] = [];
  constructor(
    private readonly maxSessions: number,
    private readonly closers: SessionClosers<Mcp, Tr>,
    private readonly log: Pick<Logger, "info" | "warn">,
  ) {}

  size(): number { return this.map.size; }
  get(id: string): Session<Mcp, Tr> | undefined { return this.map.get(id); }

  async add(session: Session<Mcp, Tr>): Promise<void> {
    this.map.set(session.id, session);
    this.order.push(session.id);
    while (this.map.size > this.maxSessions) {
      const oldest = this.order.shift();
      if (!oldest) break;
      this.log.warn("evicting oldest session", { sessionId: oldest });
      await this.remove(oldest);
    }
  }

  async remove(id: string): Promise<void> {
    const s = this.map.get(id);
    if (!s) return;
    this.map.delete(id);
    const idx = this.order.indexOf(id);
    if (idx >= 0) this.order.splice(idx, 1);
    try { await this.closers.closeMcp(s.mcp); } catch (err) { this.log.warn("closeMcp failed", { id, err }); }
    try { await this.closers.closeTransport(s.transport); } catch (err) { this.log.warn("closeTransport failed", { id, err }); }
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.order]) await this.remove(id);
  }
}
