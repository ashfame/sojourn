import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectS3Client, objectKeyForSha256 } from "../../src/storage/s3Client";
import type { DirectS3Settings } from "../../src/domain/types";

const settings: DirectS3Settings = {
  endpoint: "https://s3.example.test",
  bucket: "tax-data",
  region: "us-east-1",
  prefix: "residency-days",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret",
  forcePathStyle: true
};

describe("DirectS3Client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds content-addressed attachment keys", () => {
    expect(objectKeyForSha256("abcdef123456")).toBe("attachments/sha256/ab/abcdef123456");
  });

  it("signs and uploads objects with SigV4 headers", async () => {
    const fetchMock = vi.fn(() => {
      return new Response("", {
        status: 200,
        headers: {
          etag: '"etag-1"'
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new DirectS3Client(settings).putObject(
      "state/head.json",
      '{"ok":true}',
      { contentType: "application/json", ifMatch: "old-etag" }
    );

    expect(result.etag).toBe("etag-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://s3.example.test/tax-data/residency-days/state/head.json"
    );
    expect(init.method).toBe("PUT");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    expect(headers.get("x-amz-content-sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(headers.get("if-match")).toBe('"old-etag"');
  });

  it("returns undefined for missing HEAD objects", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("", { status: 404 })));

    await expect(new DirectS3Client(settings).headObject("state/head.json")).resolves.toBe(
      undefined
    );
  });
});
