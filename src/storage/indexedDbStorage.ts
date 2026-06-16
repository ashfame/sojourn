import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createInitialData, migrateAppData } from "../domain/seed";
import type { AppData } from "../domain/types";
import type { PersistedAppData, StorageDriver, StorageMetadata } from "./storageDriver";

const DB_NAME = "sojourn-browser-store";
const DB_VERSION = 1;
const APP_KEY = "current";
export const STORAGE_BACKUP_KEY = "sojourn-browser-store.current.v1";

interface SojournDb extends DBSchema {
  app: {
    key: string;
    value: StoredRecord;
  };
}

interface StoredRecord {
  key: string;
  data: AppData;
  savedAt: string;
  revision: number;
}

let dbPromise: Promise<IDBPDatabase<SojournDb>> | undefined;

const getDb = (): Promise<IDBPDatabase<SojournDb>> => {
  dbPromise ??= openDB<SojournDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("app")) {
        db.createObjectStore("app", { keyPath: "key" });
      }
    }
  });
  return dbPromise;
};

const metadata = (savedAt?: string, revision?: number): StorageMetadata => ({
  backend: "indexeddb",
  ...(savedAt ? { savedAt } : {}),
  ...(revision !== undefined ? { revision } : {})
});

const readBackup = (): StoredRecord | undefined => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_BACKUP_KEY);
    return raw ? (JSON.parse(raw) as StoredRecord) : undefined;
  } catch {
    return undefined;
  }
};

const writeBackup = (record: StoredRecord): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_BACKUP_KEY, JSON.stringify(record));
  } catch {
    // IndexedDB is the source of truth; localStorage is only a cross-tab/fallback mirror.
  }
};

const newerRecord = (
  left: StoredRecord | undefined,
  right: StoredRecord | undefined
): StoredRecord | undefined => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (right.revision !== left.revision) {
    return right.revision > left.revision ? right : left;
  }
  return right.savedAt > left.savedAt ? right : left;
};

export const createIndexedDbStorage = (): StorageDriver => ({
  async load(): Promise<PersistedAppData> {
    const db = await getDb();
    const stored = await db.get("app", APP_KEY);
    const backup = readBackup();
    const latest = newerRecord(stored, backup);
    if (latest) {
      const data = migrateAppData(latest.data);
      const record = {
        ...latest,
        data
      };
      if (latest !== stored || data !== latest.data) {
        await db.put("app", record);
      }
      writeBackup(record);
      return {
        data,
        metadata: metadata(latest.savedAt, latest.revision)
      };
    }
    const data = createInitialData();
    const savedAt = new Date().toISOString();
    await db.put("app", { key: APP_KEY, data, savedAt, revision: 1 });
    return {
      data,
      metadata: metadata(savedAt, 1)
    };
  },

  async save(data: AppData): Promise<StorageMetadata> {
    const db = await getDb();
    const stored = await db.get("app", APP_KEY);
    const savedAt = new Date().toISOString();
    const revision = (stored?.revision ?? 0) + 1;
    const record = {
      key: APP_KEY,
      data: { ...data, updatedAt: savedAt },
      savedAt,
      revision
    };
    await db.put("app", record);
    writeBackup(record);
    return metadata(savedAt, revision);
  },

  exportData(data: AppData): Promise<Blob> {
    return Promise.resolve(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  },

  async importData(blob: Blob): Promise<AppData> {
    const text = await blob.text();
    return migrateAppData(JSON.parse(text) as AppData);
  }
});
