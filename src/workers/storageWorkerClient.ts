import type {
  StorageWorkerRequest,
  StorageWorkerResponse,
  UploadToS3Payload,
  UploadToS3Result
} from "./storageWorkerProtocol";

type PendingRequest = {
  resolve: (value: StorageWorkerResponse) => void;
  reject: (reason?: unknown) => void;
};

export class StorageWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(worker = new Worker(new URL("./storageWorker.ts", import.meta.url), { type: "module" })) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<StorageWorkerResponse>) => {
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

  async uploadToS3(payload: UploadToS3Payload): Promise<UploadToS3Result> {
    const response = await this.request({ id: "", type: "uploadToS3", payload });
    if (response.ok && response.type === "uploadToS3") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  async restoreFromS3(
    payload: Extract<StorageWorkerRequest, { type: "restoreFromS3" }>["payload"]
  ) {
    const response = await this.request({ id: "", type: "restoreFromS3", payload });
    if (response.ok && response.type === "restoreFromS3") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  async getRemoteHead(
    payload: Extract<StorageWorkerRequest, { type: "getRemoteHead" }>["payload"]
  ) {
    const response = await this.request({ id: "", type: "getRemoteHead", payload });
    if (response.ok && response.type === "getRemoteHead") {
      return response.payload;
    }
    throw new Error(response.ok ? "Unexpected worker response." : response.error);
  }

  private request(request: StorageWorkerRequest): Promise<StorageWorkerResponse> {
    const id = crypto.randomUUID();
    const message = { ...request, id } as StorageWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message);
    });
  }
}
