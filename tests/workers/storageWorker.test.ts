import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialAppState } from "../../src/domain/defaults";
import { sha256Hex } from "../../src/domain/hash";
import type { DirectS3Settings } from "../../src/domain/types";
import { getRemoteHead, restoreFromS3, uploadToS3 } from "../../src/workers/storageWorker";

const settings: DirectS3Settings = {
  endpoint: "https://s3.example.test",
  bucket: "tax-data",
  region: "us-east-1",
  prefix: "residency-days",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret",
  forcePathStyle: true
};

const manifestJson = (
  snapshotKey: string,
  generation: number,
  attachments: Array<{ key: string; sha256: string; size: number }> = []
): string =>
  JSON.stringify({
    id: "manifest",
    device_id: "device",
    manifest_version: 1,
    local_generation: generation,
    database_snapshot_key: snapshotKey,
    attachment_entries_json: JSON.stringify(attachments),
    created_at: "2026-05-22T00:00:00Z",
    uploaded_at: "2026-05-22T00:00:00Z",
    upload_status: "saved_to_s3"
  });

describe("storage worker direct S3 persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not overwrite an existing remote head without an expected ETag", async () => {
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        return new Response("", { status: 200, headers: { etag: '"written"' } });
      }
      if (method === "HEAD" && String(url).endsWith("/state/head.json")) {
        return new Response("", { status: 200, headers: { etag: '"remote-head"' } });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = createInitialAppState();
    state.local_generation = 1;

    await expect(uploadToS3({ state, settings })).rejects.toThrow(
      "Remote S3 head already exists"
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").length
    ).toBe(0);
  });

  it("can explicitly overwrite an existing remote head", async () => {
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "HEAD" && String(url).endsWith("/state/head.json")) {
        return new Response("", { status: 200, headers: { etag: '"remote-head"' } });
      }
      if (method === "PUT") {
        return new Response("", { status: 200, headers: { etag: '"written"' } });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = createInitialAppState();
    state.local_generation = 1;

    const result = await uploadToS3({ state, settings, forceOverwrite: true });

    expect(result.headEtag).toBe("written");
    const headPut = fetchMock.mock.calls.find(([url, init]) => {
      return init?.method === "PUT" && String(url).endsWith("/state/head.json");
    });
    expect(headPut).toBeDefined();
    const headers = headPut?.[1]?.headers as Headers;
    expect(headers.get("if-match")).toBeNull();
    expect(headers.get("if-none-match")).toBeNull();
  });

  it("uses the expected ETag when updating a known remote head", async () => {
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "HEAD" && String(url).endsWith("/state/head.json")) {
        return new Response("", { status: 200, headers: { etag: '"remote-head"' } });
      }
      if (method === "PUT") {
        return new Response("", { status: 200, headers: { etag: '"written"' } });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = createInitialAppState();
    state.local_generation = 1;

    await uploadToS3({ state, settings, expectedHeadEtag: "remote-head" });

    const headPut = fetchMock.mock.calls.find(([url, init]) => {
      return init?.method === "PUT" && String(url).endsWith("/state/head.json");
    });
    const headers = headPut?.[1]?.headers as Headers;
    expect(headers.get("if-match")).toBe('"remote-head"');
  });

  it("does not upload a snapshot when a pending document blob is missing locally", async () => {
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "HEAD" && String(url).endsWith("/state/head.json")) {
        return new Response("", { status: 404 });
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = createInitialAppState();
    state.local_generation = 1;
    state.documents.push({
      id: "document_missing",
      title: "Missing local document",
      kind: "ticket",
      mime_type: "text/plain",
      size_bytes: 3,
      sha256: "1".repeat(64),
      local_storage_backend: "indexeddb",
      local_storage_key: "attachments/missing",
      upload_status: "pending",
      verification_status: "verified",
      created_at: "2026-05-22T00:00:00Z",
      updated_at: "2026-05-22T00:00:00Z"
    });

    await expect(uploadToS3({ state, settings })).rejects.toThrow(
      "Missing local attachment blob"
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").length
    ).toBe(0);
  });

  it("reads remote head metadata without restoring the snapshot", async () => {
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "HEAD" && String(url).endsWith("/state/head.json")) {
        return new Response("", { status: 200, headers: { etag: '"remote-head"' } });
      }
      if (method === "GET" && String(url).endsWith("/state/head.json")) {
        return new Response(
          JSON.stringify({
            device_id: "device",
            generation: 7,
            schema_version: 1,
            snapshot_key: "state/json/7.json",
            manifest_key: "state/manifests/7.json",
            content_hash: "a".repeat(64),
            updated_at: "2026-05-22T00:00:00Z"
          }),
          { status: 200, headers: { etag: '"remote-head"' } }
        );
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRemoteHead({ settings })).resolves.toMatchObject({
      head: { generation: 7 },
      headEtag: "remote-head"
    });
  });

  it("rejects restore when an attachment hash does not match metadata", async () => {
    const state = createInitialAppState();
    state.documents.push({
      id: "document_bad",
      title: "Bad document",
      kind: "ticket",
      mime_type: "text/plain",
      size_bytes: 3,
      sha256: "0".repeat(64),
      local_storage_backend: "indexeddb",
      local_storage_key: "attachments/bad",
      remote_object_key: "attachments/sha256/00/bad",
      upload_status: "saved_to_s3",
      verification_status: "verified",
      created_at: "2026-05-22T00:00:00Z",
      updated_at: "2026-05-22T00:00:00Z"
    });
    const snapshotJson = JSON.stringify(state);
    const snapshotHash = await sha256Hex(snapshotJson);
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const href = String(url);
      if (method === "GET" && href.endsWith("/state/head.json")) {
        return new Response(
          JSON.stringify({
            device_id: "device",
            generation: 1,
            schema_version: 1,
            snapshot_key: "state/json/1.json",
            manifest_key: "state/manifests/1.json",
            content_hash: snapshotHash,
            updated_at: "2026-05-22T00:00:00Z"
          }),
          { status: 200, headers: { etag: '"head"' } }
        );
      }
      if (method === "GET" && href.endsWith("/state/manifests/1.json")) {
        return new Response(
          manifestJson("state/json/1.json", 1, [
            {
              key: "attachments/sha256/00/bad",
              sha256: "0".repeat(64),
              size: 3
            }
          ]),
          { status: 200 }
        );
      }
      if (method === "GET" && href.endsWith("/state/json/1.json")) {
        return new Response(JSON.stringify(state), { status: 200 });
      }
      if (method === "GET" && href.endsWith("/attachments/sha256/00/bad")) {
        return new Response("bad", { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(restoreFromS3({ settings })).rejects.toThrow("hash mismatch");
  });

  it("rejects restore when the snapshot hash differs from the S3 head", async () => {
    const state = createInitialAppState();
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const href = String(url);
      if (method === "GET" && href.endsWith("/state/head.json")) {
        return new Response(
          JSON.stringify({
            device_id: "device",
            generation: 1,
            schema_version: 1,
            snapshot_key: "state/json/1.json",
            manifest_key: "state/manifests/1.json",
            content_hash: "0".repeat(64),
            updated_at: "2026-05-22T00:00:00Z"
          }),
          { status: 200, headers: { etag: '"head"' } }
        );
      }
      if (method === "GET" && href.endsWith("/state/manifests/1.json")) {
        return new Response(manifestJson("state/json/1.json", 1), { status: 200 });
      }
      if (method === "GET" && href.endsWith("/state/json/1.json")) {
        return new Response(JSON.stringify(state), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(restoreFromS3({ settings })).rejects.toThrow("snapshot hash mismatch");
  });

  it("rejects restore when the manifest points at a different snapshot", async () => {
    const state = createInitialAppState();
    const snapshotJson = JSON.stringify(state);
    const snapshotHash = await sha256Hex(snapshotJson);
    const fetchMock = vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const href = String(url);
      if (method === "GET" && href.endsWith("/state/head.json")) {
        return new Response(
          JSON.stringify({
            device_id: "device",
            generation: 1,
            schema_version: 1,
            snapshot_key: "state/json/1.json",
            manifest_key: "state/manifests/1.json",
            content_hash: snapshotHash,
            updated_at: "2026-05-22T00:00:00Z"
          }),
          { status: 200, headers: { etag: '"head"' } }
        );
      }
      if (method === "GET" && href.endsWith("/state/manifests/1.json")) {
        return new Response(manifestJson("state/json/2.json", 1), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(restoreFromS3({ settings })).rejects.toThrow(
      "manifest snapshot key does not match"
    );
  });
});
