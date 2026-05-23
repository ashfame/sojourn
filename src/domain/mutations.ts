import type {
  AppState,
  DocumentLink,
  LinkableEntityType,
  TaxYearProfile
} from "./types";

const ensureExists = <T extends { id: string }>(
  items: T[],
  id: string,
  label: string
): T => {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`${label} not found: ${id}`);
  }
  return item;
};

const withoutEntityLinks = (
  links: DocumentLink[],
  entities: Array<{ entity_type: LinkableEntityType; entity_id: string }>
): DocumentLink[] =>
  links.filter(
    (link) =>
      !entities.some(
        (entity) => entity.entity_type === link.entity_type && entity.entity_id === link.entity_id
      )
  );

const derivedPresenceLinks = (
  state: AppState,
  source_type: "travel_event" | "stay_event",
  source_id: string
): Array<{ entity_type: LinkableEntityType; entity_id: string }> =>
  state.presence_intervals
    .filter((interval) => interval.source_type === source_type && interval.source_id === source_id)
    .map((interval) => ({
      entity_type: "presence_interval" as const,
      entity_id: interval.id
    }));

const firstRemainingProfile = (
  profiles: TaxYearProfile[],
  deletedProfileId: string
): TaxYearProfile => {
  const fallback = profiles.find((profile) => profile.id !== deletedProfileId);
  if (!fallback) {
    throw new Error("At least one tax-year profile is required.");
  }
  return fallback;
};

export const deleteTravelEventFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.travel_events, id, "Travel event");
  const removedEntities = [
    { entity_type: "travel_event" as const, entity_id: id },
    ...derivedPresenceLinks(state, "travel_event", id)
  ];

  return {
    ...state,
    travel_events: state.travel_events.filter((event) => event.id !== id),
    presence_intervals: state.presence_intervals.filter(
      (interval) => interval.source_type !== "travel_event" || interval.source_id !== id
    ),
    document_links: withoutEntityLinks(state.document_links, removedEntities)
  };
};

export const deleteStayEventFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.stay_events, id, "Stay event");
  const removedEntities = [
    { entity_type: "stay_event" as const, entity_id: id },
    ...derivedPresenceLinks(state, "stay_event", id)
  ];

  return {
    ...state,
    stay_events: state.stay_events.filter((event) => event.id !== id),
    presence_intervals: state.presence_intervals.filter(
      (interval) => interval.source_type !== "stay_event" || interval.source_id !== id
    ),
    document_links: withoutEntityLinks(state.document_links, removedEntities)
  };
};

export const deletePresenceIntervalFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.presence_intervals, id, "Presence interval");

  return {
    ...state,
    presence_intervals: state.presence_intervals.filter((interval) => interval.id !== id),
    document_links: withoutEntityLinks(state.document_links, [
      { entity_type: "presence_interval", entity_id: id }
    ])
  };
};

export const deleteManualCorrectionFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.manual_corrections, id, "Manual correction");

  return {
    ...state,
    manual_corrections: state.manual_corrections.filter((correction) => correction.id !== id),
    document_links: withoutEntityLinks(state.document_links, [
      { entity_type: "manual_correction", entity_id: id }
    ])
  };
};

export const deleteTaxYearProfileFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.tax_year_profiles, id, "Tax-year profile");
  const fallback = firstRemainingProfile(state.tax_year_profiles, id);
  const removedSnapshotIds = state.day_count_snapshots
    .filter((snapshot) => snapshot.tax_year_profile_id === id)
    .map((snapshot) => snapshot.id);
  const removedEntities: Array<{ entity_type: LinkableEntityType; entity_id: string }> = [
    { entity_type: "tax_year_profile", entity_id: id },
    ...removedSnapshotIds.map((snapshotId) => ({
      entity_type: "day_count_snapshot" as const,
      entity_id: snapshotId
    }))
  ];
  const selectedProfileDeleted = state.settings.selected_tax_year_profile_id === id;

  return {
    ...state,
    tax_year_profiles: state.tax_year_profiles.filter((profile) => profile.id !== id),
    day_count_snapshots: state.day_count_snapshots.filter(
      (snapshot) => snapshot.tax_year_profile_id !== id
    ),
    document_links: withoutEntityLinks(state.document_links, removedEntities),
    settings: selectedProfileDeleted
      ? {
          ...state.settings,
          selected_country: fallback.country_code,
          selected_tax_year_profile_id: fallback.id
        }
      : state.settings
  };
};

export const deleteDocumentFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.documents, id, "Document");

  return {
    ...state,
    documents: state.documents.filter((document) => document.id !== id),
    document_links: state.document_links.filter((link) => link.document_id !== id)
  };
};

export const deleteDocumentLinkFromState = (state: AppState, id: string): AppState => {
  ensureExists(state.document_links, id, "Document link");

  return {
    ...state,
    document_links: state.document_links.filter((link) => link.id !== id)
  };
};
