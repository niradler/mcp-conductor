export interface ConfigStore<T> {
  load(): Promise<T>;
  reload(): Promise<T>;
  readonly source: string;
}
