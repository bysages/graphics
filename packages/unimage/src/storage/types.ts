export interface ProxyStorageMeta {
  mtime?: Date | number | string;
  maxAge?: number | string;
}

export interface ProxyStorageOptions {
  signal?: AbortSignal | undefined;
}

export interface ProxyStorage {
  readonly name: string;
  getMeta(
    id: string,
    options?: ProxyStorageOptions,
  ): Promise<ProxyStorageMeta | undefined> | ProxyStorageMeta | undefined;
  getData(
    id: string,
    options?: ProxyStorageOptions,
  ): Promise<Uint8Array | ArrayBuffer | undefined> | Uint8Array | ArrayBuffer | undefined;
}
