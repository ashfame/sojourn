import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createInitialAppState, SCHEMA_VERSION } from "../domain/defaults";
import { validateAppState } from "../domain/schema";
import type { AppState, StorageCapabilityReport } from "../domain/types";

const DB_NAME = "residency-days-browser-store";
const DB_VERSION = 2;
const STATE_KEY = "current";

interface ResidencyDaysDb extends DBSchema {
  state: {
    key: string;
    value: AppState;
  };
  attachments: {
    key: string;
    value: {
      key: string;
      blob: Blob;
      sha256: string;
      created_at: string;
    };
    indexes: {
      "by-sha256": string;
    };
  };
  invalid_states: {
    key: string;
    value: {
      key: string;
      value: unknown;
      reason: string;
      created_at: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ResidencyDaysDb>> | undefined;

const getDb = (): Promise<IDBPDatabase<ResidencyDaysDb>> => {
  dbPromise ??= openDB<ResidencyDaysDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("state")) {
        db.createObjectStore("state");
      }
      if (!db.objectStoreNames.contains("attachments")) {
        const store = db.createObjectStore("attachments", { keyPath: "key" });
        store.createIndex("by-sha256", "sha256", { unique: false });
      }
      if (!db.objectStoreNames.contains("invalid_states")) {
        db.createObjectStore("invalid_states", { keyPath: "key" });
      }
    }
  });
  return dbPromise;
};

const quarantineInvalidState = async (value: unknown, reason: string): Promise<void> => {
  const db = await getDb();
  const timestamp = new Date().toISOString();
  await db.put("invalid_states", {
    key: `invalid-${timestamp}`,
    value,
    reason,
    created_at: timestamp
  });
};

export const loadAppState = async (): Promise<AppState> => {
  const db = await getDb();
  const stored = await db.get("state", STATE_KEY);
  if (!stored) {
    const initial = createInitialAppState();
    await saveAppState(initial);
    return initial;
  }

  try {
    return validateAppState(
      stored.schema_version === SCHEMA_VERSION
        ? stored
        : {
            ...stored,
            schema_version: SCHEMA_VERSION
          }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await quarantineInvalidState(stored, reason);
    const recovered = {
      ...createInitialAppState(),
      last_error: "Recovered from invalid browser state. The invalid record was quarantined."
    };
    await saveAppState(recovered);
    return recovered;
  }
};

export const saveAppState = async (state: AppState): Promise<void> => {
  const db = await getDb();
  await db.put(
    "state",
    validateAppState({ ...state, last_saved_at: new Date().toISOString() }),
    STATE_KEY
  );
};

export const replaceAppState = async (state: AppState): Promise<AppState> => {
  const next: AppState = validateAppState({
    ...state,
    schema_version: SCHEMA_VERSION,
    last_saved_at: new Date().toISOString()
  });
  await saveAppState(next);
  return next;
};

export const putAttachmentBlob = async (
  key: string,
  blob: Blob,
  sha256: string
): Promise<void> => {
  const db = await getDb();
  await db.put("attachments", {
    key,
    blob,
    sha256,
    created_at: new Date().toISOString()
  });
};

export const getAttachmentBlob = async (key: string): Promise<Blob | undefined> => {
  const db = await getDb();
  return (await db.get("attachments", key))?.blob;
};

export const deleteAttachmentBlob = async (key: string): Promise<void> => {
  const db = await getDb();
  await db.delete("attachments", key);
};

export const deleteAllData = async (): Promise<AppState> => {
  const db = await getDb();
  const initial = createInitialAppState();
  const transaction = db.transaction(["state", "attachments", "invalid_states"], "readwrite");
  await transaction.objectStore("attachments").clear();
  await transaction.objectStore("invalid_states").clear();
  await transaction.objectStore("state").put(initial, STATE_KEY);
  await transaction.done;
  return initial;
};

export const detectStorageCapabilities = async (): Promise<StorageCapabilityReport> => {
  const storageEstimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();

  return {
    serviceWorker: "serviceWorker" in navigator,
    webWorker: typeof Worker !== "undefined",
    indexedDb: "indexedDB" in globalThis,
    opfs: typeof navigator.storage?.getDirectory === "function",
    webCrypto: Boolean(globalThis.crypto?.subtle),
    storageEstimate: storageEstimate
      ? {
          quota: storageEstimate.quota,
          usage: storageEstimate.usage,
          persisted
        }
      : undefined,
    crossOriginIsolated: globalThis.crossOriginIsolated
  };
};

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) {
    return false;
  }
  return navigator.storage.persist();
};
