import { describe, expect, it } from "vitest";
import { createInitialAppState } from "../../src/domain/defaults";
import { computeDayLedger } from "../../src/domain/dayLedger";
import { localDateTimeToInstant } from "../../src/domain/time";
import type { AppState, TaxYearProfile } from "../../src/domain/types";

const profile = (state: AppState, id: string): TaxYearProfile => {
  const found = state.tax_year_profiles.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Profile missing: ${id}`);
  }
  return found;
};

describe("day ledger", () => {
  it("counts India Apr-Mar financial year boundaries", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_india_full",
      country_code: "IN",
      start_at: localDateTimeToInstant("2025-04-01T00:00", "Asia/Kolkata"),
      end_at: localDateTimeToInstant("2026-03-31T23:59", "Asia/Kolkata"),
      timezone: "Asia/Kolkata",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: "2025-04-01T00:00:00Z",
      updated_at: "2025-04-01T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_india_default"), 2025);

    expect(ledger.period_start).toBe("2025-04-01");
    expect(ledger.period_end).toBe("2026-03-31");
    expect(ledger.included_day_count).toBe(365);
  });

  it("counts UAE calendar year and leap years", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_uae_full",
      country_code: "AE",
      start_at: localDateTimeToInstant("2024-01-01T00:00", "Asia/Dubai"),
      end_at: localDateTimeToInstant("2024-12-31T23:59", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2024);

    expect(ledger.period_start).toBe("2024-01-01");
    expect(ledger.period_end).toBe("2024-12-31");
    expect(ledger.included_day_count).toBe(366);
  });

  it("supports custom tax-year start month and day", () => {
    const state = createInitialAppState();
    state.tax_year_profiles.push({
      id: "profile_sg_custom",
      country_code: "SG",
      label: "Custom SG",
      start_month: 7,
      start_day: 1,
      timezone: "Asia/Singapore",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_sg_custom"), 2025);

    expect(ledger.period_start).toBe("2025-07-01");
    expect(ledger.period_end).toBe("2026-06-30");
  });

  it("handles overnight flights crossing midnight and timezones", () => {
    const state = createInitialAppState();
    state.travel_events.push({
      id: "travel_overnight",
      type: "flight",
      origin_country: "IN",
      destination_country: "AE",
      departure_at: localDateTimeToInstant("2026-03-31T23:30", "Asia/Kolkata"),
      departure_timezone: "Asia/Kolkata",
      arrival_at: localDateTimeToInstant("2026-04-01T01:30", "Asia/Dubai"),
      arrival_timezone: "Asia/Dubai",
      confidence: "high",
      created_at: "2026-03-31T00:00:00Z",
      updated_at: "2026-03-31T00:00:00Z"
    });

    const indiaLedger = computeDayLedger(state, profile(state, "profile_india_default"), 2025);
    const uaeLedger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(indiaLedger.entries.find((entry) => entry.date === "2026-03-31")?.status).toBe(
      "present"
    );
    expect(uaeLedger.entries.find((entry) => entry.date === "2026-04-01")?.status).toBe(
      "present"
    );
  });

  it("infers a country presence span between arrival and next departure", () => {
    const state = createInitialAppState();
    state.travel_events.push(
      {
        id: "travel_arrive_uae",
        type: "flight",
        origin_country: "IN",
        destination_country: "AE",
        departure_at: localDateTimeToInstant("2026-01-01T08:00", "Asia/Kolkata"),
        departure_timezone: "Asia/Kolkata",
        arrival_at: localDateTimeToInstant("2026-01-01T10:00", "Asia/Dubai"),
        arrival_timezone: "Asia/Dubai",
        confidence: "high",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z"
      },
      {
        id: "travel_depart_uae",
        type: "flight",
        origin_country: "AE",
        destination_country: "IN",
        departure_at: localDateTimeToInstant("2026-01-10T09:00", "Asia/Dubai"),
        departure_timezone: "Asia/Dubai",
        arrival_at: localDateTimeToInstant("2026-01-10T14:00", "Asia/Kolkata"),
        arrival_timezone: "Asia/Kolkata",
        confidence: "high",
        created_at: "2026-01-10T00:00:00Z",
        updated_at: "2026-01-10T00:00:00Z"
      }
    );

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(ledger.included_day_count).toBe(10);
    expect(ledger.entries.find((entry) => entry.date === "2026-01-05")?.status).toBe(
      "present"
    );
    expect(
      ledger.entries.find((entry) => entry.date === "2026-01-05")?.source_ids
    ).toContain("travel_event:travel_arrive_uae");
  });

  it("marks inferred travel presence as ambiguous when no later departure exists", () => {
    const state = createInitialAppState();
    state.travel_events.push({
      id: "travel_arrive_open",
      type: "flight",
      origin_country: "IN",
      destination_country: "AE",
      departure_at: localDateTimeToInstant("2026-12-29T08:00", "Asia/Kolkata"),
      departure_timezone: "Asia/Kolkata",
      arrival_at: localDateTimeToInstant("2026-12-29T10:00", "Asia/Dubai"),
      arrival_timezone: "Asia/Dubai",
      confidence: "high",
      created_at: "2026-12-29T00:00:00Z",
      updated_at: "2026-12-29T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(ledger.included_day_count).toBe(1);
    expect(ledger.ambiguous_day_count).toBe(2);
    expect(ledger.entries.find((entry) => entry.date === "2026-12-30")?.notes).toContain(
      "Open-ended"
    );
  });

  it("counts same-day entry and exit as a present day", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_same_day",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-02-10T08:00", "Asia/Dubai"),
      end_at: localDateTimeToInstant("2026-02-10T22:00", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: "2026-02-10T00:00:00Z",
      updated_at: "2026-02-10T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(ledger.included_day_count).toBe(1);
  });

  it("treats missing exit date as open until the tax-year end", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_open",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-12-29T10:00", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: "2026-12-29T00:00:00Z",
      updated_at: "2026-12-29T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(ledger.included_day_count).toBe(3);
  });

  it("lets manual corrections override computed presence", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_with_override",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-01-01T10:00", "Asia/Dubai"),
      end_at: localDateTimeToInstant("2026-01-05T10:00", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    });
    state.manual_corrections.push({
      id: "correction_absent",
      country_code: "AE",
      date: "2026-01-03",
      timezone: "Asia/Dubai",
      day_status: "absent",
      reason: "Not physically present.",
      created_at: "2026-01-04T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(ledger.included_day_count).toBe(4);
    expect(ledger.entries.find((entry) => entry.date === "2026-01-03")?.is_manual).toBe(
      true
    );
  });

  it("calculates evidence completeness from linked documents", () => {
    const state = createInitialAppState();
    state.presence_intervals.push({
      id: "presence_evidenced",
      country_code: "AE",
      start_at: localDateTimeToInstant("2026-01-01T10:00", "Asia/Dubai"),
      end_at: localDateTimeToInstant("2026-01-02T10:00", "Asia/Dubai"),
      timezone: "Asia/Dubai",
      source_type: "manual",
      confidence: "high",
      is_manual: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    });
    state.documents.push({
      id: "document_ticket",
      title: "Ticket",
      kind: "ticket",
      mime_type: "application/pdf",
      size_bytes: 100,
      sha256: "a".repeat(64),
      local_storage_backend: "indexeddb",
      local_storage_key: "attachments/ticket",
      upload_status: "local",
      verification_status: "verified",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    });
    state.document_links.push({
      id: "link_ticket",
      document_id: "document_ticket",
      entity_type: "presence_interval",
      entity_id: "presence_evidenced",
      relationship: "evidence",
      created_at: "2026-01-01T00:00:00Z"
    });

    const ledger = computeDayLedger(state, profile(state, "profile_uae_default"), 2026);

    expect(ledger.included_day_count).toBe(2);
    expect(ledger.missing_evidence_day_count).toBe(0);
  });
});
