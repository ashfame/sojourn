import { Temporal } from "@js-temporal/polyfill";
import { RULES_VERSION, createId } from "./defaults";
import { sha256Hex, stableStringify } from "./hash";
import {
  clampDateRange,
  eachDateInclusive,
  getTaxYearRange,
  instantToDateInTimeZone
} from "./time";
import type {
  AppState,
  ComputedDayLedger,
  DayCountSnapshot,
  DayLedgerEntry,
  DocumentLink,
  LinkableEntityType,
  TaxYearProfile
} from "./types";

const entitySourceId = (entityType: LinkableEntityType, entityId: string): string =>
  `${entityType}:${entityId}`;

const linkMapByEntity = (links: DocumentLink[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const link of links) {
    const key = entitySourceId(link.entity_type, link.entity_id);
    const existing = map.get(key) ?? [];
    existing.push(link.document_id);
    map.set(key, existing);
  }
  return map;
};

const addEvidence = (
  entry: DayLedgerEntry,
  evidenceByEntity: Map<string, string[]>,
  sourceType: LinkableEntityType,
  sourceId: string
): void => {
  const documentIds = evidenceByEntity.get(entitySourceId(sourceType, sourceId)) ?? [];
  for (const documentId of documentIds) {
    if (!entry.evidence_document_ids.includes(documentId)) {
      entry.evidence_document_ids.push(documentId);
    }
  }
};

const markDay = (
  entries: Map<string, DayLedgerEntry>,
  date: string,
  next: {
    status: DayLedgerEntry["status"];
    sourceId: string;
    sourceType: LinkableEntityType;
    evidenceByEntity: Map<string, string[]>;
    isManual?: boolean | undefined;
    notes?: string | undefined;
  }
): void => {
  const entry = entries.get(date);
  if (!entry) {
    return;
  }

  if (!entry.source_ids.includes(next.sourceId)) {
    entry.source_ids.push(next.sourceId);
  }
  addEvidence(entry, next.evidenceByEntity, next.sourceType, next.sourceId.split(":")[1] ?? next.sourceId);

  if (next.isManual) {
    entry.status = next.status;
    entry.is_manual = true;
    entry.notes = next.notes;
    return;
  }

  if (entry.is_manual) {
    return;
  }

  if (next.status === "ambiguous" && entry.status === "absent") {
    entry.status = "ambiguous";
  }
  if (next.status === "present") {
    entry.status = "present";
  }
  if (!entry.notes && next.notes) {
    entry.notes = next.notes;
  }
};

const markRange = (
  entries: Map<string, DayLedgerEntry>,
  startDate: string,
  endDate: string,
  periodStart: string,
  periodEnd: string,
  marker: Omit<Parameters<typeof markDay>[2], "sourceId"> & { sourceId: string }
): void => {
  const clamped = clampDateRange(startDate, endDate, periodStart, periodEnd);
  if (!clamped) {
    return;
  }
  for (const date of eachDateInclusive(clamped.start, clamped.end)) {
    markDay(entries, date, marker);
  }
};

const instantAfter = (leftIso: string, rightIso: string): boolean =>
  Temporal.Instant.compare(Temporal.Instant.from(leftIso), Temporal.Instant.from(rightIso)) > 0;

const nextDepartureFromCountry = (
  state: AppState,
  countryCode: string,
  afterInstant: string
) =>
  state.travel_events
    .filter(
      (travel) =>
        travel.origin_country === countryCode && instantAfter(travel.departure_at, afterInstant)
    )
    .sort((a, b) =>
      Temporal.Instant.compare(
        Temporal.Instant.from(a.departure_at),
        Temporal.Instant.from(b.departure_at)
      )
    )[0];

