import { zipSync, strToU8 } from "fflate";
import { createId } from "../domain/defaults";
import { computeDayLedger } from "../domain/dayLedger";
import { sha256Hex, stableStringify } from "../domain/hash";
import { validateAttachmentManifestEntries } from "../domain/schema";
import type { AppState, StorageManifest, TaxYearProfile } from "../domain/types";
import { getAttachmentBlob } from "./attachments";

export const sanitizeStateForRemote = (state: AppState): AppState => ({
  ...state,
  settings: {
    ...state.settings,
    s3: undefined
  }
});

export const createStateSnapshot = async (state: AppState): Promise<{
  bytes: Uint8Array;
  hash: string;
}> => {
  const json = stableStringify(sanitizeStateForRemote(state));
  const bytes = new TextEncoder().encode(json);
  return {
    bytes,
    hash: await sha256Hex(bytes.buffer)
  };
};

export const createStorageManifest = (
  state: AppState,
  snapshotKey: string,
  attachments: Array<{ key: string; sha256: string; size: number }>
): StorageManifest => {
  const timestamp = new Date().toISOString();
  const attachmentEntries = validateAttachmentManifestEntries(attachments);
  return {
    id: createId("manifest"),
    device_id: state.device_id,
    manifest_version: 1,
    local_generation: state.local_generation,
    remote_generation: state.remote_generation,
    database_snapshot_key: snapshotKey,
    attachment_entries_json: stableStringify(attachmentEntries),
    created_at: timestamp,
    uploaded_at: timestamp,
    upload_status: "saved_to_s3"
  };
};

const ledgerCsv = (entries: ReturnType<typeof computeDayLedger>["entries"]): string => {
  const header = [
    "date",
    "country_code",
    "status",
    "source_ids",
    "evidence_document_ids",
    "is_manual",
    "missing_evidence",
    "notes"
  ];
  const rows = entries.map((entry) =>
    [
      entry.date,
      entry.country_code,
      entry.status,
      entry.source_ids.join(";"),
      entry.evidence_document_ids.join(";"),
      String(entry.is_manual),
      String(entry.missing_evidence),
      entry.notes ?? ""
    ]
      .map((value) => `"${value.replaceAll('"', '""')}"`)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
};

export const createExportPackage = async (
  state: AppState,
  profile: TaxYearProfile,
  countryCode: string,
  startYear: number
): Promise<Uint8Array> => {
  const ledger = computeDayLedger(state, profile, startYear, countryCode);
  const evidenceIndex = state.documents.map((document) => ({
    id: document.id,
    title: document.title,
    kind: document.kind,
    sha256: document.sha256,
    size_bytes: document.size_bytes,
    remote_object_key: document.remote_object_key
  }));

  const report = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Tax Residency Package</title></head>
<body>
  <h1>Tax Residency Package</h1>
  <p>Country: ${countryCode}</p>
  <p>Period: ${ledger.period_start} to ${ledger.period_end}</p>
  <p>Included days: ${ledger.included_day_count}</p>
  <p>Ambiguous days: ${ledger.ambiguous_day_count}</p>
  <p>Present days missing evidence: ${ledger.missing_evidence_day_count}</p>
</body>
</html>`;

  const files: Record<string, Uint8Array> = {
    "report.html": strToU8(report),
    "day-ledger.json": strToU8(stableStringify(ledger)),
    "day-ledger.csv": strToU8(ledgerCsv(ledger.entries)),
    "evidence-index.json": strToU8(stableStringify(evidenceIndex)),
    "state.json": strToU8(stableStringify(sanitizeStateForRemote(state)))
  };

  for (const document of state.documents) {
    const blob = await getAttachmentBlob(
      document.local_storage_backend,
      document.local_storage_key
    );
    if (!blob) {
      continue;
    }
    const safeTitle = document.title.replace(/[^a-z0-9._-]+/gi, "_");
    files[`documents/${document.sha256}_${safeTitle}`] = new Uint8Array(
      await blob.arrayBuffer()
    );
  }

  return zipSync(files, { level: 6 });
};
