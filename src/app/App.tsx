import {
  BadgeCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  FileText,
  IdCard,
  Plane,
  Plus,
  Settings,
  Stamp,
  Target,
  Ticket,
  Upload,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { countryInitials, countryName } from "../domain/countries";
import { formatDateRange, todayString } from "../domain/dates";
import { evidenceLabel } from "../domain/evidence";
import { createId } from "../domain/seed";
import {
  computeRuleProgress,
  createTimeline,
  describeRuleWindow,
  formatStayTitle,
  projectionStay,
  ruleAsOfDate,
  timelineSummary
} from "../domain/rules";
import type {
  AppData,
  EvidenceItem,
  EvidenceType,
  ProjectionInput,
  RuleProgress,
  Stay,
  TimelineStay
} from "../domain/types";
import { createIndexedDbStorage } from "../storage/indexedDbStorage";
import type { StorageDriver, StorageMetadata } from "../storage/storageDriver";

const storage: StorageDriver = createIndexedDbStorage();

const evidenceIcons: Record<EvidenceType, ComponentType<{ size?: number }>> = {
  visa: IdCard,
  flight_ticket: Plane,
  boarding_pass: Ticket,
  flight_confirmation_certificate: BadgeCheck,
  accommodation: Building2,
  entry_stamp: Stamp,
  other: FileText
};

const countryOptions = ["AE", "IN", "NP", "ES", "PL", "FR", "DE", "IT", "NL", "PT"];

const defaultProjection: ProjectionInput = {
  country: "NP",
  entryDate: "2026-08-01",
  exitDate: "2026-11-15",
  label: "Aug-Nov sabbatical"
};

const formatSavedAt = (value?: string): string => {
  if (!value) {
    return "Not saved yet";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [metadata, setMetadata] = useState<StorageMetadata>({ backend: "indexeddb" });
  const [expandedStayIds, setExpandedStayIds] = useState<Set<string>>(new Set(["stay_spain_2026"]));
  const [showStayForm, setShowStayForm] = useState(false);
  const [proofStayId, setProofStayId] = useState<string | null>(null);
  const [projection, setProjection] = useState<ProjectionInput>(defaultProjection);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let active = true;
    void storage
      .load()
      .then((snapshot) => {
        if (!active) {
          return;
        }
        setData(snapshot.data);
        setMetadata(snapshot.metadata);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const asOf = todayString();
  const timeline = useMemo(() => (data ? createTimeline(data, asOf) : []), [asOf, data]);
  const progress = useMemo(() => (data ? computeRuleProgress(data, asOf) : []), [asOf, data]);
  const projectedStay = useMemo(() => {
    try {
      return projectionStay(projection);
    } catch {
      return undefined;
    }
  }, [projection]);
  const projectionProgress = useMemo(() => {
    if (!data || !projectedStay) {
      return [];
    }
    return computeRuleProgress(data, ruleAsOfDate([projectedStay], asOf), [projectedStay]);
  }, [asOf, data, projectedStay]);

  const saveData = async (next: AppData, savedMessage: string): Promise<void> => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    const nextMetadata = await storage.save(stamped);
    setData(stamped);
    setMetadata(nextMetadata);
    setMessage(savedMessage);
  };

  const toggleStay = (id: string): void => {
    setExpandedStayIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const addStay = (form: HTMLFormElement): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    const now = new Date().toISOString();
    const stay: Stay = {
      id: createId("stay"),
      country: String(formData.get("country") ?? "AE").toUpperCase(),
      entryDate: String(formData.get("entryDate")),
      exitDate: String(formData.get("exitDate") || "") || undefined,
      label: String(formData.get("label") || "") || undefined,
      createdAt: now,
      updatedAt: now
    };
    void saveData({ ...data, stays: [...data.stays, stay] }, "Stay added.");
    form.reset();
    setShowStayForm(false);
  };

  const addEvidence = (form: HTMLFormElement, stayId: string): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    const file = formData.get("file");
    const evidence: EvidenceItem = {
      id: createId("evidence"),
      stayId,
      type: String(formData.get("type")) as EvidenceType,
      title: String(formData.get("title") || (file instanceof File ? file.name : "Evidence")),
      date: String(formData.get("date") || "") || undefined,
      fileName: file instanceof File && file.name ? file.name : undefined,
      mimeType: file instanceof File && file.type ? file.type : undefined,
      sizeBytes: file instanceof File ? file.size : undefined,
      createdAt: new Date().toISOString()
    };
    void saveData({ ...data, evidence: [...data.evidence, evidence] }, "Evidence added.");
    form.reset();
    setProofStayId(null);
    setExpandedStayIds((current) => new Set(current).add(stayId));
  };

  const updateSettings = (form: HTMLFormElement): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    void saveData(
      {
        ...data,
        settings: {
          homeBaseCountry: String(formData.get("homeBaseCountry") ?? "AE").toUpperCase(),
          nationality: String(formData.get("nationality") ?? "IN").toUpperCase(),
          legalResidence: String(formData.get("legalResidence") ?? "AE").toUpperCase(),
          countEntryExitDays: formData.get("countEntryExitDays") === "on"
        }
      },
      "Settings saved."
    );
  };

  if (!data) {
    return (
      <main className="loading-screen">
        <CalendarDays size={28} />
        <span>Loading Sojourn</span>
        {message && <p>{message}</p>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Sojourn</p>
          <h1>Timeline</h1>
          <p>{timelineSummary(timeline)}</p>
        </div>
        <button type="button" onClick={() => setShowStayForm((value) => !value)}>
          {showStayForm ? <X size={17} /> : <Plus size={17} />}
          {showStayForm ? "Close" : "Add stay"}
        </button>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      <section className="target-strip" aria-label="Residency targets">
        {progress.map((item) => (
          <TargetCard key={item.rule.id} progress={item} />
        ))}
      </section>

      {showStayForm && (
        <section className="panel">
          <h2>
            <Plus size={18} /> Add stay
          </h2>
          <form
            className="stay-form"
            onSubmit={(event) => {
              event.preventDefault();
              addStay(event.currentTarget);
            }}
          >
            <label>
              Country
              <select name="country" defaultValue="AE">
                {countryOptions.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Entry
              <input name="entryDate" type="date" required />
            </label>
            <label>
              Exit
              <input name="exitDate" type="date" />
            </label>
            <label>
              Label
              <input name="label" placeholder="City, trip, or reason" />
            </label>
            <button type="submit">
              <Plus size={16} /> Save stay
            </button>
          </form>
        </section>
      )}

      <section className="timeline-section" aria-label="Stay timeline">
        <div className="timeline-line" aria-hidden="true" />
        {timeline.map((stay) => (
          <StayRow
            key={stay.id}
            stay={stay}
            expanded={expandedStayIds.has(stay.id)}
            onToggle={() => toggleStay(stay.id)}
            addingProof={proofStayId === stay.id}
            onAddProof={() => setProofStayId(stay.id)}
            onCancelProof={() => setProofStayId(null)}
            onSaveProof={(form) => addEvidence(form, stay.id)}
          />
        ))}
      </section>

      <ProjectionPanel
        projection={projection}
        setProjection={setProjection}
        progress={projectionProgress}
      />

      <section className="panel settings-panel">
        <h2>
          <Settings size={18} /> Settings
        </h2>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            updateSettings(event.currentTarget);
          }}
        >
          <label>
            Home base
            <select name="homeBaseCountry" defaultValue={data.settings.homeBaseCountry}>
              {countryOptions.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nationality
            <select name="nationality" defaultValue={data.settings.nationality}>
              {countryOptions.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Legal residence
            <select name="legalResidence" defaultValue={data.settings.legalResidence}>
              {countryOptions.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              name="countEntryExitDays"
              type="checkbox"
              defaultChecked={data.settings.countEntryExitDays}
            />
            Entry and exit days count
          </label>
          <button type="submit">
            <Settings size={16} /> Save settings
          </button>
        </form>
        <div className="storage-row">
          <span>
            Saved in {metadata.backend} · revision {metadata.revision ?? 1} ·{" "}
            {formatSavedAt(metadata.savedAt)}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void storage.exportData(data).then((blob) => downloadBlob(blob, "sojourn-data.json"));
            }}
          >
            <Download size={16} /> Export data
          </button>
        </div>
      </section>
    </main>
  );
}

function TargetCard({ progress }: { progress: RuleProgress }) {
  return (
    <article className={`target-card ${progress.tone}`}>
      <div className="target-title-row">
        <h2>{progress.rule.label}</h2>
        <span className={`rule-badge ${progress.rule.direction}`}>{progress.rule.direction}</span>
      </div>
      <p>{progress.rule.description}</p>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="target-meta">
        <span>{progress.detailText}</span>
        <strong>{progress.statusText}</strong>
      </div>
      <small>{describeRuleWindow(progress)}</small>
    </article>
  );
}

function StayRow({
  stay,
  expanded,
  onToggle,
  addingProof,
  onAddProof,
  onCancelProof,
  onSaveProof
}: {
  stay: TimelineStay;
  expanded: boolean;
  onToggle: () => void;
  addingProof: boolean;
  onAddProof: () => void;
  onCancelProof: () => void;
  onSaveProof: (form: HTMLFormElement) => void;
}) {
  const isHomeBase = stay.source === "inferred_home_base";
  return (
    <article className={`stay-row ${isHomeBase ? "home-base" : ""}`}>
      <span className="timeline-dot" aria-hidden="true" />
      <button type="button" className="stay-summary" onClick={onToggle}>
        <span className="country-avatar">{countryInitials(stay.country)}</span>
        <span className="stay-copy">
          <strong>{formatStayTitle(stay)}</strong>
          <small>
            {formatDateRange(stay.entryDate, stay.exitDate)} · {stay.label ?? "stay"}
          </small>
        </span>
        <span className={`evidence-chip ${stay.evidenceStatus.tone}`}>
          {stay.evidenceStatus.satisfied}/{stay.evidenceStatus.required}
        </span>
        <span className="stay-duration">{stay.durationDays}d</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="evidence-box">
          <div className="evidence-heading">
            <span>
              Evidence · {stay.evidence.length} item{stay.evidence.length === 1 ? "" : "s"}
            </span>
            {stay.evidenceStatus.missing.length > 0 && (
              <small>Missing {stay.evidenceStatus.missing.join(", ")}</small>
            )}
          </div>
          {stay.evidence.length > 0 ? (
            <div className="evidence-list">
              {stay.evidence.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="empty-copy">No evidence linked yet.</p>
          )}
          {addingProof ? (
            <EvidenceForm onCancel={onCancelProof} onSave={onSaveProof} />
          ) : (
            <button type="button" className="secondary full-width" onClick={onAddProof}>
              <Plus size={15} /> Add evidence
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const Icon = evidenceIcons[item.type];
  return (
    <div className="evidence-row">
      <Icon size={16} />
      <span>
        <strong>{item.title}</strong>
        <small>
          {evidenceLabel[item.type]}
          {item.date ? ` · ${item.date}` : ""}
          {item.fileName ? ` · ${item.fileName}` : ""}
        </small>
      </span>
    </div>
  );
}

function EvidenceForm({
  onCancel,
  onSave
}: {
  onCancel: () => void;
  onSave: (form: HTMLFormElement) => void;
}) {
  return (
    <form
      className="evidence-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(event.currentTarget);
      }}
    >
      <label>
        Type
        <select name="type" defaultValue="boarding_pass">
          {Object.entries(evidenceLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input name="title" placeholder="Boarding pass, visa, hotel invoice" />
      </label>
      <label>
        Date
        <input name="date" type="date" />
      </label>
      <label>
        File
        <input name="file" type="file" />
      </label>
      <div className="button-row">
        <button type="submit">
          <Upload size={15} /> Save proof
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          <X size={15} /> Cancel
        </button>
      </div>
    </form>
  );
}

function ProjectionPanel({
  projection,
  setProjection,
  progress
}: {
  projection: ProjectionInput;
  setProjection: React.Dispatch<React.SetStateAction<ProjectionInput>>;
  progress: RuleProgress[];
}) {
  return (
    <section className="panel projection-panel">
      <h2>
        <Target size={18} /> Projection
      </h2>
      <p>
        Test a hypothetical stay against the same rules. This is where sabbaticals and future trips
        become planning inputs instead of surprises.
      </p>
      <div className="projection-grid">
        <label>
          Country
          <select
            value={projection.country}
            onChange={(event) =>
              setProjection((current) => ({ ...current, country: event.target.value }))
            }
          >
            {countryOptions.map((code) => (
              <option key={code} value={code}>
                {countryName(code)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entry
          <input
            type="date"
            value={projection.entryDate}
            onChange={(event) =>
              setProjection((current) => ({ ...current, entryDate: event.target.value }))
            }
          />
        </label>
        <label>
          Exit
          <input
            type="date"
            value={projection.exitDate}
            onChange={(event) =>
              setProjection((current) => ({ ...current, exitDate: event.target.value }))
            }
          />
        </label>
        <label>
          Label
          <input
            value={projection.label}
            onChange={(event) =>
              setProjection((current) => ({ ...current, label: event.target.value }))
            }
          />
        </label>
      </div>
      <div className="projection-results">
        {progress.map((item) => (
          <div key={item.rule.id} className={`projection-result ${item.tone}`}>
            {item.rule.direction === "minimum" ? <BadgeCheck size={16} /> : <CircleAlert size={16} />}
            <span>
              <strong>{item.rule.label}</strong>
              <small>
                {item.detailText} · {item.statusText}
              </small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
