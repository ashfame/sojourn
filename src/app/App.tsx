import {
  AlertTriangle,
  CalendarDays,
  Database,
  Download,
  FileText,
  Hotel,
  Landmark,
  Map as MapIcon,
  Plane,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  Unlink,
  UploadCloud
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { currentTaxYearStart, localDateTimeToInstant } from "../domain/time";
import type {
  AppState,
  ComputedDayLedger,
  DirectS3Settings,
  DocumentLink,
  LinkableEntityType,
  ManualCorrection,
  PresenceInterval,
  ResidencyDocument,
  StayEvent,
  StorageCapabilityReport,
  TaxYearProfile,
  TravelEvent
} from "../domain/types";
import { getAttachmentBlob } from "../storage/attachments";
import {
  createOAuthPkceSession,
  exchangeAuthorizationCode,
  mintS3Credentials,
  type OAuthPkceConfig,
  type OAuthPkceSession
} from "../storage/oauth";
import { DataWorkerClient } from "../workers/dataWorkerClient";
import { StorageWorkerClient } from "../workers/storageWorkerClient";

type View =
  | "dashboard"
  | "timeline"
  | "events"
  | "documents"
  | "settings"
  | "storage"
  | "export";

const S3_SETTINGS_KEY = "residency-days:s3-settings";
const OAUTH_SESSION_KEY = "residency-days:oauth-pkce-session";

const navItems: Array<{ id: View; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "dashboard", label: "Dashboard", icon: Landmark },
  { id: "timeline", label: "Timeline", icon: CalendarDays },
  { id: "events", label: "Events", icon: Plane },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "settings", label: "Profiles", icon: Settings },
  { id: "storage", label: "S3", icon: Database },
  { id: "export", label: "Export", icon: Download }
];

const uploadLabel: Record<AppState["upload_status"], string> = {
  local: "Saved in browser",
  pending: "Offline changes pending",
  uploading: "Uploading to S3",
  saved_to_s3: "Saved to S3",
  upload_error: "Upload error"
};

const loadStoredS3Settings = (): Partial<DirectS3Settings> => {
  const raw = localStorage.getItem(S3_SETTINGS_KEY);
  if (!raw) {
    return {
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      prefix: "residency-days",
      forcePathStyle: false
    };
  }
  try {
    return JSON.parse(raw) as Partial<DirectS3Settings>;
  } catch {
    return {};
  }
};

const isCompleteS3Settings = (
  settings: Partial<DirectS3Settings>
): settings is DirectS3Settings =>
  Boolean(
    settings.endpoint &&
      settings.bucket &&
      settings.region &&
      settings.accessKeyId &&
      settings.secretAccessKey &&
      typeof settings.prefix === "string" &&
      typeof settings.forcePathStyle === "boolean"
  );