export const computeDayLedger = (
  state: AppState,
  profile: TaxYearProfile,
  startYear: number,
  countryCode = profile.country_code
): ComputedDayLedger => {
  const range = getTaxYearRange(profile, startYear);
  const evidenceByEntity = linkMapByEntity(state.document_links);
  const entries = new Map<string, DayLedgerEntry>();

  for (const date of eachDateInclusive(range.start_date, range.end_date)) {
    entries.set(date, {
      date,
      country_code: countryCode,
      status: "absent",
      source_ids: [],
      evidence_document_ids: [],
      is_manual: false,
      missing_evidence: false
    });
  }

  for (const interval of state.presence_intervals.filter(
    (item) => item.country_code === countryCode
  )) {
    const startDate = instantToDateInTimeZone(interval.start_at, interval.timezone);
    const endDate = interval.end_at
      ? instantToDateInTimeZone(interval.end_at, interval.timezone)
      : range.end_date;
    markRange(entries, startDate, endDate, range.start_date, range.end_date, {
      status: interval.confidence === "ambiguous" ? "ambiguous" : "present",
      sourceId: entitySourceId("presence_interval", interval.id),
      sourceType: "presence_interval",
      evidenceByEntity,
      isManual: interval.is_manual,
      notes: interval.notes
    });
  }

  for (const stay of state.stay_events.filter((item) => item.country_code === countryCode)) {
    markRange(
      entries,
      stay.check_in_date,
      stay.check_out_date ?? range.end_date,
      range.start_date,
      range.end_date,
      {
        status: "present",
        sourceId: entitySourceId("stay_event", stay.id),
        sourceType: "stay_event",
        evidenceByEntity,
        notes: stay.notes
      }
    );
  }

  for (const travel of state.travel_events) {
    if (travel.origin_country === countryCode) {
      const date = instantToDateInTimeZone(travel.departure_at, travel.departure_timezone);
      markDay(entries, date, {
        status: travel.confidence === "ambiguous" ? "ambiguous" : "present",
        sourceId: entitySourceId("travel_event", travel.id),
        sourceType: "travel_event",
        evidenceByEntity,
        notes: travel.notes
      });
    }

    if (travel.destination_country === countryCode) {
      if (!travel.arrival_at || !travel.arrival_timezone) {
        const departureDate = instantToDateInTimeZone(
          travel.departure_at,
          travel.departure_timezone
        );
        markDay(entries, departureDate, {
          status: "ambiguous",
          sourceId: entitySourceId("travel_event", travel.id),
          sourceType: "travel_event",
          evidenceByEntity,
          notes: "Arrival date is missing."
        });
      } else {
        const date = instantToDateInTimeZone(travel.arrival_at, travel.arrival_timezone);
        markDay(entries, date, {
          status: travel.confidence === "ambiguous" ? "ambiguous" : "present",
          sourceId: entitySourceId("travel_event", travel.id),
          sourceType: "travel_event",
          evidenceByEntity,
          notes: travel.notes
        });

        const nextDeparture = nextDepartureFromCountry(
          state,
          countryCode,
          travel.arrival_at
        );
        const endDate = nextDeparture
          ? instantToDateInTimeZone(
              nextDeparture.departure_at,
              nextDeparture.departure_timezone
            )
          : range.end_date;
        markRange(entries, date, endDate, range.start_date, range.end_date, {
          status:
            travel.confidence === "ambiguous" || !nextDeparture ? "ambiguous" : "present",
          sourceId: entitySourceId("travel_event", travel.id),
          sourceType: "travel_event",
          evidenceByEntity,
          notes: nextDeparture
            ? "Inferred presence from arrival until next departure."
            : "Open-ended inferred presence from arrival; no later departure recorded."
        });
      }
    }
  }

  for (const correction of state.manual_corrections.filter(
    (item) => item.country_code === countryCode
  )) {
    markDay(entries, correction.date, {
      status: correction.day_status,
      sourceId: entitySourceId("manual_correction", correction.id),
      sourceType: "manual_correction",
      evidenceByEntity,
      isManual: true,
      notes: correction.reason
    });
  }

  const result = [...entries.values()].map((entry) => ({
    ...entry,
    source_ids: [...entry.source_ids].sort(),
    evidence_document_ids: [...entry.evidence_document_ids].sort(),
    missing_evidence: entry.status === "present" && entry.evidence_document_ids.length === 0
  }));

  return {
    country_code: countryCode,
    tax_year_profile_id: profile.id,
    period_start: range.start_date,
    period_end: range.end_date,
    included_day_count: result.filter((entry) => entry.status === "present").length,
    ambiguous_day_count: result.filter((entry) => entry.status === "ambiguous").length,
    missing_evidence_day_count: result.filter((entry) => entry.missing_evidence).length,
    entries: result
  };
};

export const createDayCountSnapshot = async (
  ledger: ComputedDayLedger
): Promise<DayCountSnapshot> => {
  const computedAt = new Date().toISOString();
  const resultJson = stableStringify(ledger);

  return {
    id: createId("snapshot"),
    country_code: ledger.country_code,
    tax_year_profile_id: ledger.tax_year_profile_id,
    period_start: ledger.period_start,
    period_end: ledger.period_end,
    included_day_count: ledger.included_day_count,
    ambiguous_day_count: ledger.ambiguous_day_count,
    missing_evidence_day_count: ledger.missing_evidence_day_count,
    computed_at: computedAt,
    rules_version: RULES_VERSION,
    input_hash: await sha256Hex(resultJson),
    result_json: resultJson
  };
};
