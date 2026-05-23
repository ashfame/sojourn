/// <reference lib="webworker" />

import { createId } from "../domain/defaults";
import { computeDayLedger, createDayCountSnapshot } from "../domain/dayLedger";
import { sha256Hex } from "../domain/hash";
import {
  deleteDocumentFromState,
  deleteDocumentLinkFromState,
  deleteManualCorrectionFromState,
  deletePresenceIntervalFromState,
  deleteStayEventFromState,
  deleteTaxYearProfileFromState,
  deleteTravelEventFromState
} from "../domain/mutations";
import type {
  AppState,
  DayCountSnapshot,
  DocumentLink,
  ResidencyDocument,
  TaxYearProfile
} from "../domain/types";
import {
  deleteAllData,
  detectStorageCapabilities,
  loadAppState,
  replaceAppState,
  requestPersistentStorage,
  saveAppState
} from "../storage/indexedDb";
import {
  clearOpfsAttachments,
  deleteAttachmentBlob,
  storeAttachmentBlob
} from "../storage/attachments";
import { SqliteWorkingCache } from "../storage/sqliteCache";
import { createExportPackage } from "../storage/snapshot";
import type { DataWorkerRequest, DataWorkerResponse } from "./dataWorkerProtocol";

let statePromise: Promise<AppState> | undefined;
let sqliteCachePromise: Promise<SqliteWorkingCache | undefined> | undefined;

const nowIso = (): string => new Date().toISOString();

const getState = async (): Promise<AppState> => {
  statePromise ??= (async () => {
    sqliteCachePromise ??= SqliteWorkingCache.open();
    const sqliteCache = await sqliteCachePromise;
    const sqliteState = sqliteCache?.loadState();
    if (sqliteState) {
      return sqliteState;
    }
    const indexedState = await loadAppState();
    sqliteCache?.saveState(indexedState);
    return indexedState;
  })();
  return statePromise;
};

const persistMutation = async (next: AppState): Promise<AppState> => {
  const mutated: AppState = {
    ...next,
    local_generation: next.local_generation + 1,
    upload_status: "pending",
    last_error: undefined,
    last_saved_at: nowIso()
  };
  statePromise = Promise.resolve(mutated);
  sqliteCachePromise ??= SqliteWorkingCache.open();
  const sqliteCache = await sqliteCachePromise;
  sqliteCache?.saveState(mutated);
  await saveAppState(mutated);
  return mutated;
};

const findProfile = (state: AppState, profileId: string): TaxYearProfile => {
  const profile = state.tax_year_profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`Tax-year profile not found: ${profileId}`);
  }
  return profile;
};

const addDocument = async (
  state: AppState,
  payload: Extract<DataWorkerRequest, { type: "importDocument" }>["payload"]
): Promise<AppState> => {
  const timestamp = nowIso();
  const blob = new Blob([payload.bytes], { type: payload.mime_type });
  const sha256 = await sha256Hex(payload.bytes);
  const location = await storeAttachmentBlob(blob, sha256);

  const document: ResidencyDocument = {
    id: createId("document"),
    title: payload.title,
    kind: payload.kind,
    mime_type: payload.mime_type,
    size_bytes: payload.bytes.byteLength,
    sha256,
    capture_date: payload.capture_date,
    local_storage_backend: location.backend,
    local_storage_key: location.key,
    remote_object_key: `attachments/sha256/${sha256.slice(0, 2)}/${sha256}`,
    upload_status: "pending",
    verification_status: "verified",
    created_at: timestamp,
    updated_at: timestamp
  };

  const link: DocumentLink | undefined = payload.link
    ? {
        id: createId("document_link"),
        document_id: document.id,
        entity_type: payload.link.entity_type,
        entity_id: payload.link.entity_id,
        relationship: payload.link.relationship,
        created_at: timestamp
      }
    : undefined;

  return persistMutation({
    ...state,
    documents: [...state.documents, document],
    document_links: link ? [...state.document_links, link] : state.document_links
  });
};

