import type { DirectS3Settings } from "../domain/types";

export interface OAuthPkceConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  credentialMintEndpoint: string;
  audience?: string;
  credentialLabel?: string;
}

export interface OAuthPkceSession {
  state: string;
  codeVerifier: string;
  authorizationUrl: string;
  createdAt: string;
  config: OAuthPkceConfig;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface ByosProtocolCredentialResponse {
  credential?: {
    expires_at?: string | undefined;
  } | undefined;
  grant?: {
    external_alias?: string | undefined;
    expires_at?: string | undefined;
  } | undefined;
  access_key_id?: string | undefined;
  secret?: string | undefined;
  session_token?: string | undefined;
}

export interface MintS3CredentialsOptions {
  endpoint?: string | undefined;
  region?: string | undefined;
  prefix?: string | undefined;
  forcePathStyle?: boolean | undefined;
  label?: string | undefined;
}

const randomBase64Url = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
};

const isDirectS3Settings = (value: unknown): value is DirectS3Settings => {
  const candidate = value as Partial<DirectS3Settings> | undefined;
  return Boolean(
    candidate?.endpoint &&
      candidate.bucket &&
      candidate.region &&
      candidate.prefix !== undefined &&
      candidate.accessKeyId &&
      candidate.secretAccessKey &&
      typeof candidate.forcePathStyle === "boolean"
  );
};

export const createOAuthPkceSession = async (
  config: OAuthPkceConfig
): Promise<OAuthPkceSession> => {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (config.audience) {
    url.searchParams.set("audience", config.audience);
  }

  return {
    state,
    codeVerifier,
    authorizationUrl: url.toString(),
    createdAt: new Date().toISOString(),
    config
  };
};

export const exchangeAuthorizationCode = async (
  session: OAuthPkceSession,
  code: string,
  returnedState: string
): Promise<TokenResponse> => {
  if (returnedState !== session.state) {
    throw new Error("OAuth state mismatch.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: session.config.clientId,
    redirect_uri: session.config.redirectUri,
    code,
    code_verifier: session.codeVerifier
  });

  const response = await fetch(session.config.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with ${response.status}.`);
  }
  return response.json() as Promise<TokenResponse>;
};

export const mintS3Credentials = async (
  credentialMintEndpoint: string,
  accessToken: string,
  options: MintS3CredentialsOptions = {}
): Promise<DirectS3Settings> => {
  const response = await fetch(credentialMintEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      protocol: "s3",
      kind: "s3_access_key",
      label: options.label ?? "Residency Days"
    })
  });
  if (!response.ok) {
    throw new Error(`S3 credential minting failed with ${response.status}.`);
  }
  const payload = (await response.json()) as
    | DirectS3Settings
    | { s3: DirectS3Settings }
    | ByosProtocolCredentialResponse;
  if ("s3" in payload) {
    return payload.s3;
  }
  if ("access_key_id" in payload || "secret" in payload || "grant" in payload) {
    if (!payload.access_key_id || !payload.secret || !payload.grant?.external_alias) {
      throw new Error("S3 credential response is missing key material or bucket alias.");
    }
    return {
      endpoint: options.endpoint ?? "https://byos.ashfame.com",
      bucket: payload.grant.external_alias,
      region: options.region ?? "us-east-1",
      prefix: options.prefix ?? "residency-days",
      accessKeyId: payload.access_key_id,
      secretAccessKey: payload.secret,
      sessionToken: payload.session_token,
      forcePathStyle: options.forcePathStyle ?? true
    };
  }
  if (isDirectS3Settings(payload)) {
    return payload;
  }
  throw new Error("S3 credential response has an unsupported shape.");
};
