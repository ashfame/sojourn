import type { AppState, DirectS3Settings, StorageHead } from "../domain/types";

export interface UploadToS3Payload {
  state: AppState;
  settings: DirectS3Settings;
  expectedHeadEtag?: string | undefined;
  forceOverwrite?: boolean | undefined;
}

export interface UploadToS3Result {
  head: StorageHead;
  headEtag?: string | undefined;
  uploadedAttachmentCount: number;
  snapshotKey: string;
  manifestKey: string;
}

export interface RestoreFromS3Payload {
  settings: DirectS3Settings;
}

export interface RestoreFromS3Result {
  state: AppState;
  head: StorageHead;
  headEtag?: string | undefined;
  restoredAttachmentCount: number;
}

export interface RemoteHeadResult {
  head?: StorageHead | undefined;
  headEtag?: string | undefined;
}

export type StorageWorkerRequest =
  | {
      id: string;
      type: "uploadToS3";
      payload: UploadToS3Payload;
    }
  | {
      id: string;
      type: "restoreFromS3";
      payload: RestoreFromS3Payload;
    }
  | {
      id: string;
      type: "getRemoteHead";
      payload: RestoreFromS3Payload;
    };

export type StorageWorkerResponse =
  | { id: string; ok: true; type: "uploadToS3"; payload: UploadToS3Result }
  | { id: string; ok: true; type: "restoreFromS3"; payload: RestoreFromS3Result }
  | { id: string; ok: true; type: "getRemoteHead"; payload: RemoteHeadResult }
  | { id: string; ok: false; error: string };
