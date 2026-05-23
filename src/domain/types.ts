export type CountryCode = string;

export type UploadStatus =
  | "local"
  | "pending"
  | "uploading"
  | "saved_to_s3"
  | "upload_error";

export type VerificationStatus = "unverified" | "verified" | "hash_mismatch";

export type Confidence = "high" | "medium" | "low" | "ambiguous";

export interface TaxYearProfile {
  id: string;
  country_code: CountryCode;
  label: string;
  start_month: number;
  start_day: number;
  timezone: string;
  reporting_currency?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface TravelEvent {
  id: string;
  type: "flight" | "train" | "border_crossing" | "ferry" | "other";
  origin_country: CountryCode;
  origin_city?: string | undefined;
  destination_country: CountryCode;
  destination_city?: string | undefined;
  departure_at: string;
  departure_timezone: string;
  arrival_at?: string | undefined;
  arrival_timezone?: string | undefined;
  carrier?: string | undefined;
  booking_reference?: string | undefined;
  notes?: string | undefined;
  confidence: Confidence;
  created_at: string;
  updated_at: string;
}

export interface StayEvent {
  id: string;
  type: "hotel" | "lease" | "home" | "family" | "other";
  country_code: CountryCode;
  city?: string | undefined;
  check_in_date: string;
  check_out_date?: string | undefined;
  timezone: string;
  provider?: string | undefined;
  booking_reference?: string | undefined;
  notes?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface PresenceInterval {
  id: string;
  country_code: CountryCode;
  start_at: string;
  end_at?: string | undefined;
  timezone: string;
  source_type: "travel_event" | "stay_event" | "manual" | "import" | "other";
  source_id?: string | undefined;
  confidence: Confidence;
  is_manual: boolean;
  notes?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface ManualCorrection {
  id: string;
  country_code: CountryCode;
  date: string;
  timezone: string;
  day_status: "present" | "absent" | "ambiguous";
  reason: string;
  supersedes_snapshot_id?: string | undefined;
  created_at: string;
}

export interface ResidencyDocument {
  id: string;
  title: string;
  kind:
    | "passport_stamp"
    | "boarding_pass"
    | "ticket"
    | "hotel_invoice"
    | "lease"
    | "visa"
    | "tax_doc"
    | "bank_statement"
    | "custom";
  mime_type: string;
  size_bytes: number;
  sha256: string;
  capture_date?: string | undefined;
  local_storage_backend: "opfs" | "indexeddb";
  local_storage_key: string;
  remote_object_key?: string | undefined;
  upload_status: UploadStatus;
  verification_status: VerificationStatus;
  created_at: string;
  updated_at: string;
}

export type LinkableEntityType =
  | "travel_event"
  | "stay_event"
  | "presence_interval"
  | "tax_year_profile"
  | "day_count_snapshot"
  | "manual_correction";

export interface DocumentLink {
  id: string;
  document_id: string;
  entity_type: LinkableEntityType;
  entity_id: string;
  relationship: string;
  created_at: string;
}

export interface DayLedgerEntry {
  date: string;
  country_code: CountryCode;
  status: "present" | "absent" | "ambiguous";
  source_ids: string[];
  evidence_document_ids: string[];
  is_manual: boolean;
  missing_evidence: boolean;
  notes?: string | undefined;
}

export interface DayCountSnapshot {
  id: string;
  country_code: CountryCode;
  tax_year_profile_id: string;
  period_start: string;
  period_end: string;
  included_day_count: number;
  ambiguous_day_count: number;
  missing_evidence_day_count: number;
  computed_at: string;
  rules_version: string;
  input_hash: string;
  result_json: string;
}

export interface StorageManifest {
  id: string;
  device_id: string;
  manifest_version: number;
  local_generation: number;
  remote_generation?: number | undefined;
  database_snapshot_key: string;
  attachment_entries_json: string;
  created_at: string;
  uploaded_at?: string | undefined;
  upload_status: UploadStatus;
  last_error?: string | undefined;
}

export interface StorageHead {
  device_id: string;
  generation: number;
  previous_generation?: number | undefined;
  schema_version: number;
  snapshot_key: string;
  manifest_key: string;
  content_hash: string;
  updated_at: string;
}

export interface AppSettings {
  selected_country: CountryCode;
  selected_tax_year_profile_id: string;
  selected_tax_year_start: number;
  s3?: DirectS3Settings | undefined;
}

export interface DirectS3Settings {
  endpoint: string;
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  forcePathStyle: boolean;
}

export interface AppState {
  schema_version: number;
  device_id: string;
  local_generation: number;
  remote_generation?: number | undefined;
  remote_head_etag?: string | undefined;
  tax_year_profiles: TaxYearProfile[];
  travel_events: TravelEvent[];
  stay_events: StayEvent[];
  presence_intervals: PresenceInterval[];
  manual_corrections: ManualCorrection[];
  documents: ResidencyDocument[];
  document_links: DocumentLink[];
  day_count_snapshots: DayCountSnapshot[];
  storage_manifests: StorageManifest[];
  settings: AppSettings;
  last_saved_at?: string | undefined;
  last_uploaded_at?: string | undefined;
  upload_status: UploadStatus;
  last_error?: string | undefined;
}

export interface TaxYearRange {
  profile: TaxYearProfile;
  start_year: number;
  start_date: string;
  end_date: string;
  label: string;
}

export interface ComputedDayLedger {
  country_code: CountryCode;
  tax_year_profile_id: string;
  period_start: string;
  period_end: string;
  included_day_count: number;
  ambiguous_day_count: number;
  missing_evidence_day_count: number;
  entries: DayLedgerEntry[];
}

export interface StorageCapabilityReport {
  serviceWorker: boolean;
  webWorker: boolean;
  indexedDb: boolean;
  opfs: boolean;
  webCrypto: boolean;
  storageEstimate?: {
    quota?: number | undefined;
    usage?: number | undefined;
    persisted?: boolean | undefined;
  } | undefined;
  crossOriginIsolated: boolean;
}
