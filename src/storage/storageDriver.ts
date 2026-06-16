import type { AppData, EvidenceItem } from "../domain/types";

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
  saveEvidenceFile(key: string, blob: Blob): Promise<void>;
  getEvidenceFile(item: EvidenceItem): Promise<Blob | undefined>;
  deleteEvidenceFile(key?: string): Promise<void>;
}

export interface RemoteSyncDriver {
  pull(): Promise<PersistedAppData | undefined>;
  push(data: AppData, previousRevision?: number): Promise<StorageMetadata>;
}
