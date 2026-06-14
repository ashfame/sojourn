import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createInitialData } from "../domain/seed";
import type { AppData } from "../domain/types";
import type { PersistedAppData, StorageDriver, StorageMetadata } from "./storageDriver";

const DB_NAME = "sojourn-browser-store";
const DB_VERSION = 1;
const APP_KEY = "current";

interface SojournDb extends DBSchema {
  app: {
    key: string;
    value: {
      key: string;
      data: AppData;
      savedAt: string;
      revision: number;
    };
  };
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

export const createIndexedDbStorage = (): StorageDriver => ({
  async load(): Promise<PersistedAppData> {
    const db = await getDb();
    const stored = await db.get("app", APP_KEY);
    if (stored) {
      return {
        data: stored.data,
        metadata: metadata(stored.savedAt, stored.revision)
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
    await db.put("app", {
      key: APP_KEY,
      data: { ...data, updatedAt: savedAt },
      savedAt,
      revision
    });
    return metadata(savedAt, revision);
  },

  exportData(data: AppData): Promise<Blob> {
    return Promise.resolve(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  },

  async importData(blob: Blob): Promise<AppData> {
    const text = await blob.text();
    return JSON.parse(text) as AppData;
  }
});