const formatBytes = (value?: number): string => {
  if (!value) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? "B"}`;
};

const downloadBytes = (bytes: Uint8Array, filename: string, type: string): void => {
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadStateBackup = (state: AppState, reason: string): void => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bytes = new TextEncoder().encode(
    JSON.stringify({ reason, exported_at: new Date().toISOString(), state }, null, 2)
  );
  downloadBytes(bytes, `residency-days-${reason}-${timestamp}.json`, "application/json");
};

const entityOptions = (state: AppState): Array<{
  value: string;
  label: string;
  type: LinkableEntityType;
  id: string;
}> => [
  ...state.travel_events.map((event) => ({
    value: `travel_event|${event.id}`,
    label: `Travel: ${event.origin_country} to ${event.destination_country}`,
    type: "travel_event" as const,
    id: event.id
  })),
  ...state.stay_events.map((event) => ({
    value: `stay_event|${event.id}`,
    label: `Stay: ${event.country_code} ${event.city ?? ""}`.trim(),
    type: "stay_event" as const,
    id: event.id
  })),
  ...state.presence_intervals.map((interval) => ({
    value: `presence_interval|${interval.id}`,
    label: `Presence: ${interval.country_code}`,
    type: "presence_interval" as const,
    id: interval.id
  })),
  ...state.manual_corrections.map((correction) => ({
    value: `manual_correction|${correction.id}`,
    label: `Correction: ${correction.country_code} ${correction.date}`,
    type: "manual_correction" as const,
    id: correction.id
  })),
  ...state.tax_year_profiles.map((profile) => ({
    value: `tax_year_profile|${profile.id}`,
    label: `Tax year: ${profile.country_code} ${profile.label}`,
    type: "tax_year_profile" as const,
    id: profile.id
  })),
  ...state.day_count_snapshots.map((snapshot) => ({
    value: `day_count_snapshot|${snapshot.id}`,
    label: `Snapshot: ${snapshot.country_code} ${snapshot.period_start}`,
    type: "day_count_snapshot" as const,
    id: snapshot.id
  }))
];

const findEntityLabel = (
  state: AppState,
  entityType: LinkableEntityType,
  entityId: string
): string => {
  if (entityType === "travel_event") {
    const event = state.travel_events.find((item) => item.id === entityId);
    return event
      ? `Travel: ${event.origin_country} to ${event.destination_country}`
      : `Travel: ${entityId}`;
  }
  if (entityType === "stay_event") {
    const event = state.stay_events.find((item) => item.id === entityId);
    return event ? `Stay: ${event.country_code} ${event.city ?? ""}`.trim() : `Stay: ${entityId}`;
  }
  if (entityType === "presence_interval") {
    const interval = state.presence_intervals.find((item) => item.id === entityId);
    return interval ? `Presence: ${interval.country_code}` : `Presence: ${entityId}`;
  }
  if (entityType === "manual_correction") {
    const correction = state.manual_corrections.find((item) => item.id === entityId);
    return correction
      ? `Correction: ${correction.country_code} ${correction.date}`
      : `Correction: ${entityId}`;
  }
  if (entityType === "tax_year_profile") {
    const profile = state.tax_year_profiles.find((item) => item.id === entityId);
    return profile ? `Profile: ${profile.country_code} ${profile.label}` : `Profile: ${entityId}`;
  }
  const snapshot = state.day_count_snapshots.find((item) => item.id === entityId);
  return snapshot ? `Snapshot: ${snapshot.country_code} ${snapshot.period_start}` : entityId;
};

const formatDateTime = (value?: string): string => {
  if (!value) {
    return "Open";
  }
  return `${value.slice(0, 16).replace("T", " ")}${value.endsWith("Z") ? " UTC" : ""}`;
};

const countryOptions = (state: AppState): string[] =>
  [
    ...new Set([
      ...state.tax_year_profiles.map((profile) => profile.country_code),
      ...state.travel_events.flatMap((event) => [
        event.origin_country,
        event.destination_country
      ]),
      ...state.stay_events.map((event) => event.country_code),
      ...state.presence_intervals.map((interval) => interval.country_code),
      ...state.manual_corrections.map((correction) => correction.country_code)
    ])
  ].sort();

export function App() {
  const dataClient = useMemo(() => new DataWorkerClient(), []);
  const storageClient = useMemo(() => new StorageWorkerClient(), []);
  const [view, setView] = useState<View>("dashboard");
  const [state, setState] = useState<AppState | null>(null);
  const [ledger, setLedger] = useState<ComputedDayLedger | null>(null);
  const [capabilities, setCapabilities] = useState<StorageCapabilityReport | null>(null);
  const [countryCode, setCountryCode] = useState("IN");
  const [profileId, setProfileId] = useState("profile_india_default");
  const [taxYearStart, setTaxYearStart] = useState(new Date().getUTCFullYear());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [s3Settings, setS3Settings] = useState<Partial<DirectS3Settings>>(
    loadStoredS3Settings
  );
  const remoteCheckComplete = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [initialState, detected] = await Promise.all([
        dataClient.init(),
        dataClient.detectCapabilities()
      ]);
      if (!active) {
        return;
      }
      setState(initialState);
      setCapabilities(detected);
      setCountryCode(initialState.settings.selected_country);
      setProfileId(initialState.settings.selected_tax_year_profile_id);
      const profile = initialState.tax_year_profiles.find(
        (item) => item.id === initialState.settings.selected_tax_year_profile_id
      );
      setTaxYearStart(
        profile ? currentTaxYearStart(profile) : initialState.settings.selected_tax_year_start
      );
    })().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
      dataClient.dispose();
      storageClient.dispose();
    };
  }, [dataClient, storageClient]);

  useEffect(() => {
    if (!state || remoteCheckComplete.current || !isCompleteS3Settings(s3Settings)) {
      return;
    }

    remoteCheckComplete.current = true;
    void storageClient
      .getRemoteHead({ settings: s3Settings })
      .then(async (remote) => {
        if (!remote.head) {
          return;
        }
        const remoteGeneration = remote.head.generation;
        const knownRemoteGeneration = state.remote_generation ?? 0;
        if (remoteGeneration <= knownRemoteGeneration) {
          return;
        }

        const hasLocalChanges =
          state.local_generation > knownRemoteGeneration && state.upload_status !== "saved_to_s3";
        if (hasLocalChanges) {
          setMessage(
            `Remote S3 generation ${remoteGeneration} is newer, but local changes are pending. Use S3 restore or export both copies before choosing.`
          );
          return;
        }

        const restored = await storageClient.restoreFromS3({ settings: s3Settings });
        const next = await dataClient.restoreState({
          state: restored.state,
          remoteHeadEtag: restored.headEtag
        });
        setState(next);
        setMessage(`Restored S3 generation ${remoteGeneration}.`);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, [dataClient, s3Settings, state, storageClient]);

  const selectedProfile = useMemo<TaxYearProfile | undefined>(
    () =>
      state?.tax_year_profiles.find((profile) => profile.id === profileId) ??
      state?.tax_year_profiles.find((profile) => profile.country_code === countryCode),
    [countryCode, profileId, state]
  );

  useEffect(() => {
    if (!state || !selectedProfile) {
      return;
    }
    let active = true;
    void dataClient
      .computeLedger({
        profileId: selectedProfile.id,
        countryCode,
        startYear: taxYearStart
      })
      .then((nextLedger) => {
        if (active) {
          setLedger(nextLedger);
        }
      });
    return () => {
      active = false;
    };
  }, [countryCode, dataClient, selectedProfile, state, taxYearStart]);

  const runMutation = async (operation: () => Promise<AppState>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await operation();
      setState(next);
      if (!next.tax_year_profiles.some((profile) => profile.id === profileId)) {
        const fallback = next.tax_year_profiles[0];
        if (fallback) {
          setProfileId(fallback.id);
          setCountryCode(fallback.country_code);
          setTaxYearStart(currentTaxYearStart(fallback));
        }
      }
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <main className="loading-screen">
        <Database size={28} />
        <span>Loading local residency store</span>
      </main>
    );
  }

  const countries = countryOptions(state);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <MapIcon size={28} />
          <div>
            <strong>Residency Days</strong>
            <span>{uploadLabel[state.upload_status]}</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                type="button"
                onClick={() => setView(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="selectors">
            <label>
              Country
              <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                {countries.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tax year
              <select
                value={profileId}
                onChange={(event) => {
                  const nextProfile = state.tax_year_profiles.find(
                    (profile) => profile.id === event.target.value
                  );
                  setProfileId(event.target.value);
                  if (nextProfile) {
                    setCountryCode(nextProfile.country_code);
                  }
                }}
              >
                {state.tax_year_profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.country_code} {profile.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input
                type="number"
                value={taxYearStart}
                onChange={(event) => setTaxYearStart(Number(event.target.value))}
              />
            </label>
          </div>
          <div className={`save-state ${state.upload_status}`}>
            <ShieldCheck size={17} />
            <span>{uploadLabel[state.upload_status]}</span>
          </div>
        </header>

        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}

        {view === "dashboard" && (
          <Dashboard
            state={state}
            ledger={ledger}
            capabilities={capabilities}
            selectedProfile={selectedProfile}
          />
        )}
        {view === "timeline" && <Timeline ledger={ledger} state={state} />}
        {view === "events" && (
          <EventsView
            busy={busy}
            state={state}
            runMutation={runMutation}
            client={dataClient}
          />
        )}
        {view === "documents" && (
          <DocumentsView
            busy={busy}
            state={state}
            runMutation={runMutation}
            client={dataClient}
          />
        )}
        {view === "settings" && (
          <ProfilesView
            busy={busy}
            state={state}
            runMutation={runMutation}
            client={dataClient}
          />
        )}
        {view === "storage" && (
          <StorageView
            busy={busy}
            state={state}
            setState={setState}
            capabilities={capabilities}
            s3Settings={s3Settings}
            setS3Settings={setS3Settings}
            runMutation={runMutation}
            dataClient={dataClient}
            storageClient={storageClient}
          />
        )}
        {view === "export" && (
          <ExportView
            busy={busy}
            state={state}
            ledger={ledger}
            profile={selectedProfile}
            countryCode={countryCode}
            startYear={taxYearStart}
            runMutation={runMutation}
            client={dataClient}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  state,
  ledger,
  capabilities,
  selectedProfile
}: {
  state: AppState;
  ledger: ComputedDayLedger | null;
  capabilities: StorageCapabilityReport | null;
  selectedProfile: TaxYearProfile | undefined;
}) {
  return (
    <section className="page-section">
      <div className="metrics-grid">
        <Metric label="Included days" value={ledger?.included_day_count ?? 0} />
        <Metric label="Ambiguous days" value={ledger?.ambiguous_day_count ?? 0} />
        <Metric
          label="Missing evidence"
          value={ledger?.missing_evidence_day_count ?? 0}
        />
        <Metric label="Evidence files" value={state.documents.length} />
      </div>
      <div className="two-column">
        <section className="panel">
          <h2>Active Profile</h2>
          <dl className="definition-list">
            <dt>Country</dt>
            <dd>{selectedProfile?.country_code ?? "None"}</dd>
            <dt>Boundary</dt>
            <dd>
              {selectedProfile
                ? `${selectedProfile.start_month}/${selectedProfile.start_day}`
                : "None"}
            </dd>
            <dt>Timezone</dt>
            <dd>{selectedProfile?.timezone ?? "None"}</dd>
            <dt>Period</dt>
            <dd>
              {ledger ? `${ledger.period_start} to ${ledger.period_end}` : "Not computed"}
            </dd>
          </dl>
        </section>
        <section className="panel">
          <h2>Browser Storage</h2>
          <dl className="definition-list">
            <dt>OPFS</dt>
            <dd>{capabilities?.opfs ? "Available" : "Unavailable"}</dd>
            <dt>IndexedDB</dt>
            <dd>{capabilities?.indexedDb ? "Available" : "Unavailable"}</dd>
            <dt>Persistent</dt>
            <dd>{capabilities?.storageEstimate?.persisted ? "Granted" : "Not granted"}</dd>
            <dt>Quota</dt>
            <dd>{formatBytes(capabilities?.storageEstimate?.quota)}</dd>
          </dl>
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <section className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function Timeline({ ledger, state }: { ledger: ComputedDayLedger | null; state: AppState }) {
  if (!ledger) {
    return <section className="page-section">No ledger available.</section>;
  }
  const sourceDocuments = new Map(state.documents.map((document) => [document.id, document]));

  return (
    <section className="page-section timeline-layout">
      <div className="timeline-grid" aria-label="Day ledger">
        {ledger.entries.map((entry) => (
          <div
            key={entry.date}
            className={`day-cell ${entry.status} ${entry.is_manual ? "manual" : ""} ${
              entry.missing_evidence ? "missing" : ""
            }`}
            title={`${entry.date}: ${entry.status}`}
          >
            <span>{entry.date.slice(8)}</span>
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>Evidence</h2>
        <div className="evidence-list">
          {ledger.entries
            .filter((entry) => entry.status !== "absent")
            .slice(0, 50)
            .map((entry) => (
              <div key={entry.date} className="evidence-row">
                <span>{entry.date}</span>
                <span>{entry.status}</span>
                <span>
                  {entry.evidence_document_ids
                    .map((id) => sourceDocuments.get(id)?.title ?? id)
                    .join(", ") || "No evidence"}
                </span>
              </div>
            ))}
        </div>
      </section>
    </section>
  );
}

function EventsView({
  busy,
  state,
  runMutation,
  client
}: {
  busy: boolean;
  state: AppState;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <section className="page-section form-grid">
      <TravelForm busy={busy} runMutation={runMutation} client={client} />
      <StayForm busy={busy} runMutation={runMutation} client={client} />
      <PresenceForm busy={busy} runMutation={runMutation} client={client} />
      <CorrectionForm busy={busy} runMutation={runMutation} client={client} />
      <EventRecords
        busy={busy}
        state={state}
        runMutation={runMutation}
        client={client}
      />
    </section>
  );
}

function DeleteButton({
  busy,
  label,
  onDelete
}: {
  busy: boolean;
  label: string;
  onDelete: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      className="danger"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={() => void onDelete()}
    >
      <Trash2 size={16} /> Delete
    </button>
  );
}

function EventRecords({
  busy,
  state,
  runMutation,
  client
}: {
  busy: boolean;
  state: AppState;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  const hasRecords =
    state.travel_events.length > 0 ||
    state.stay_events.length > 0 ||
    state.presence_intervals.length > 0 ||
    state.manual_corrections.length > 0;

  return (
    <section className="panel list-panel wide">
      <h2>
        <CalendarDays size={18} /> Records
      </h2>
      {!hasRecords && <p className="empty-state">No events or corrections recorded.</p>}
      {state.travel_events.length > 0 && (
        <RecordGroup title="Travel">
          {state.travel_events.map((event) => (
            <TravelRecord
              key={event.id}
              busy={busy}
              event={event}
              runMutation={runMutation}
              client={client}
            />
          ))}
        </RecordGroup>
      )}
      {state.stay_events.length > 0 && (
        <RecordGroup title="Stays">
          {state.stay_events.map((event) => (
            <StayRecord
              key={event.id}
              busy={busy}
              event={event}
              runMutation={runMutation}
              client={client}
            />
          ))}
        </RecordGroup>
      )}
      {state.presence_intervals.length > 0 && (
        <RecordGroup title="Presence Intervals">
          {state.presence_intervals.map((interval) => (
            <PresenceRecord
              key={interval.id}
              busy={busy}
              interval={interval}
              runMutation={runMutation}
              client={client}
            />
          ))}
        </RecordGroup>
      )}
      {state.manual_corrections.length > 0 && (
        <RecordGroup title="Manual Corrections">
          {state.manual_corrections.map((correction) => (
            <CorrectionRecord
              key={correction.id}
              busy={busy}
              correction={correction}
              runMutation={runMutation}
              client={client}
            />
          ))}
        </RecordGroup>
      )}
    </section>
  );
}

function RecordGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="record-group">
      <h3>{title}</h3>
      <div className="record-list">{children}</div>
    </div>
  );
}

function TravelRecord({
  busy,
  event,
  runMutation,
  client
}: {
  busy: boolean;
  event: TravelEvent;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <article className="record-row">
      <div>
        <strong>
          {event.origin_country} to {event.destination_country}
        </strong>
        <span>
          {event.type} · Depart {formatDateTime(event.departure_at)} · Arrive{" "}
          {formatDateTime(event.arrival_at)}
        </span>
      </div>
      <span>{event.confidence}</span>
      <DeleteButton
        busy={busy}
        label={`Delete travel event ${event.origin_country} to ${event.destination_country}`}
        onDelete={() =>
          runMutation(() => client.deleteTravelEvent(event.id), "Travel event deleted.")
        }
      />
    </article>
  );
}

function StayRecord({
  busy,
  event,
  runMutation,
  client
}: {
  busy: boolean;
  event: StayEvent;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <article className="record-row">
      <div>
        <strong>
          {event.country_code} {event.city ?? ""}
        </strong>
        <span>
          {event.type} · {event.check_in_date} to {event.check_out_date || "Open"}
        </span>
      </div>
      <span>{event.provider || event.booking_reference || "Stay"}</span>
      <DeleteButton
        busy={busy}
        label={`Delete stay event ${event.country_code} ${event.check_in_date}`}
        onDelete={() => runMutation(() => client.deleteStayEvent(event.id), "Stay event deleted.")}
      />
    </article>
  );
}

function PresenceRecord({
  busy,
  interval,
  runMutation,
  client
}: {
  busy: boolean;
  interval: PresenceInterval;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <article className="record-row">
      <div>
        <strong>{interval.country_code} presence</strong>
        <span>
          {formatDateTime(interval.start_at)} to {formatDateTime(interval.end_at)}
        </span>
      </div>
      <span>{interval.is_manual ? "Manual" : interval.source_type}</span>
      <DeleteButton
        busy={busy}
        label={`Delete presence interval ${interval.country_code}`}
        onDelete={() =>
          runMutation(() => client.deletePresenceInterval(interval.id), "Presence interval deleted.")
        }
      />
    </article>
  );
}

function CorrectionRecord({
  busy,
  correction,
  runMutation,
  client
}: {
  busy: boolean;
  correction: ManualCorrection;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <article className="record-row">
      <div>
        <strong>
          {correction.country_code} {correction.date}
        </strong>
        <span>{correction.reason}</span>
      </div>
      <span>{correction.day_status}</span>
      <DeleteButton
        busy={busy}
        label={`Delete manual correction ${correction.country_code} ${correction.date}`}
        onDelete={() =>
          runMutation(
            () => client.deleteManualCorrection(correction.id),
            "Manual correction deleted."
          )
        }
      />
    </article>
  );
}

function TravelForm({
  busy,
  runMutation,
  client
}: {
  busy: boolean;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <form
      className="panel form-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const departureTimezone = String(data.get("departure_timezone"));
        const arrivalTimezone = String(data.get("arrival_timezone"));
        const arrivalValue = String(data.get("arrival_at") ?? "");
        void runMutation(
          () =>
            client.addTravelEvent({
              type: String(data.get("type")) as "flight",
              origin_country: String(data.get("origin_country")).toUpperCase(),
              origin_city: String(data.get("origin_city") ?? ""),
              destination_country: String(data.get("destination_country")).toUpperCase(),
              destination_city: String(data.get("destination_city") ?? ""),
              departure_at: localDateTimeToInstant(
                String(data.get("departure_at")),
                departureTimezone
              ),
              departure_timezone: departureTimezone,
              arrival_at: arrivalValue
                ? localDateTimeToInstant(arrivalValue, arrivalTimezone)
                : undefined,
              arrival_timezone: arrivalValue ? arrivalTimezone : undefined,
              carrier: String(data.get("carrier") ?? ""),
              booking_reference: String(data.get("booking_reference") ?? ""),
              notes: String(data.get("notes") ?? ""),
              confidence: String(data.get("confidence")) as "high"
            }),
          "Travel event saved."
        ).then(() => form.reset());
      }}
    >
      <h2>
        <Plane size={18} /> Travel
      </h2>
      <div className="field-row">
        <label>
          Type
          <select name="type" defaultValue="flight">
            <option value="flight">Flight</option>
            <option value="train">Train</option>
            <option value="border_crossing">Border</option>
            <option value="ferry">Ferry</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Confidence
          <select name="confidence" defaultValue="high">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="ambiguous">Ambiguous</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <label>
          Origin country
          <input name="origin_country" required maxLength={2} placeholder="IN" />
        </label>
        <label>
          Destination country
          <input name="destination_country" required maxLength={2} placeholder="AE" />
        </label>
      </div>
      <div className="field-row">
        <label>
          Origin city
          <input name="origin_city" />
        </label>
        <label>
          Destination city
          <input name="destination_city" />
        </label>
      </div>
      <div className="field-row">
        <label>
          Departure
          <input name="departure_at" type="datetime-local" required />
        </label>
        <label>
          Departure timezone
          <input name="departure_timezone" defaultValue="Asia/Kolkata" required />
        </label>
      </div>
      <div className="field-row">
        <label>
          Arrival
          <input name="arrival_at" type="datetime-local" />
        </label>
        <label>
          Arrival timezone
          <input name="arrival_timezone" defaultValue="Asia/Dubai" />
        </label>
      </div>
      <div className="field-row">
        <label>
          Carrier
          <input name="carrier" />
        </label>
        <label>
          Booking ref
          <input name="booking_reference" />
        </label>
      </div>
      <label>
        Notes
        <textarea name="notes" rows={2} />
      </label>
      <button type="submit" disabled={busy}>
        <Plus size={16} /> Save travel
      </button>
    </form>
  );
}

function StayForm({
  busy,
  runMutation,
  client
}: {
  busy: boolean;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <form
      className="panel form-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void runMutation(
          () =>
            client.addStayEvent({
              type: String(data.get("type")) as "hotel",
              country_code: String(data.get("country_code")).toUpperCase(),
              city: String(data.get("city") ?? ""),
              check_in_date: String(data.get("check_in_date")),
              check_out_date: String(data.get("check_out_date") || ""),
              timezone: String(data.get("timezone")),
              provider: String(data.get("provider") ?? ""),
              booking_reference: String(data.get("booking_reference") ?? ""),
              notes: String(data.get("notes") ?? "")
            }),
          "Stay event saved."
        ).then(() => form.reset());
      }}
    >
      <h2>
        <Hotel size={18} /> Stay
      </h2>
      <div className="field-row">
        <label>
          Type
          <select name="type" defaultValue="hotel">
            <option value="hotel">Hotel</option>
            <option value="lease">Lease</option>
            <option value="home">Home</option>
            <option value="family">Family</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Country
          <input name="country_code" required maxLength={2} placeholder="IN" />
        </label>
      </div>
      <div className="field-row">
        <label>
          Check in
          <input name="check_in_date" type="date" required />
        </label>
        <label>
          Check out
          <input name="check_out_date" type="date" />
        </label>
      </div>
      <div className="field-row">
        <label>
          City
          <input name="city" />
        </label>
        <label>
          Timezone
          <input name="timezone" defaultValue="Asia/Kolkata" required />
        </label>
      </div>
      <div className="field-row">
        <label>
          Provider
          <input name="provider" />
        </label>
        <label>
          Booking ref
          <input name="booking_reference" />
        </label>
      </div>
      <label>
        Notes
        <textarea name="notes" rows={2} />
      </label>
      <button type="submit" disabled={busy}>
        <Plus size={16} /> Save stay
      </button>
    </form>
  );
}

function PresenceForm({
  busy,
  runMutation,
  client
}: {
  busy: boolean;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <form
      className="panel form-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const timezone = String(data.get("timezone"));
        const endValue = String(data.get("end_at") ?? "");
        void runMutation(
          () =>
            client.addPresenceInterval({
              country_code: String(data.get("country_code")).toUpperCase(),
              start_at: localDateTimeToInstant(String(data.get("start_at")), timezone),
              end_at: endValue ? localDateTimeToInstant(endValue, timezone) : undefined,
              timezone,
              source_type: "manual",
              confidence: String(data.get("confidence")) as "high",
              is_manual: true,
              notes: String(data.get("notes") ?? "")
            }),
          "Presence interval saved."
        ).then(() => form.reset());
      }}
    >
      <h2>
        <MapIcon size={18} /> Presence
      </h2>
      <div className="field-row">
        <label>
          Country
          <input name="country_code" required maxLength={2} placeholder="IN" />
        </label>
        <label>
          Confidence
          <select name="confidence" defaultValue="high">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="ambiguous">Ambiguous</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <label>
          Start
          <input name="start_at" type="datetime-local" required />
        </label>
        <label>
          End
          <input name="end_at" type="datetime-local" />
        </label>
      </div>
      <label>
        Timezone
        <input name="timezone" defaultValue="Asia/Kolkata" required />
      </label>
      <label>
        Notes
        <textarea name="notes" rows={2} />
      </label>
      <button type="submit" disabled={busy}>
        <Plus size={16} /> Save interval
      </button>
    </form>
  );
}

function CorrectionForm({
  busy,
  runMutation,
  client
}: {
  busy: boolean;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <form
      className="panel form-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void runMutation(
          () =>
            client.addManualCorrection({
              country_code: String(data.get("country_code")).toUpperCase(),
              date: String(data.get("date")),
              timezone: String(data.get("timezone")),
              day_status: String(data.get("day_status")) as "present",
              reason: String(data.get("reason"))
            }),
          "Manual correction saved."
        ).then(() => form.reset());
      }}
    >
      <h2>
        <AlertTriangle size={18} /> Correction
      </h2>
      <div className="field-row">
        <label>
          Country
          <input name="country_code" required maxLength={2} placeholder="IN" />
        </label>
        <label>
          Date
          <input name="date" type="date" required />
        </label>
      </div>
      <div className="field-row">
        <label>
          Status
          <select name="day_status" defaultValue="present">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="ambiguous">Ambiguous</option>
          </select>
        </label>
        <label>
          Timezone
          <input name="timezone" defaultValue="Asia/Kolkata" required />
        </label>
      </div>
      <label>
        Reason
        <textarea name="reason" rows={3} required />
      </label>
      <button type="submit" disabled={busy}>
        <Plus size={16} /> Save correction
      </button>
    </form>
  );
}

function DocumentsView({
  busy,
  state,
  runMutation,
  client
}: {
  busy: boolean;
  state: AppState;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  const options = entityOptions(state);

  const openDocument = async (document: ResidencyDocument) => {
    const blob = await getAttachmentBlob(
      document.local_storage_backend,
      document.local_storage_key
    );
    if (!blob) {
      return;
    }
    window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
  };

  return (
    <section className="page-section">
      <form
        className="panel form-panel wide"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const file = data.get("file");
          if (!(file instanceof File)) {
            return;
          }
          const linkValue = String(data.get("link") ?? "");
          const [entityType, entityId] = linkValue.split("|") as [
            LinkableEntityType | undefined,
            string | undefined
          ];
          void file.arrayBuffer().then((bytes) =>
            runMutation(
              () =>
                client.importDocument({
                  title: String(data.get("title") || file.name),
                  kind: String(data.get("kind")) as ResidencyDocument["kind"],
                  mime_type: file.type || "application/octet-stream",
                  capture_date: String(data.get("capture_date") || ""),
                  bytes,
                  link:
                    entityType && entityId
                      ? {
                          entity_type: entityType,
                          entity_id: entityId,
                          relationship: "evidence"
                        }
                      : undefined
                }),
              "Document imported."
            ).then(() => form.reset())
          );
        }}
      >
        <h2>
          <FileText size={18} /> Import Evidence
        </h2>
        <div className="field-row three">
          <label>
            File
            <input name="file" type="file" required />
          </label>
          <label>
            Title
            <input name="title" />
          </label>
          <label>
            Capture date
            <input name="capture_date" type="date" />
          </label>
        </div>
        <div className="field-row">
          <label>
            Kind
            <select name="kind" defaultValue="boarding_pass">
              <option value="passport_stamp">Passport stamp</option>
              <option value="boarding_pass">Boarding pass</option>
              <option value="ticket">Ticket</option>
              <option value="hotel_invoice">Hotel invoice</option>
              <option value="lease">Lease</option>
              <option value="visa">Visa</option>
              <option value="tax_doc">Tax doc</option>
              <option value="bank_statement">Bank statement</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Link
            <select name="link" defaultValue="">
              <option value="">Unlinked</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy}>
          <Plus size={16} /> Import document
        </button>
      </form>

      <section className="panel list-panel">
        <h2>
          <FileText size={18} /> Documents
        </h2>
        {state.documents.length === 0 && <p className="empty-state">No documents imported.</p>}
        <div className="record-list">
          {state.documents.map((document) => {
            const linkedCount = state.document_links.filter(
              (link) => link.document_id === document.id
            ).length;
            return (
              <article key={document.id} className="record-row document-record">
                <div>
                  <strong>{document.title}</strong>
                  <span>
                    {document.kind} · {formatBytes(document.size_bytes)} ·{" "}
                    {linkedCount} {linkedCount === 1 ? "link" : "links"}
                  </span>
                  <code>{document.sha256.slice(0, 16)}</code>
                </div>
                <span>{document.upload_status}</span>
                <div className="row-actions">
                  <button type="button" onClick={() => void openDocument(document)}>
                    <FileText size={16} /> Open
                  </button>
                  <DeleteButton
                    busy={busy}
                    label={`Delete document ${document.title}`}
                    onDelete={() =>
                      runMutation(
                        () => client.deleteDocument(document.id),
                        "Document deleted."
                      )
                    }
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel list-panel">
        <h2>
          <Unlink size={18} /> Evidence Links
        </h2>
        {state.document_links.length === 0 && (
          <p className="empty-state">No document links recorded.</p>
        )}
        <div className="record-list">
          {state.document_links.map((link) => (
            <DocumentLinkRecord
              key={link.id}
              busy={busy}
              link={link}
              state={state}
              runMutation={runMutation}
              client={client}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function DocumentLinkRecord({
  busy,
  link,
  state,
  runMutation,
  client
}: {
  busy: boolean;
  link: DocumentLink;
  state: AppState;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  const document = state.documents.find((item) => item.id === link.document_id);

  return (
    <article className="record-row">
      <div>
        <strong>{document?.title ?? link.document_id}</strong>
        <span>
          {findEntityLabel(state, link.entity_type, link.entity_id)} · {link.relationship}
        </span>
      </div>
      <span>{link.entity_type}</span>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() =>
          void runMutation(() => client.deleteDocumentLink(link.id), "Evidence link removed.")
        }
      >
        <Unlink size={16} /> Unlink
      </button>
    </article>
  );
}

function ProfilesView({
  busy,
  state,
  runMutation,
  client
}: {
  busy: boolean;
  state: AppState;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <section className="page-section">
      <form
        className="panel form-panel wide"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void runMutation(
            () =>
              client.addTaxYearProfile({
                country_code: String(data.get("country_code")).toUpperCase(),
                label: String(data.get("label")),
                start_month: Number(data.get("start_month")),
                start_day: Number(data.get("start_day")),
                timezone: String(data.get("timezone")),
                reporting_currency: String(data.get("reporting_currency") || "")
              }),
            "Tax-year profile saved."
          ).then(() => form.reset());
        }}
      >
        <h2>
          <Settings size={18} /> Tax-Year Profile
        </h2>
        <div className="field-row three">
          <label>
            Country
            <input name="country_code" maxLength={2} required />
          </label>
          <label>
            Label
            <input name="label" required />
          </label>
          <label>
            Currency
            <input name="reporting_currency" maxLength={3} />
          </label>
        </div>
        <div className="field-row three">
          <label>
            Start month
            <input name="start_month" type="number" min={1} max={12} required />
          </label>
          <label>
            Start day
            <input name="start_day" type="number" min={1} max={31} required />
          </label>
          <label>
            Timezone
            <input name="timezone" defaultValue="UTC" required />
          </label>
        </div>
        <button type="submit" disabled={busy}>
          <Plus size={16} /> Save profile
        </button>
      </form>
      <section className="panel list-panel">
        <h2>
          <Settings size={18} /> Existing Profiles
        </h2>
        <div className="record-list">
          {state.tax_year_profiles.map((profile) => (
            <article key={profile.id} className="record-row">
              <div>
                <strong>
                  {profile.country_code} {profile.label}
                </strong>
                <span>
                  Starts {profile.start_month}/{profile.start_day} · {profile.timezone}
                  {profile.reporting_currency ? ` · ${profile.reporting_currency}` : ""}
                </span>
              </div>
              <span>
                {state.settings.selected_tax_year_profile_id === profile.id
                  ? "Default"
                  : "Profile"}
              </span>
              <DeleteButton
                busy={busy || state.tax_year_profiles.length <= 1}
                label={`Delete tax-year profile ${profile.country_code} ${profile.label}`}
                onDelete={() =>
                  runMutation(
                    () => client.deleteTaxYearProfile(profile.id),
                    "Tax-year profile deleted."
                  )
                }
              />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function StorageView({
  busy,
  state,
  setState,
  capabilities,
  s3Settings,
  setS3Settings,
  runMutation,
  dataClient,
  storageClient
}: {
  busy: boolean;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState | null>>;
  capabilities: StorageCapabilityReport | null;
  s3Settings: Partial<DirectS3Settings>;
  setS3Settings: React.Dispatch<React.SetStateAction<Partial<DirectS3Settings>>>;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  dataClient: DataWorkerClient;
  storageClient: StorageWorkerClient;
}) {
  return (
    <section className="page-section">
      <form
        className="panel form-panel wide"
        onSubmit={(event) => {
          event.preventDefault();
          localStorage.setItem(S3_SETTINGS_KEY, JSON.stringify(s3Settings));
        }}
      >
        <h2>
          <UploadCloud size={18} /> Direct S3
        </h2>
        <div className="field-row three">
          <label>
            Endpoint
            <input
              value={s3Settings.endpoint ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({ ...settings, endpoint: event.target.value }))
              }
            />
          </label>
          <label>
            Bucket
            <input
              value={s3Settings.bucket ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({ ...settings, bucket: event.target.value }))
              }
            />
          </label>
          <label>
            Region
            <input
              value={s3Settings.region ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({ ...settings, region: event.target.value }))
              }
            />
          </label>
        </div>
        <div className="field-row three">
          <label>
            Prefix
            <input
              value={s3Settings.prefix ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({ ...settings, prefix: event.target.value }))
              }
            />
          </label>
          <label>
            Access key
            <input
              value={s3Settings.accessKeyId ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({
                  ...settings,
                  accessKeyId: event.target.value
                }))
              }
            />
          </label>
          <label>
            Secret key
            <input
              type="password"
              value={s3Settings.secretAccessKey ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({
                  ...settings,
                  secretAccessKey: event.target.value
                }))
              }
            />
          </label>
        </div>
        <div className="field-row">
          <label>
            Session token
            <input
              value={s3Settings.sessionToken ?? ""}
              onChange={(event) =>
                setS3Settings((settings) => ({
                  ...settings,
                  sessionToken: event.target.value
                }))
              }
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(s3Settings.forcePathStyle)}
              onChange={(event) =>
                setS3Settings((settings) => ({
                  ...settings,
                  forcePathStyle: event.target.checked
                }))
              }
            />
            Path-style URLs
          </label>
        </div>
        <div className="button-row">
          <button type="submit">
            <ShieldCheck size={16} /> Save settings
          </button>
          <button
            type="button"
            disabled={busy || !isCompleteS3Settings(s3Settings)}
            onClick={() => {
              if (!isCompleteS3Settings(s3Settings)) {
                return;
              }
              void runMutation(async () => {
                try {
                  const uploading = await dataClient.markUploading();
                  setState(uploading);
                  const result = await storageClient.uploadToS3({
                    state: uploading,
                    settings: s3Settings,
                    expectedHeadEtag: uploading.remote_head_etag
                  });
                  return await dataClient.markUploadSuccess({
                    remoteGeneration: result.head.generation,
                    remoteHeadEtag: result.headEtag
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  await dataClient.markUploadError(message);
                  throw error;
                }
              }, "S3 head advanced.");
            }}
          >
            <UploadCloud size={16} /> Upload now
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy || !isCompleteS3Settings(s3Settings)}
            onClick={() => {
              if (!isCompleteS3Settings(s3Settings)) {
                return;
              }
              if (
                !window.confirm(
                  "Overwrite the remote S3 head with this browser state? This keeps older S3 generations but advances head.json."
                )
              ) {
                return;
              }
              downloadStateBackup(state, "pre-overwrite");
              void runMutation(async () => {
                try {
                  const uploading = await dataClient.markUploading();
                  setState(uploading);
                  const result = await storageClient.uploadToS3({
                    state: uploading,
                    settings: s3Settings,
                    forceOverwrite: true
                  });
                  return await dataClient.markUploadSuccess({
                    remoteGeneration: result.head.generation,
                    remoteHeadEtag: result.headEtag
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  await dataClient.markUploadError(message);
                  throw error;
                }
              }, "S3 head overwritten.");
            }}
          >
            <UploadCloud size={16} /> Overwrite remote
          </button>
          <button
            type="button"
            disabled={busy || !isCompleteS3Settings(s3Settings)}
            onClick={() => {
              if (!isCompleteS3Settings(s3Settings)) {
                return;
              }
              if (!window.confirm("Restore browser data from S3 head.json?")) {
                return;
              }
              void runMutation(async () => {
                if (state.local_generation > 0) {
                  downloadStateBackup(state, "pre-restore");
                }
                const result = await storageClient.restoreFromS3({ settings: s3Settings });
                return dataClient.restoreState({
                  state: result.state,
                  remoteHeadEtag: result.headEtag
                });
              }, "S3 state restored.");
            }}
          >
            <Download size={16} /> Restore
          </button>
          <button
            type="button"
            onClick={() => downloadStateBackup(state, "local-review")}
          >
            <Download size={16} /> Export local state
          </button>
        </div>
      </form>
      <section className="panel">
        <h2>Browser Capability Guidance</h2>
        <CapabilityList capabilities={capabilities} />
        <div className="button-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void runMutation(async () => {
                await dataClient.requestPersistentStorage();
                return dataClient.getState();
              }, "Persistent browser storage requested.");
            }}
          >
            <ShieldCheck size={16} /> Request persistence
          </button>
        </div>
      </section>
      <CredentialMintForm setS3Settings={setS3Settings} />
      <section className="panel">
        <h2>Remote State</h2>
        <dl className="definition-list">
          <dt>Local generation</dt>
          <dd>{state.local_generation}</dd>
          <dt>Remote generation</dt>
          <dd>{state.remote_generation ?? "None"}</dd>
          <dt>Last upload</dt>
          <dd>{state.last_uploaded_at ?? "Never"}</dd>
          <dt>Head ETag</dt>
          <dd>{state.remote_head_etag ?? "None"}</dd>
        </dl>
      </section>
    </section>
  );
}

function CapabilityList({
  capabilities
}: {
  capabilities: StorageCapabilityReport | null;
}) {
  const rows = [
    {
      label: "Web workers",
      ok: Boolean(capabilities?.webWorker),
      detail: "Required for the data and storage workers."
    },
    {
      label: "IndexedDB",
      ok: Boolean(capabilities?.indexedDb),
      detail: "Required fallback for state and attachments."
    },
    {
      label: "Web Crypto",
      ok: Boolean(capabilities?.webCrypto),
      detail: "Required for hashes, PKCE, and S3 signing."
    },
    {
      label: "OPFS",
      ok: Boolean(capabilities?.opfs),
      detail: "Preferred for SQLite and attachment file storage."
    },
    {
      label: "Cross-origin isolated",
      ok: Boolean(capabilities?.crossOriginIsolated),
      detail: "Required for SQLite WASM OPFS mode."
    },
    {
      label: "Persistent storage",
      ok: Boolean(capabilities?.storageEstimate?.persisted),
      detail: "Recommended so browser cleanup does not remove local cache."
    }
  ];

  return (
    <div className="capability-list">
      {rows.map((row) => (
        <div key={row.label} className={row.ok ? "capability ok" : "capability warn"}>
          <span>{row.ok ? "OK" : "Check"}</span>
          <strong>{row.label}</strong>
          <p>{row.detail}</p>
        </div>
      ))}
    </div>
  );
}

function CredentialMintForm({
  setS3Settings
}: {
  setS3Settings: React.Dispatch<React.SetStateAction<Partial<DirectS3Settings>>>;
}) {
  const [authUrl, setAuthUrl] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const readStoredSession = (): OAuthPkceSession => {
    const raw = localStorage.getItem(OAUTH_SESSION_KEY);
    if (!raw) {
      throw new Error("Create an OAuth authorization URL first.");
    }
    return JSON.parse(raw) as OAuthPkceSession;
  };

  return (
    <form
      className="panel form-panel wide"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const config: OAuthPkceConfig = {
          authorizationEndpoint: String(data.get("authorizationEndpoint")),
          tokenEndpoint: String(data.get("tokenEndpoint")),
          clientId: String(data.get("clientId")),
          redirectUri: String(data.get("redirectUri")),
          scope: String(data.get("scope")),
          credentialMintEndpoint: String(data.get("credentialMintEndpoint")),
          audience: String(data.get("audience") || "")
        };
        setBusy(true);
        void createOAuthPkceSession(config)
          .then((session) => {
            localStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify(session));
            setAuthUrl(session.authorizationUrl);
            setStatus("OAuth URL created.");
          })
          .catch((error: unknown) => {
            setStatus(error instanceof Error ? error.message : String(error));
          })
          .finally(() => setBusy(false));
      }}
    >
      <h2>
        <ShieldCheck size={18} /> OAuth Credential Minting
      </h2>
      <div className="field-row three">
        <label>
          Authorization endpoint
          <input name="authorizationEndpoint" placeholder="https://issuer/authorize" />
        </label>
        <label>
          Token endpoint
          <input name="tokenEndpoint" placeholder="https://issuer/oauth/token" />
        </label>
        <label>
          Credential endpoint
          <input name="credentialMintEndpoint" placeholder="https://api.example/s3" />
        </label>
      </div>
      <div className="field-row three">
        <label>
          Client ID
          <input name="clientId" />
        </label>
        <label>
          Redirect URI
          <input name="redirectUri" defaultValue={window.location.origin} />
        </label>
        <label>
          Scope
          <input name="scope" defaultValue="openid profile" />
        </label>
      </div>
      <label>
        Audience
        <input name="audience" />
      </label>
      <div className="button-row">
        <button type="submit" disabled={busy}>
          <ShieldCheck size={16} /> Create OAuth URL
        </button>
        {authUrl && (
          <a className="link-button" href={authUrl} target="_blank" rel="noreferrer">
            Open authorization
          </a>
        )}
      </div>
      <div className="field-row three">
        <label>
          Authorization code
          <input name="authorizationCode" />
        </label>
        <label>
          Returned state
          <input name="returnedState" />
        </label>
        <div className="button-align">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const form = document.activeElement?.closest("form") ?? undefined;
              const formData = form ? new FormData(form) : new FormData();
              const code = String(formData.get("authorizationCode") || "");
              const returnedState = String(formData.get("returnedState") || "");
              setBusy(true);
              void exchangeAuthorizationCode(readStoredSession(), code, returnedState)
                .then((token) =>
                  mintS3Credentials(readStoredSession().config.credentialMintEndpoint, token.access_token)
                )
                .then((settings) => {
                  setS3Settings(settings);
                  localStorage.setItem(S3_SETTINGS_KEY, JSON.stringify(settings));
                  setStatus("S3 credentials minted.");
                })
                .catch((error: unknown) => {
                  setStatus(error instanceof Error ? error.message : String(error));
                })
                .finally(() => setBusy(false));
            }}
          >
            <Download size={16} /> Exchange code
          </button>
        </div>
      </div>
      {status && <p className="inline-status">{status}</p>}
    </form>
  );
}

function ExportView({
  busy,
  state,
  ledger,
  profile,
  countryCode,
  startYear,
  runMutation,
  client
}: {
  busy: boolean;
  state: AppState;
  ledger: ComputedDayLedger | null;
  profile: TaxYearProfile | undefined;
  countryCode: string;
  startYear: number;
  runMutation: (operation: () => Promise<AppState>, success: string) => Promise<void>;
  client: DataWorkerClient;
}) {
  return (
    <section className="page-section">
      <section className="panel">
        <h2>Tax Residency Package</h2>
        <dl className="definition-list">
          <dt>Country</dt>
          <dd>{countryCode}</dd>
          <dt>Included days</dt>
          <dd>{ledger?.included_day_count ?? 0}</dd>
          <dt>Evidence files</dt>
          <dd>{state.documents.length}</dd>
        </dl>
        <div className="button-row">
          <button
            type="button"
            disabled={busy || !profile}
            onClick={() => {
              if (!profile) {
                return;
              }
              void client
                .exportPackage({
                  profileId: profile.id,
                  countryCode,
                  startYear
                })
                .then((bytes) =>
                  downloadBytes(
                    bytes,
                    `residency-package-${countryCode}-${startYear}.zip`,
                    "application/zip"
                  )
                );
            }}
          >
            <Download size={16} /> Download package
          </button>
          <button
            type="button"
            disabled={busy || !profile}
            onClick={() => {
              if (!profile) {
                return;
              }
              void runMutation(
                () =>
                  client.createSnapshot({
                    profileId: profile.id,
                    countryCode,
                    startYear
                  }),
                "Day-count snapshot saved."
              );
            }}
          >
            <Plus size={16} /> Save snapshot
          </button>
          <button
            type="button"
            disabled={busy}
            className="danger"
            onClick={() => {
              if (window.confirm("Reset all browser data for this app?")) {
                void runMutation(() => client.reset(), "Browser data reset.");
              }
            }}
          >
            <RotateCcw size={16} /> Reset app
          </button>
        </div>
      </section>
    </section>
  );
}
