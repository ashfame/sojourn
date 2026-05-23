import type { DirectS3Settings } from "../domain/types";

type HeaderRecord = Record<string, string>;

export interface PutObjectOptions {
  contentType?: string;
  ifMatch?: string;
  ifNoneMatch?: string;
}

export interface ObjectHead {
  etag?: string | undefined;
  versionId?: string | undefined;
  contentLength?: number | undefined;
}

const encoder = new TextEncoder();
const emptyHash =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (bytes: Uint8Array | string): Promise<string> => {
  const data: Uint8Array<ArrayBuffer> =
    typeof bytes === "string" ? encoder.encode(bytes) : new Uint8Array(bytes);
  return toHex(await crypto.subtle.digest("SHA-256", data.buffer));
};

const hmac = async (key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> => {
  const keyBytes: ArrayBuffer = key instanceof Uint8Array ? new Uint8Array(key).buffer : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
};

const hmacHex = async (key: ArrayBuffer | Uint8Array, message: string): Promise<string> =>
  toHex(await hmac(key, message));

const getSigningKey = async (
  secretAccessKey: string,
  dateStamp: string,
  region: string
): Promise<ArrayBuffer> => {
  const dateKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

const amzTimestamp = (date = new Date()): { amzDate: string; dateStamp: string } => {
  const iso = date.toISOString().replaceAll("-", "").replaceAll(":", "");
  return {
    amzDate: `${iso.slice(0, 15)}Z`,
    dateStamp: iso.slice(0, 8)
  };
};

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join("/");

const normalizePrefix = (prefix: string): string =>
  prefix
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

const normalizeKey = (prefix: string, key: string): string => {
  const cleanPrefix = normalizePrefix(prefix);
  const cleanKey = key.replace(/^\/+/g, "");
  return cleanPrefix ? `${cleanPrefix}/${cleanKey}` : cleanKey;
};

const trimEtag = (etag: string | null): string | undefined =>
  etag ? etag.replace(/^"|"$/g, "") : undefined;

export class DirectS3Client {
  private readonly settings: DirectS3Settings;

  constructor(settings: DirectS3Settings) {
    this.settings = settings;
  }

  async putObject(
    key: string,
    body: Uint8Array | string | Blob,
    options: PutObjectOptions = {}
  ): Promise<ObjectHead> {
    const bytes =
      typeof body === "string"
        ? encoder.encode(body)
        : body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : body;
    const headers: HeaderRecord = {
      "content-type": options.contentType ?? "application/octet-stream"
    };
    if (options.ifMatch) {
      headers["if-match"] = `"${options.ifMatch.replace(/^"|"$/g, "")}"`;
    }
    if (options.ifNoneMatch) {
      headers["if-none-match"] = options.ifNoneMatch;
    }

    const response = await this.signedFetch("PUT", key, bytes, headers);
    if (!response.ok) {
      throw new Error(`S3 PUT ${key} failed with ${response.status}: ${await response.text()}`);
    }
    return {
      etag: trimEtag(response.headers.get("etag")),
      versionId: response.headers.get("x-amz-version-id") ?? undefined,
      contentLength: bytes.byteLength
    };
  }

  async getObject(key: string): Promise<Uint8Array> {
    const response = await this.signedFetch("GET", key, undefined, {});
    if (!response.ok) {
      throw new Error(`S3 GET ${key} failed with ${response.status}: ${await response.text()}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async getJson<T>(key: string): Promise<{ value: T; head: ObjectHead }> {
    const response = await this.signedFetch("GET", key, undefined, {});
    if (!response.ok) {
      throw new Error(`S3 GET ${key} failed with ${response.status}: ${await response.text()}`);
    }
    return {
      value: (await response.json()) as T,
      head: {
        etag: trimEtag(response.headers.get("etag")),
        versionId: response.headers.get("x-amz-version-id") ?? undefined,
        contentLength: Number(response.headers.get("content-length") ?? 0)
      }
    };
  }

  async headObject(key: string): Promise<ObjectHead | undefined> {
    const response = await this.signedFetch("HEAD", key, undefined, {});
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`S3 HEAD ${key} failed with ${response.status}: ${await response.text()}`);
    }
    return {
      etag: trimEtag(response.headers.get("etag")),
      versionId: response.headers.get("x-amz-version-id") ?? undefined,
      contentLength: Number(response.headers.get("content-length") ?? 0)
    };
  }

  private objectUrl(key: string): URL {
    const endpoint = this.settings.endpoint.replace(/\/+$/g, "");
    const objectKey = normalizeKey(this.settings.prefix, key);
    if (this.settings.forcePathStyle) {
      return new URL(
        `${endpoint}/${encodePath(this.settings.bucket)}/${encodePath(objectKey)}`
      );
    }

    const url = new URL(endpoint);
    url.hostname = `${this.settings.bucket}.${url.hostname}`;
    url.pathname = `/${encodePath(objectKey)}`;
    return url;
  }

  private async signedFetch(
    method: "GET" | "HEAD" | "PUT",
    key: string,
    body: Uint8Array | undefined,
    requestHeaders: HeaderRecord
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const { amzDate, dateStamp } = amzTimestamp();
    const payloadHash = body ? await sha256(body) : emptyHash;

    const headers: HeaderRecord = {
      ...Object.fromEntries(
        Object.entries(requestHeaders).map(([header, value]) => [
          header.toLowerCase(),
          value.trim()
        ])
      ),
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    };
    if (this.settings.sessionToken) {
      headers["x-amz-security-token"] = this.settings.sessionToken;
    }

    const sortedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaders
      .map((header) => `${header}:${headers[header]}`)
      .join("\n");
    const signedHeaders = sortedHeaders.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      `${canonicalHeaders}\n`,
      signedHeaders,
      payloadHash
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.settings.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await sha256(canonicalRequest)
    ].join("\n");
    const signingKey = await getSigningKey(
      this.settings.secretAccessKey,
      dateStamp,
      this.settings.region
    );
    const signature = await hmacHex(signingKey, stringToSign);
    const authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.settings.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`
    ].join(", ");

    const fetchHeaders = new Headers();
    for (const [header, value] of Object.entries(headers)) {
      if (header !== "host") {
        fetchHeaders.set(header, value);
      }
    }
    fetchHeaders.set("authorization", authorization);

    return fetch(url, {
      method,
      headers: fetchHeaders,
      ...(body ? { body: new Blob([new Uint8Array(body).buffer]) } : {}),
      mode: "cors"
    });
  }
}

export const objectKeyForSha256 = (sha256: string): string =>
  `attachments/sha256/${sha256.slice(0, 2)}/${sha256}`;
