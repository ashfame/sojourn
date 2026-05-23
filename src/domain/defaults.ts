import type { AppState, TaxYearProfile } from "./types";

export const SCHEMA_VERSION = 1;
export const RULES_VERSION = "tax-residency-v1-configurable";

const nowIso = () => new Date().toISOString();

export const createId = (prefix: string): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

export const createDefaultTaxYearProfiles = (timestamp = nowIso()): TaxYearProfile[] => [
  {
    id: "profile_india_default",
    country_code: "IN",
    label: "India financial year",
    start_month: 4,
    start_day: 1,
    timezone: "Asia/Kolkata",
    reporting_currency: "INR",
    created_at: timestamp,
    updated_at: timestamp
  },
  {
    id: "profile_uae_default",
    country_code: "AE",
    label: "UAE calendar year",
    start_month: 1,
    start_day: 1,
    timezone: "Asia/Dubai",
    reporting_currency: "AED",
    created_at: timestamp,
    updated_at: timestamp
  }
];

export const createInitialAppState = (): AppState => {
  const timestamp = nowIso();
  const profiles = createDefaultTaxYearProfiles(timestamp);

  return {
    schema_version: SCHEMA_VERSION,
    device_id: createId("device"),
    local_generation: 0,
    tax_year_profiles: profiles,
    travel_events: [],
    stay_events: [],
    presence_intervals: [],
    manual_corrections: [],
    documents: [],
    document_links: [],
    day_count_snapshots: [],
    storage_manifests: [],
    settings: {
      selected_country: "IN",
      selected_tax_year_profile_id: profiles[0]?.id ?? "profile_india_default",
      selected_tax_year_start: new Date().getUTCFullYear()
    },
    upload_status: "local"
  };
};
