import { describe, expect, it } from "vitest";
import { createInitialAppState } from "../../src/domain/defaults";
import { validateAppState, validateStorageHead } from "../../src/domain/schema";

describe("domain schema validation", () => {
  it("accepts the initial application state", () => {
    expect(validateAppState(createInitialAppState()).schema_version).toBe(1);
  });

  it("rejects malformed application state", () => {
    expect(() =>
      validateAppState({
        ...createInitialAppState(),
        tax_year_profiles: "not-an-array"
      })
    ).toThrow();
  });

  it("rejects storage heads with invalid content hashes", () => {
    expect(() =>
      validateStorageHead({
        device_id: "device",
        generation: 1,
        schema_version: 1,
        snapshot_key: "state/json/1.json",
        manifest_key: "state/manifests/1.json",
        content_hash: "not-a-sha",
        updated_at: "2026-05-22T00:00:00Z"
      })
    ).toThrow();
  });
});
