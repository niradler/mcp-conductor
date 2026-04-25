export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface Timed<T> {
  value: T;
  startedAt: number;
  durationMs: number;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