const handleRequest = async (request: DataWorkerRequest): Promise<DataWorkerResponse> => {
  switch (request.type) {
    case "init":
    case "getState":
      return { id: request.id, ok: true, type: "state", payload: await getState() };

    case "detectCapabilities":
      return {
        id: request.id,
        ok: true,
        type: "capabilities",
        payload: await detectStorageCapabilities()
      };

    case "requestPersistentStorage":
      return {
        id: request.id,
        ok: true,
        type: "persistentStorage",
        payload: await requestPersistentStorage()
      };

    case "reset": {
      const reset = await deleteAllData();
      await clearOpfsAttachments();
      sqliteCachePromise ??= SqliteWorkingCache.open();
      const sqliteCache = await sqliteCachePromise;
      sqliteCache?.saveState(reset);
      statePromise = Promise.resolve(reset);
      return { id: request.id, ok: true, type: "state", payload: reset };
    }

    case "addTravelEvent": {
      const state = await getState();
      const timestamp = nowIso();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation({
          ...state,
          travel_events: [
            ...state.travel_events,
            {
              ...request.payload,
              id: createId("travel"),
              created_at: timestamp,
              updated_at: timestamp
            }
          ]
        })
      };
    }

    case "deleteTravelEvent": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deleteTravelEventFromState(state, request.payload.id))
      };
    }

    case "addStayEvent": {
      const state = await getState();
      const timestamp = nowIso();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation({
          ...state,
          stay_events: [
            ...state.stay_events,
            {
              ...request.payload,
              id: createId("stay"),
              created_at: timestamp,
              updated_at: timestamp
            }
          ]
        })
      };
    }

    case "deleteStayEvent": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deleteStayEventFromState(state, request.payload.id))
      };
    }

    case "addPresenceInterval": {
      const state = await getState();
      const timestamp = nowIso();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation({
          ...state,
          presence_intervals: [
            ...state.presence_intervals,
            {
              ...request.payload,
              id: createId("presence"),
              created_at: timestamp,
              updated_at: timestamp
            }
          ]
        })
      };
    }

    case "deletePresenceInterval": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deletePresenceIntervalFromState(state, request.payload.id))
      };
    }

    case "addManualCorrection": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation({
          ...state,
          manual_corrections: [
            ...state.manual_corrections,
            {
              ...request.payload,
              id: createId("correction"),
              created_at: nowIso()
            }
          ]
        })
      };
    }

    case "deleteManualCorrection": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deleteManualCorrectionFromState(state, request.payload.id))
      };
    }

    case "addTaxYearProfile": {
      const state = await getState();
      const timestamp = nowIso();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation({
          ...state,
          tax_year_profiles: [
            ...state.tax_year_profiles,
            {
              ...request.payload,
              id: createId("profile"),
              created_at: timestamp,
              updated_at: timestamp
            }
          ]
        })
      };
    }

    case "deleteTaxYearProfile": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deleteTaxYearProfileFromState(state, request.payload.id))
      };
    }

    case "importDocument":
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await addDocument(await getState(), request.payload)
      };

    case "deleteDocument": {
      const state = await getState();
      const document = state.documents.find((item) => item.id === request.payload.id);
      if (!document) {
        throw new Error(`Document not found: ${request.payload.id}`);
      }
      await deleteAttachmentBlob(document.local_storage_backend, document.local_storage_key);
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deleteDocumentFromState(state, request.payload.id))
      };
    }

    case "deleteDocumentLink": {
      const state = await getState();
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation(deleteDocumentLinkFromState(state, request.payload.id))
      };
    }

    case "computeLedger": {
      const state = await getState();
      const profile = findProfile(state, request.payload.profileId);
      return {
        id: request.id,
        ok: true,
        type: "ledger",
        payload: computeDayLedger(
          state,
          profile,
          request.payload.startYear,
          request.payload.countryCode
        )
      };
    }

    case "createSnapshot": {
      const state = await getState();
      const profile = findProfile(state, request.payload.profileId);
      const ledger = computeDayLedger(
        state,
        profile,
        request.payload.startYear,
        request.payload.countryCode
      );
      const snapshot: DayCountSnapshot = await createDayCountSnapshot(ledger);
      return {
        id: request.id,
        ok: true,
        type: "state",
        payload: await persistMutation({
          ...state,
          day_count_snapshots: [...state.day_count_snapshots, snapshot]
        })
      };
    }

    case "exportPackage": {
      const state = await getState();
      const profile = findProfile(state, request.payload.profileId);
      return {
        id: request.id,
        ok: true,
        type: "exportPackage",
        payload: await createExportPackage(
          state,
          profile,
          request.payload.countryCode,
          request.payload.startYear
        )
      };
    }

    case "markUploadSuccess": {
      const state = await getState();
      const timestamp = nowIso();
      const next: AppState = {
        ...state,
        remote_generation: request.payload.remoteGeneration,
        remote_head_etag: request.payload.remoteHeadEtag,
        upload_status: "saved_to_s3",
        last_uploaded_at: timestamp,
        last_error: undefined,
        documents: state.documents.map((document) => ({
          ...document,
          upload_status: "saved_to_s3",
          updated_at: timestamp
        }))
      };
      statePromise = Promise.resolve(next);
      sqliteCachePromise ??= SqliteWorkingCache.open();
      const sqliteCache = await sqliteCachePromise;
      sqliteCache?.saveState(next);
      await saveAppState(next);
      return { id: request.id, ok: true, type: "state", payload: next };
    }

    case "markUploading": {
      const state = await getState();
      const timestamp = nowIso();
      const next: AppState = {
        ...state,
        upload_status: "uploading",
        last_error: undefined,
        documents: state.documents.map((document) => ({
          ...document,
          upload_status:
            document.upload_status === "saved_to_s3" ? "saved_to_s3" : "uploading",
          updated_at: timestamp
        }))
      };
      statePromise = Promise.resolve(next);
      sqliteCachePromise ??= SqliteWorkingCache.open();
      const sqliteCache = await sqliteCachePromise;
      sqliteCache?.saveState(next);
      await saveAppState(next);
      return { id: request.id, ok: true, type: "state", payload: next };
    }

    case "markUploadError": {
      const state = await getState();
      const timestamp = nowIso();
      const next: AppState = {
        ...state,
        upload_status: "upload_error",
        last_error: request.payload.error,
        documents: state.documents.map((document) => ({
          ...document,
          upload_status:
            document.upload_status === "saved_to_s3" ? "saved_to_s3" : "upload_error",
          updated_at: timestamp
        }))
      };
      statePromise = Promise.resolve(next);
      sqliteCachePromise ??= SqliteWorkingCache.open();
      const sqliteCache = await sqliteCachePromise;
      sqliteCache?.saveState(next);
      await saveAppState(next);
      return { id: request.id, ok: true, type: "state", payload: next };
    }

    case "restoreState": {
      const next: AppState = {
        ...request.payload.state,
        remote_head_etag: request.payload.remoteHeadEtag,
        upload_status: "saved_to_s3",
        last_saved_at: nowIso()
      };
      const restored = await replaceAppState(next);
      statePromise = Promise.resolve(restored);
      sqliteCachePromise ??= SqliteWorkingCache.open();
      const sqliteCache = await sqliteCachePromise;
      sqliteCache?.saveState(restored);
      return { id: request.id, ok: true, type: "state", payload: restored };
    }
  }
};

self.onmessage = (event: MessageEvent<DataWorkerRequest>) => {
  void (async () => {
    try {
      const response = await handleRequest(event.data);
      self.postMessage(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ id: event.data.id, ok: false, error: message });
    }
  })();
};
