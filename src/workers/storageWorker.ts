/// <reference lib="webworker" />

import { sha256Hex, stableStringify } from "../domain/hash";
import {
  validateAppState,
  validateAttachmentManifestEntries,
  validateStorageHead,
  validateStorageManifest
} from "../domain/schema";
import type { StorageHead } from "../domain/types";
import { getAttachmentBlob, storeAttachmentBlob } from "../storage/attachments";
import { DirectS3Client, objectKeyForSha256 } from "../storage/s3Client";
import { createStateSnapshot, createStorageManifest } from "../storage/snapshot";
import type {
  RemoteHeadResult,
  RestoreFromS3Result,
  StorageWorkerRequest,
  StorageWorkerResponse,
  UploadToS3Result
} from "./storageWorkerProtocol";

export const uploadToS3 = async (
  payload: Extract<StorageWorkerRequest, { type: "uploadToS3" }>["payload"]
): Promise<UploadToS3Result> => {
  const client = new DirectS3Client(payload.settings);
  const state = {
    ...payload.state,
    local_generation: Math.max(1, payload.state.local_generation)
  };
  const snapshot = await createStateSnapshot(state);
  const generation = state.local_generation;
  const snapshotKey = `state/json/${generation}.json`;
  const manifestKey = `state/manifests/${generation}.json`;
  const existingHead = await client.headObject("state/head.json");
  if (!payload.expectedHeadEtag && existingHead && !payload.forceOverwrite) {
    throw new Error("Remote S3 head already exists. Restore it or explicitly overwrite.");
  }

  const uploadedAttachments: Array<{ key: string; sha256: string; size: number }> = [];
  for (const document of state.documents) {
    const blob = await getAttachmentBlob(
      document.local_storage_backend,
      document.local_storage_key
    );
    if (!blob) {
      if (document.upload_status === "saved_to_s3" && document.remote_object_key) {
        uploadedAttachments.push({
          key: document.remote_object_key,
          sha256: document.sha256,
          size: document.size_bytes
        });
        continue;
      }
      throw new Error(`Missing local attachment blob for ${document.title}.`);
    }
    const objectKey = objectKeyForSha256(document.sha256);
    const existing = await client.headObject(objectKey);
    if (!existing) {
      await client.putObject(objectKey, blob, {
        contentType: document.mime_type,
        ifNoneMatch: "*"
      });
    }
    uploadedAttachments.push({
      key: objectKey,
      sha256: document.sha256,
      size: document.size_bytes
    });
  }

  await client.putObject(snapshotKey, snapshot.bytes, {
    contentType: "application/json"
  });

  const manifest = createStorageManifest(state, snapshotKey, uploadedAttachments);
  await client.putObject(manifestKey, stableStringify(manifest), {
    contentType: "application/json"
  });

  const head: StorageHead = {
    device_id: state.device_id,
    generation,
    previous_generation: state.remote_generation,
    schema_version: state.schema_version,
    snapshot_key: snapshotKey,
    manifest_key: manifestKey,
    content_hash: snapshot.hash,
    updated_at: new Date().toISOString()
  };

  const putOptions = payload.forceOverwrite
    ? { contentType: "application/json" }
    : payload.expectedHeadEtag
      ? { contentType: "application/json", ifMatch: payload.expectedHeadEtag }
      : { contentType: "application/json", ifNoneMatch: "*" };
  const savedHead = await client.putObject("state/head.json", stableStringify(head), putOptions);

  return {
    head,
    headEtag: savedHead.etag,
    uploadedAttachmentCount: uploadedAttachments.length,
    snapshotKey,
    manifestKey
  };
};

