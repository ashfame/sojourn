import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createInitialData, migrateAppData } from "../domain/seed";
import type { AppData } from "../domain/types";
import { blobToArrayBuffer, blobToText, createArchive, parseArchive } from "./archive";
import type { PersistedAppData, StorageDriver, StorageMetadata } from "./storageDriver";

const DB_NAME = "sojourn-browser-store";
const DB_VERSION = 2;
const APP_KEY = "current";
export const STORAGE_BACKUP_KEY = "sojourn-browser-store.current.v1";

interface SojournDb extends DBSchema {
  app: {
    key: string;
    value: StoredRecord;
  };
  files: {
    key: string;
    value: FileRecord;
  };
}

interface StoredRecord {
  key: string;
  data: AppData;
  savedAt: string;
  revision: number;
}

interface FileRecord {
  key: string;
  buffer: ArrayBuffer;
  type: string;
  savedAt: string;
}

let dbPromise: Promise<IDBPDatabase<SojournDb>> | undefined;

const getDb = (): Promise<IDBPDatabase<SojournDb>> => {
  dbPromise ??= openDB<SojournDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("app")) {
        db.createObjectStore("app", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "key" });
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

const saveStoredFile = async (key: string, blob: Blob): Promise<void> => {
  const db = await getDb();
  await db.put("files", {
    key,
    buffer: await blobToArrayBuffer(blob),
    type: blob.type,
    savedAt: new Date().toISOString()
  });
};

const getStoredFile = async (
  item: { blobKey?: string | undefined }
): Promise<Blob | undefined> => {
  if (!item.blobKey) {
    return undefined;
  }
  const db = await getDb();
  const record = await db.get("files", item.blobKey);
  return record ? new Blob([record.buffer], { type: record.type }) : undefined;
};

const deleteStoredFile = async (key?: string): Promise<void> => {
  if (!key) {
    return;
  }
  const db = await getDb();
  await db.delete("files", key);
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

  async exportData(data: AppData): Promise<Blob> {
    return createArchive(data, async (item) => this.getFile(item));
  },

  async importData(blob: Blob): Promise<AppData> {
    const fileName =
      typeof File !== "undefined" && blob instanceof File ? blob.name.toLowerCase() : "";
    const type = "type" in blob ? blob.type : "";
    const looksJson = type.includes("json") || fileName.endsWith(".json");
    if (looksJson) {
      const text = await blobToText(blob);
      return migrateAppData(JSON.parse(text) as AppData);
    }
    try {
      const archive = await parseArchive(blob);
      const data = {
        ...archive.data,
        evidence: archive.data.evidence.map((item) => {
          const file = archive.files.find((candidate) => candidate.evidenceId === item.id);
          if (!file) {
            return item;
          }
          return {
            ...item,
            blobKey: `evidence/${item.id}`,
            fileName: file.fileName,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            sizeBytes: file.sizeBytes
          };
        }),
        passportPages: archive.data.passportPages.map((page) => {
          const file = archive.passportPageFiles.find(
            (candidate) => candidate.passportPageId === page.id
          );
          if (!file) {
            return page;
          }
          return {
            ...page,
            blobKey: `passport-pages/${page.id}`,
            fileName: file.fileName,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            sizeBytes: file.sizeBytes
          };
        })
      };
      await Promise.all(
        [
          ...archive.files.map((file) => ({
            key: `evidence/${file.evidenceId}`,
            blob: file.blob
          })),
          ...archive.passportPageFiles.map((file) => ({
            key: `passport-pages/${file.passportPageId}`,
            blob: file.blob
          }))
        ].map(async (file) => saveStoredFile(file.key, file.blob))
      );
      return data;
    } catch {
      const text = await blobToText(blob);
      return migrateAppData(JSON.parse(text) as AppData);
    }
  },

  saveFile: saveStoredFile,

  getFile: getStoredFile,

  deleteFile: deleteStoredFile,

  async saveEvidenceFile(key: string, blob: Blob): Promise<void> {
    await saveStoredFile(key, blob);
  },

  async getEvidenceFile(item): Promise<Blob | undefined> {
    return getStoredFile(item);
  },

  async savePassportPageFile(key: string, blob: Blob): Promise<void> {
    await saveStoredFile(key, blob);
  },

  async getPassportPageFile(item): Promise<Blob | undefined> {
    return getStoredFile(item);
  },

  async deleteEvidenceFile(key?: string): Promise<void> {
    await deleteStoredFile(key);
  }
});
