import type { AppData } from "../domain/types";

export interface StorageMetadata {
  backend: "indexeddb" | "remote_sqlite" | "memory";
  savedAt?: string;
  revision?: number;
}

export interface PersistedAppData {
  data: AppData;
  metadata: StorageMetadata;
}

export interface StorageDriver {
  load(): Promise<PersistedAppData>;
  save(data: AppData): Promise<StorageMetadata>;
  exportData(data: AppData): Promise<Blob>;
  importData(blob: Blob): Promise<AppData>;
}

export interface RemoteSyncDriver {
  pull(): Promise<PersistedAppData | undefined>;
  push(data: AppData, previousRevision?: number): Promise<StorageMetadata>;
}
