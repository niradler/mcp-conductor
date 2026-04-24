export interface AuditCall {
  id?: number;
  ts: string;
  user: string;
  provider: string;
  tool: string;
  args: string;
  status: "success" | "error";
  error?: string | null;
  durationMs: number;
  requestId?: string | null;
}

export interface AuditQuery {
  user?: string;
  provider?: string;
  tool?: string;
  status?: "success" | "error";
  since?: string;
  requestId?: string;
  limit?: number;
}

export interface AuditStore {
  insertCall(call: Omit<AuditCall, "id">): Promise<number>;
  queryCalls(q?: AuditQuery): Promise<AuditCall[]>;
  count(q?: AuditQuery): Promise<number>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
