import type {
  ComputeLedgerPayload,
  DataWorkerRequest,
  DataWorkerResponse,
  ImportDocumentPayload
} from "./dataWorkerProtocol";
import type {
  AppState,
  ComputedDayLedger,
  ManualCorrection,
  PresenceInterval,
  StayEvent,
  StorageCapabilityReport,
  TaxYearProfile,
  TravelEvent
} from "../domain/types";

type PendingRequest = {
  resolve: (value: DataWorkerResponse) => void;
  reject: (reason?: unknown) => void;
};

export class DataWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(worker = new Worker(new URL("./dataWorker.ts", import.meta.url), { type: "module" })) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<DataWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) {
        return;
      }
      this.pending.delete(event.data.id);
      pending.resolve(event.data);
    };
    this.worker.onerror = (event) => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(event.message));
      }
      this.pending.clear();
    };
  }

  dispose(): void {
    this.worker.terminate();
  }

  init(): Promise<AppState> {
    return this.stateRequest({ id: "", type: "init" });
  }

  getState(): Promise<AppState> {
    return this.stateRequest({ id: "", type: "getState" });
  }

  reset(): Promise<AppState> {
    return this.stateRequest({ id: "", type: "reset" });
  }

  addTravelEvent(
    payload: Omit<TravelEvent, "id" | "created_at" | "updated_at">
  ): Promise<AppState> {
    return this.stateRequest({ id: "", type: "addTravelEvent", payload });
  }

  deleteTravelEvent(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deleteTravelEvent", payload: { id } });
  }

  addStayEvent(payload: Omit<StayEvent, "id" | "created_at" | "updated_at">): Promise<AppState> {
    return this.stateRequest({ id: "", type: "addStayEvent", payload });
  }

  deleteStayEvent(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deleteStayEvent", payload: { id } });
  }

  addPresenceInterval(
    payload: Omit<PresenceInterval, "id" | "created_at" | "updated_at">
  ): Promise<AppState> {
    return this.stateRequest({ id: "", type: "addPresenceInterval", payload });
  }

  deletePresenceInterval(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deletePresenceInterval", payload: { id } });
  }

  addManualCorrection(payload: Omit<ManualCorrection, "id" | "created_at">): Promise<AppState> {
    return this.stateRequest({ id: "", type: "addManualCorrection", payload });
  }

  deleteManualCorrection(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deleteManualCorrection", payload: { id } });
  }

  addTaxYearProfile(
    payload: Omit<TaxYearProfile, "id" | "created_at" | "updated_at">
  ): Promise<AppState> {
    return this.stateRequest({ id: "", type: "addTaxYearProfile", payload });
  }

  deleteTaxYearProfile(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deleteTaxYearProfile", payload: { id } });
  }

  importDocument(payload: ImportDocumentPayload): Promise<AppState> {
    return this.stateRequest({ id: "", type: "importDocument", payload }, [payload.bytes]);
  }

  deleteDocument(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deleteDocument", payload: { id } });
  }

  deleteDocumentLink(id: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "deleteDocumentLink", payload: { id } });
  }

  async computeLedger(payload: ComputeLedgerPayload): Promise<ComputedDayLedger> {
    const response = await this.request({ id: "", type: "computeLedger", payload });
    if (response.ok && response.type === "ledger") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  createSnapshot(payload: ComputeLedgerPayload): Promise<AppState> {
    return this.stateRequest({ id: "", type: "createSnapshot", payload });
  }

  async exportPackage(payload: ComputeLedgerPayload): Promise<Uint8Array> {
    const response = await this.request({ id: "", type: "exportPackage", payload });
    if (response.ok && response.type === "exportPackage") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  markUploadSuccess(payload: {
    remoteGeneration: number;
    remoteHeadEtag?: string | undefined;
  }): Promise<AppState> {
    return this.stateRequest({ id: "", type: "markUploadSuccess", payload });
  }

  markUploading(): Promise<AppState> {
    return this.stateRequest({ id: "", type: "markUploading" });
  }

  markUploadError(error: string): Promise<AppState> {
    return this.stateRequest({ id: "", type: "markUploadError", payload: { error } });
  }

  restoreState(payload: {
    state: AppState;
    remoteHeadEtag?: string | undefined;
  }): Promise<AppState> {
    return this.stateRequest({ id: "", type: "restoreState", payload });
  }

  async detectCapabilities(): Promise<StorageCapabilityReport> {
    const response = await this.request({ id: "", type: "detectCapabilities" });
    if (response.ok && response.type === "capabilities") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  async requestPersistentStorage(): Promise<boolean> {
    const response = await this.request({ id: "", type: "requestPersistentStorage" });
    if (response.ok && response.type === "persistentStorage") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  private async stateRequest(
    request: DataWorkerRequest,
    transfer?: Transferable[]
  ): Promise<AppState> {
    const response = await this.request(request, transfer);
    if (response.ok && response.type === "state") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  private request(
    request: DataWorkerRequest,
    transfer: Transferable[] = []
  ): Promise<DataWorkerResponse> {
    const id = crypto.randomUUID();
    const message = { ...request, id } as DataWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }
}
