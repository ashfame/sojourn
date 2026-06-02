import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOAuthPkceSession,
  exchangeAuthorizationCode,
  mintS3Credentials
} from "../../src/storage/oauth";

const config = {
  authorizationEndpoint: "https://issuer.example/authorize",
  tokenEndpoint: "https://issuer.example/token",
  clientId: "client-1",
  redirectUri: "https://app.example/callback",
  scope: "storage:app storage:s3",
  credentialMintEndpoint: "https://api.example/mint-s3",
  credentialLabel: "Residency Days"
};

describe("OAuth PKCE credential flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a PKCE authorization URL with state and S256 challenge", async () => {
    const session = await createOAuthPkceSession(config);
    const url = new URL(session.authorizationUrl);

    expect(url.origin + url.pathname).toBe(config.authorizationEndpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects authorization responses with a mismatched OAuth state", async () => {
    const session = await createOAuthPkceSession(config);

    await expect(exchangeAuthorizationCode(session, "code", "wrong-state")).rejects.toThrow(
      "OAuth state mismatch"
    );
  });

  it("mints S3 settings from a credential endpoint", async () => {
    const fetchMock = vi.fn((request: RequestInfo | URL, init?: RequestInit) => {
      void request;
      void init;
      return new Response(
        JSON.stringify({
          s3: {
            endpoint: "https://s3.example",
            bucket: "bucket",
            region: "us-east-1",
            prefix: "residency-days",
            accessKeyId: "key",
            secretAccessKey: "secret",
            forcePathStyle: false
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mintS3Credentials(config.credentialMintEndpoint, "access")).resolves.toMatchObject({
      bucket: "bucket",
      prefix: "residency-days"
    });
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      protocol: "s3",
      kind: "s3_access_key",
      label: "Residency Days"
    });
  });

  it("maps BYOS protocol credentials into direct S3 settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        new Response(
          JSON.stringify({
            credential: {
              id: "pcred_1",
              expires_at: "2026-05-27T01:00:00Z"
            },
            grant: {
              external_alias: "bucket-alias",
              expires_at: "2026-05-27T01:00:00Z"
            },
            access_key_id: "byos_key",
            secret: "byos_secret"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(
      mintS3Credentials(config.credentialMintEndpoint, "access", {
        endpoint: "https://byos.ashfame.com",
        region: "us-east-1",
        prefix: "residency-days",
        forcePathStyle: true
      })
    ).resolves.toEqual({
      endpoint: "https://byos.ashfame.com",
      bucket: "bucket-alias",
      region: "us-east-1",
      prefix: "residency-days",
      accessKeyId: "byos_key",
      secretAccessKey: "byos_secret",
      sessionToken: undefined,
      forcePathStyle: true
    });
  });
});