export const restoreFromS3 = async (
  payload: Extract<StorageWorkerRequest, { type: "restoreFromS3" }>["payload"]
): Promise<RestoreFromS3Result> => {
  const client = new DirectS3Client(payload.settings);
  const { value: rawHead, head: headObject } = await client.getJson<StorageHead>(
    "state/head.json"
  );
  const head = validateStorageHead(rawHead);
  const { value: rawManifest } = await client.getJson(head.manifest_key);
  const manifest = validateStorageManifest(rawManifest);
  if (manifest.database_snapshot_key !== head.snapshot_key) {
    throw new Error("S3 manifest snapshot key does not match head snapshot key.");
  }
  if (manifest.local_generation !== head.generation) {
    throw new Error("S3 manifest generation does not match head generation.");
  }
  const manifestAttachments = validateAttachmentManifestEntries(
    JSON.parse(manifest.attachment_entries_json)
  );
  const manifestAttachmentMap = new Map(
    manifestAttachments.map((entry) => [entry.sha256, entry])
  );
  const snapshotBytes = await client.getObject(head.snapshot_key);
  const snapshotHash = await sha256Hex(new Uint8Array(snapshotBytes).buffer);
  if (snapshotHash !== head.content_hash) {
    throw new Error("Restored S3 snapshot hash mismatch.");
  }
  const state = validateAppState(JSON.parse(new TextDecoder().decode(snapshotBytes)));
  let restoredAttachmentCount = 0;
  const restoredDocuments = [];

  for (const document of state.documents) {
    const manifestEntry = manifestAttachmentMap.get(document.sha256);
    if (!manifestEntry) {
      throw new Error(`S3 manifest is missing attachment ${document.sha256}.`);
    }
    const remoteKey = manifestEntry.key;
    const bytes = await client.getObject(remoteKey);
    if (bytes.byteLength !== manifestEntry.size) {
      throw new Error(`Restored attachment size mismatch for ${document.title}.`);
    }
    const hash = await sha256Hex(new Uint8Array(bytes).buffer);
    if (hash !== document.sha256) {
      throw new Error(`Restored attachment hash mismatch for ${document.title}.`);
    }
    const location = await storeAttachmentBlob(
      new Blob([new Uint8Array(bytes).buffer], { type: document.mime_type }),
      document.sha256
    );
    restoredDocuments.push({
      ...document,
      local_storage_backend: location.backend,
      local_storage_key: location.key,
      upload_status: "saved_to_s3" as const,
      verification_status: document.verification_status
    });
    restoredAttachmentCount += 1;
  }

  return {
    state: {
      ...state,
      remote_generation: head.generation,
      remote_head_etag: headObject.etag,
      upload_status: "saved_to_s3",
      last_uploaded_at: head.updated_at,
      documents: restoredDocuments
    },
    head,
    headEtag: headObject.etag,
    restoredAttachmentCount
  };
};

export const getRemoteHead = async (
  payload: Extract<StorageWorkerRequest, { type: "getRemoteHead" }>["payload"]
): Promise<RemoteHeadResult> => {
  const client = new DirectS3Client(payload.settings);
  const headObject = await client.headObject("state/head.json");
  if (!headObject) {
    return {};
  }
  const { value: rawHead, head: fetchedHeadObject } = await client.getJson<StorageHead>(
    "state/head.json"
  );
  return {
    head: validateStorageHead(rawHead),
    headEtag: fetchedHeadObject.etag ?? headObject.etag
  };
};

const handleRequest = async (
  request: StorageWorkerRequest
): Promise<StorageWorkerResponse> => {
  switch (request.type) {
    case "uploadToS3":
      return {
        id: request.id,
        ok: true,
        type: "uploadToS3",
        payload: await uploadToS3(request.payload)
      };
    case "restoreFromS3":
      return {
        id: request.id,
        ok: true,
        type: "restoreFromS3",
        payload: await restoreFromS3(request.payload)
      };
    case "getRemoteHead":
      return {
        id: request.id,
        ok: true,
        type: "getRemoteHead",
        payload: await getRemoteHead(request.payload)
      };
  }
};

self.onmessage = (event: MessageEvent<StorageWorkerRequest>) => {
  void (async () => {
    try {
      self.postMessage(await handleRequest(event.data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ id: event.data.id, ok: false, error: message });
    }
  })();
};
