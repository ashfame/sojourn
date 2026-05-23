import type {
  AppState,
  ComputedDayLedger,
  LinkableEntityType,
  ManualCorrection,
  PresenceInterval,
  ResidencyDocument,
  StayEvent,
  StorageCapabilityReport,
  TaxYearProfile,
  TravelEvent
} from "../domain/types";

export interface ImportDocumentPayload {
  title: string;
  kind: ResidencyDocument["kind"];
  mime_type: string;
  capture_date?: string | undefined;
  bytes: ArrayBuffer;
  link?: {
    entity_type: LinkableEntityType;
    entity_id: string;
    relationship: string;
  } | undefined;
}

export interface ComputeLedgerPayload {
  profileId: string;
  countryCode: string;
  startYear: number;
}

export type DataWorkerRequest =
  | { id: string; type: "init" }
  | { id: string; type: "getState" }
  | { id: string; type: "reset" }
  | { id: string; type: "detectCapabilities" }
  | { id: string; type: "requestPersistentStorage" }
  | { id: string; type: "addTravelEvent"; payload: Omit<TravelEvent, "id" | "created_at" | "updated_at"> }
  | { id: string; type: "deleteTravelEvent"; payload: { id: string } }
  | { id: string; type: "addStayEvent"; payload: Omit<StayEvent, "id" | "created_at" | "updated_at"> }
  | { id: string; type: "deleteStayEvent"; payload: { id: string } }
  | {
      id: string;
      type: "addPresenceInterval";
      payload: Omit<PresenceInterval, "id" | "created_at" | "updated_at">;
    }
  | { id: string; type: "deletePresenceInterval"; payload: { id: string } }
  | {
      id: string;
      type: "addManualCorrection";
      payload: Omit<ManualCorrection, "id" | "created_at">;
    }
  | { id: string; type: "deleteManualCorrection"; payload: { id: string } }
  | {
      id: string;
      type: "addTaxYearProfile";
      payload: Omit<TaxYearProfile, "id" | "created_at" | "updated_at">;
    }
  | { id: string; type: "deleteTaxYearProfile"; payload: { id: string } }
  | { id: string; type: "importDocument"; payload: ImportDocumentPayload }
  | { id: string; type: "deleteDocument"; payload: { id: string } }
  | { id: string; type: "deleteDocumentLink"; payload: { id: string } }
  | { id: string; type: "computeLedger"; payload: ComputeLedgerPayload }
  | { id: string; type: "createSnapshot"; payload: ComputeLedgerPayload }
  | { id: string; type: "exportPackage"; payload: ComputeLedgerPayload }
  | { id: string; type: "markUploading" }
  | {
      id: string;
      type: "markUploadSuccess";
      payload: { remoteGeneration: number; remoteHeadEtag?: string | undefined };
    }
  | { id: string; type: "markUploadError"; payload: { error: string } }
  | {
      id: string;
      type: "restoreState";
      payload: { state: AppState; remoteHeadEtag?: string | undefined };
    };

export type DataWorkerResponse =
  | { id: string; ok: true; type: "state"; payload: AppState }
  | { id: string; ok: true; type: "ledger"; payload: ComputedDayLedger }
  | { id: string; ok: true; type: "capabilities"; payload: StorageCapabilityReport }
  | { id: string; ok: true; type: "persistentStorage"; payload: boolean }
  | { id: string; ok: true; type: "exportPackage"; payload: Uint8Array }
  | { id: string; ok: false; error: string };
