import { z } from "zod";
import { SCHEMA_VERSION } from "./defaults";
import type { AppState, StorageHead, StorageManifest } from "./types";

const optionalString = z.string().optional();
const countryCode = z.string().min(2).max(3);
const uploadStatus = z.enum([
  "local",
  "pending",
  "uploading",
  "saved_to_s3",
  "upload_error"
]);
const verificationStatus = z.enum(["unverified", "verified", "hash_mismatch"]);
const confidence = z.enum(["high", "medium", "low", "ambiguous"]);

const taxYearProfileSchema = z.object({
  id: z.string().min(1),
  country_code: countryCode,
  label: z.string().min(1),
  start_month: z.number().int().min(1).max(12),
  start_day: z.number().int().min(1).max(31),
  timezone: z.string().min(1),
  reporting_currency: optionalString,
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
});

const travelEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["flight", "train", "border_crossing", "ferry", "other"]),
  origin_country: countryCode,
  origin_city: optionalString,
  destination_country: countryCode,
  destination_city: optionalString,
  departure_at: z.string().min(1),
  departure_timezone: z.string().min(1),
  arrival_at: optionalString,
  arrival_timezone: optionalString,
  carrier: optionalString,
  booking_reference: optionalString,
  notes: optionalString,
  confidence,
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
});

const stayEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["hotel", "lease", "home", "family", "other"]),
  country_code: countryCode,
  city: optionalString,
  check_in_date: z.string().min(1),
  check_out_date: optionalString,
  timezone: z.string().min(1),
  provider: optionalString,
  booking_reference: optionalString,
  notes: optionalString,
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
});

const presenceIntervalSchema = z.object({
  id: z.string().min(1),
  country_code: countryCode,
  start_at: z.string().min(1),
  end_at: optionalString,
  timezone: z.string().min(1),
  source_type: z.enum(["travel_event", "stay_event", "manual", "import", "other"]),
  source_id: optionalString,
  confidence,
  is_manual: z.boolean(),
  notes: optionalString,
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
});

const manualCorrectionSchema = z.object({
  id: z.string().min(1),
  country_code: countryCode,
  date: z.string().min(1),
  timezone: z.string().min(1),
  day_status: z.enum(["present", "absent", "ambiguous"]),
  reason: z.string().min(1),
  supersedes_snapshot_id: optionalString,
  created_at: z.string().min(1)
});

const documentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum([
    "passport_stamp",
    "boarding_pass",
    "ticket",
    "hotel_invoice",
    "lease",
    "visa",
    "tax_doc",
    "bank_statement",
    "custom"
  ]),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  capture_date: optionalString,
  local_storage_backend: z.enum(["opfs", "indexeddb"]),
  local_storage_key: z.string().min(1),
  remote_object_key: optionalString,
  upload_status: uploadStatus,
  verification_status: verificationStatus,
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
});

const documentLinkSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  entity_type: z.enum([
    "travel_event",
    "stay_event",
    "presence_interval",
    "tax_year_profile",
    "day_count_snapshot",
    "manual_correction"
  ]),
  entity_id: z.string().min(1),
  relationship: z.string().min(1),
  created_at: z.string().min(1)
});

const dayCountSnapshotSchema = z.object({
  id: z.string().min(1),
  country_code: countryCode,
  tax_year_profile_id: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  included_day_count: z.number().int().nonnegative(),
  ambiguous_day_count: z.number().int().nonnegative(),
  missing_evidence_day_count: z.number().int().nonnegative(),
  computed_at: z.string().min(1),
  rules_version: z.string().min(1),
  input_hash: z.string().min(1),
  result_json: z.string().min(1)
});

export const attachmentManifestEntrySchema = z.object({
  key: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative()
});

export const attachmentManifestEntriesSchema = z.array(attachmentManifestEntrySchema);

const storageManifestSchema = z.object({
  id: z.string().min(1),
  device_id: z.string().min(1),
  manifest_version: z.number().int().positive(),
  local_generation: z.number().int().nonnegative(),
  remote_generation: z.number().int().nonnegative().optional(),
  database_snapshot_key: z.string().min(1),
  attachment_entries_json: z.string(),
  created_at: z.string().min(1),
  uploaded_at: optionalString,
  upload_status: uploadStatus,
  last_error: optionalString
});

const directS3SettingsSchema = z.object({
  endpoint: z.string().min(1),
  bucket: z.string().min(1),
  region: z.string().min(1),
  prefix: z.string(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: optionalString,
  forcePathStyle: z.boolean()
});

const appSettingsSchema = z.object({
  selected_country: countryCode,
  selected_tax_year_profile_id: z.string().min(1),
  selected_tax_year_start: z.number().int(),
  s3: directS3SettingsSchema.optional()
});

export const appStateSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  device_id: z.string().min(1),
  local_generation: z.number().int().nonnegative(),
  remote_generation: z.number().int().nonnegative().optional(),
  remote_head_etag: optionalString,
  tax_year_profiles: z.array(taxYearProfileSchema),
  travel_events: z.array(travelEventSchema),
  stay_events: z.array(stayEventSchema),
  presence_intervals: z.array(presenceIntervalSchema),
  manual_corrections: z.array(manualCorrectionSchema),
  documents: z.array(documentSchema),
  document_links: z.array(documentLinkSchema),
  day_count_snapshots: z.array(dayCountSnapshotSchema),
  storage_manifests: z.array(storageManifestSchema),
  settings: appSettingsSchema,
  last_saved_at: optionalString,
  last_uploaded_at: optionalString,
  upload_status: uploadStatus,
  last_error: optionalString
});

export const storageHeadSchema = z.object({
  device_id: z.string().min(1),
  generation: z.number().int().positive(),
  previous_generation: z.number().int().nonnegative().optional(),
  schema_version: z.literal(SCHEMA_VERSION),
  snapshot_key: z.string().min(1),
  manifest_key: z.string().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  updated_at: z.string().min(1)
});

export const validateAppState = (value: unknown): AppState => appStateSchema.parse(value);

export const validateStorageHead = (value: unknown): StorageHead =>
  storageHeadSchema.parse(value);

export const validateStorageManifest = (value: unknown): StorageManifest =>
  storageManifestSchema.parse(value);

export const validateAttachmentManifestEntries = (value: unknown) =>
  attachmentManifestEntriesSchema.parse(value);
