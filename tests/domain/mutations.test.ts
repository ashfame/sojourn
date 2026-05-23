import { describe, expect, it } from "vitest";
import { createInitialAppState } from "../../src/domain/defaults";
import { computeDayLedger } from "../../src/domain/dayLedger";
import {
  deleteDocumentFromState,
  deleteDocumentLinkFromState,
  deleteManualCorrectionFromState,
  deletePresenceIntervalFromState,
  deleteStayEventFromState,
  deleteTaxYearProfileFromState,
  deleteTravelEventFromState
} from "../../src/domain/mutations";
import { localDateTimeToInstant } from "../../src/domain/time";
import type { AppState, TaxYearProfile } from "../../src/domain/types";

const timestamp = "2026-01-01T00:00:00Z";

const profile = (state: AppState, id: string): TaxYearProfile => {
  const found = state.tax_year_profiles.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Profile missing: ${id}`);
  }
  return found;
};

const addDocument = (state: AppState, id = "document_ticket"): void => {
  state.documents.push({
    id,
    title: "Ticket",
    kind: "ticket",
    mime_type: "application/pdf",
    size_bytes: 128,
    sha256: "a".repeat(64),
    local_storage_backend: "indexeddb",
    local_storage_key: `attachments/${id}`,
    upload_status: "pending",
    verification_status: "verified",
    created_at: timestamp,
    updated_at: timestamp
  });
};

describe("state deletion mutations", () => {
  it("deletes travel events with derived presence intervals and evidence links", () => {
    const state = createInitialAppState();
    state.travel_events.push({
      id: "travel_1",
      type: "flight",
      origin_country: "IN",
      destination_country: "AE",
      departure_at: localDateTimeToInstant("2026-01-01T08:00", "Asia/Kolkata"),
      departure_timezone: "Asia/Kolkata",
      arrival_at: localDateTimeToInstant("2026-01-01T10:00", "Asia/Dubai"),
      arrival_timezone: "Asia/Dubai",
      confidence: "high",
      created_at: timestamp,
      updated_at: timestamp
    });
    state.presence_intervals.push({
      id: "presence_from_travel",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-01-01T10:00", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "travel_event",
      source_id: "travel_1",
      confidence: "high",
      is_manual: false,
      created_at: timestamp,
      updated_at: timestamp
    });
    state.document_links.push(
      {
        id: "link_travel",
        document_id: "document_ticket",
        entity_type: "travel_event",
        entity_id: "travel_1",
        relationship: "evidence",
        created_at: timestamp
      },
      {
        id: "link_presence",
        document_id: "document_ticket",
        entity_type: "presence_interval",
        entity_id: "presence_from_travel",
        relationship: "evidence",
        created_at: timestamp
      }
    );

    const next = deleteTravelEventFromState(state, "travel_1");

    expect(next.travel_events).toHaveLength(0);
    expect(next.presence_intervals).toHaveLength(0);
    expect(next.document_links).toHaveLength(0);
  });

  it("deletes stay events with derived presence intervals and evidence links", () => {
    const state = createInitialAppState();
    state.stay_events.push({
      id: "stay_1",
      type: "hotel",
      country_code: "AE",
      check_in_date: "2026-02-01",
      check_out_date: "2026-02-03",
      timezone: "Asia/Dubai",
      created_at: timestamp,
      updated_at: timestamp
    });
    state.presence_intervals.push({
      id: "presence_from_stay",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-02-01T00:00", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "stay_event",
      source_id: "stay_1",
      confidence: "high",
      is_manual: false,
      created_at: timestamp,
      updated_at: timestamp
    });
    state.document_links.push({
      id: "link_stay",
      document_id: "document_ticket",
      entity_type: "stay_event",
      entity_id: "stay_1",
      relationship: "evidence",
      created_at: timestamp
    });

    const next = deleteStayEventFromState(state, "stay_1");

    expect(next.stay_events).toHaveLength(0);
    expect(next.presence_intervals).toHaveLength(0);
    expect(next.document_links).toHaveLength(0);
  });

  it("recomputes ledger totals after deleting a presence interval", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_1",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-01-01T00:00", "Asia/Dubai"),
      end_at: localDateTimeToInstant("2026-01-03T23:59", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: true,
      created_at: timestamp,
      updated_at: timestamp
    });

    expect(computeDayLedger(state, profile(state, "profile_uae_default"), 2026).included_day_count).toBe(3);

    const next = deletePresenceIntervalFromState(state, "presence_1");

    expect(computeDayLedger(next, profile(next, "profile_uae_default"), 2026).included_day_count).toBe(0);
  });

  it("recomputes ledger totals after deleting a manual correction", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_1",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-01-01T00:00", "Asia/Dubai"),
      end_at: localDateTimeToInstant("2026-01-03T23:59", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: timestamp,
      updated_at: timestamp
    });
    state.manual_corrections.push({
      id: "correction_absent",
      country_code: "AE",
      date: "2026-01-02",
      timezone: "Asia/Dubai",
      day_status: "absent",
      reason: "Confirmed outside country.",
      created_at: timestamp
    });

    expect(computeDayLedger(state, profile(state, "profile_uae_default"), 2026).included_day_count).toBe(2);

    const next = deleteManualCorrectionFromState(state, "correction_absent");

    expect(computeDayLedger(next, profile(next, "profile_uae_default"), 2026).included_day_count).toBe(3);
  });

  it("deletes document metadata and all links to that document", () => {
    const state = createInitialAppState();
    addDocument(state);
    state.document_links.push({
      id: "link_1",
      document_id: "document_ticket",
      entity_type: "tax_year_profile",
      entity_id: "profile_uae_default",
      relationship: "evidence",
      created_at: timestamp
    });

    const next = deleteDocumentFromState(state, "document_ticket");

    expect(next.documents).toHaveLength(0);
    expect(next.document_links).toHaveLength(0);
  });

  it("deletes one evidence link without deleting the document", () => {
    const state = createInitialAppState();
    addDocument(state);
    state.document_links.push({
      id: "link_1",
      document_id: "document_ticket",
      entity_type: "tax_year_profile",
      entity_id: "profile_uae_default",
      relationship: "evidence",
      created_at: timestamp
    });

    const next = deleteDocumentLinkFromState(state, "link_1");

    expect(next.documents).toHaveLength(1);
    expect(next.document_links).toHaveLength(0);
  });

  it("deletes profiles only when another profile can become the default", () => {
    const state = createInitialAppState();
    state.settings.selected_tax_year_profile_id = "profile_india_default";
    state.day_count_snapshots.push({
      id: "snapshot_india",
      country_code: "IN",
      tax_year_profile_id: "profile_india_default",
      period_start: "2026-04-01",
      period_end: "2027-03-31",
      included_day_count: 0,
      ambiguous_day_count: 0,
      missing_evidence_day_count: 0,
      computed_at: timestamp,
      rules_version: "test",
      input_hash: "hash",
      result_json: "{}"
    });
    state.document_links.push(
      {
        id: "link_profile",
        document_id: "document_ticket",
        entity_type: "tax_year_profile",
        entity_id: "profile_india_default",
        relationship: "evidence",
        created_at: timestamp
      },
      {
        id: "link_snapshot",
        document_id: "document_ticket",
        entity_type: "day_count_snapshot",
        entity_id: "snapshot_india",
        relationship: "evidence",
        created_at: timestamp
      }
    );

    const next = deleteTaxYearProfileFromState(state, "profile_india_default");

    expect(next.tax_year_profiles.map((item) => item.id)).toEqual(["profile_uae_default"]);
    expect(next.settings.selected_tax_year_profile_id).toBe("profile_uae_default");
    expect(next.day_count_snapshots).toHaveLength(0);
    expect(next.document_links).toHaveLength(0);
    expect(() => deleteTaxYearProfileFromState(next, "profile_uae_default")).toThrow(
      "At least one tax-year profile is required."
    );
  });
});
