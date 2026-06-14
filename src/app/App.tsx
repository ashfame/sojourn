import {
  BadgeCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  Edit3,
  FileText,
  IdCard,
  Plane,
  Plus,
  Save,
  Settings,
  Stamp,
  Target,
  Trash2,
  Ticket,
  Upload,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { countryFlag, countryName } from "../domain/countries";
import { formatDateRange, isBefore, todayString } from "../domain/dates";
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
  CountingConvention,
  EvidenceItem,
  EvidenceType,
  ProjectionInput,
  Rule,
  RuleDirection,
  RuleProgress,
  Stay,
  TimelineStay,
  WindowDefinition
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

const indiaFiscalWindow: WindowDefinition = { type: "fiscal_year", startMonth: 4, startDay: 1 };

const ruleSuggestions: Array<{
  label: string;
  build: () => Omit<Rule, "id">;
}> = [
  {
    label: "India: under 60",
    build: () => ({
      label: "India under 60",
      countryScope: ["IN"],
      threshold: 59,
      direction: "ceiling",
      window: indiaFiscalWindow,
      counting: "entry_exit_count",
      description: "Maximum 59 days · FY Apr-Mar"
    })
  },
  {
    label: "India: under 120",
    build: () => ({
      label: "India under 120",
      countryScope: ["IN"],
      threshold: 119,
      direction: "ceiling",
      window: indiaFiscalWindow,
      counting: "entry_exit_count",
      description: "Maximum 119 days · FY Apr-Mar"
    })
  },
  {
    label: "India: under 183",
    build: () => ({
      label: "India under 183",
      countryScope: ["IN"],
      threshold: 182,
      direction: "ceiling",
      window: indiaFiscalWindow,
      counting: "entry_exit_count",
      description: "Maximum 182 days · FY Apr-Mar"
    })
  }
];

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

const optionalString = (value: FormDataEntryValue | null): string | undefined => {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
};

const normalizeCountryScope = (value: FormDataEntryValue | null): string[] => {
  const countries = String(value ?? "")
    .split(/[,\s]+/)
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(countries)].slice(0, 32);
};

const numberFromForm = (formData: FormData, key: string, fallback: number): number => {
  const value = Number(formData.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const windowFromForm = (formData: FormData): WindowDefinition => {
  const type = String(formData.get("windowType"));
  if (type === "fiscal_year") {
    return {
      type: "fiscal_year",
      startMonth: numberFromForm(formData, "startMonth", 1),
      startDay: numberFromForm(formData, "startDay", 1)
    };
  }
  if (type === "rolling_days") {
    return {
      type: "rolling_days",
      days: numberFromForm(formData, "rollingDays", 180)
    };
  }
  return { type: "calendar_year" };
};

const windowSignature = (window: WindowDefinition): string => {
  if (window.type === "fiscal_year") {
    return `fiscal:${window.startMonth}:${window.startDay}`;
  }
  if (window.type === "rolling_days") {
    return `rolling:${window.days}`;
  }
  return "calendar";
};

const ruleSignature = (rule: Pick<Rule, "countryScope" | "direction" | "threshold" | "window" | "counting">): string =>
  [
    [...new Set(rule.countryScope.map((country) => country.toUpperCase()))].sort().join(","),
    rule.direction,
    rule.threshold,
    windowSignature(rule.window),
    rule.counting
  ].join("|");

const hasEquivalentRule = (rules: Rule[], candidate: Rule, ignoredRuleId?: string): boolean =>
  rules.some((rule) => rule.id !== ignoredRuleId && ruleSignature(rule) === ruleSignature(candidate));

const countingDescriptions: Record<CountingConvention, string> = {
  entry_exit_count: "Counts both the arrival date and departure date.",
  exclude_exit_day: "Counts the arrival date, but not the departure date.",
  presence_any_part:
    "Counts any date touched by the stay. With date-only stays this matches inclusive counting."
};

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [metadata, setMetadata] = useState<StorageMetadata>({ backend: "indexeddb" });
  const [expandedStayIds, setExpandedStayIds] = useState<Set<string>>(new Set(["stay_spain_2026"]));
  const [showStayForm, setShowStayForm] = useState(false);
  const [showTargetEditor, setShowTargetEditor] = useState(false);
  const [editingStayId, setEditingStayId] = useState<string | null>(null);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
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
    const entryDate = String(formData.get("entryDate"));
    const exitDate = optionalString(formData.get("exitDate"));
    const label = optionalString(formData.get("label"));
    if (exitDate && isBefore(exitDate, entryDate)) {
      setMessage("Exit date cannot be before entry date.");
      return;
    }
    const now = new Date().toISOString();
    const stay: Stay = {
      id: createId("stay"),
      country: String(formData.get("country") ?? "AE").toUpperCase(),
      entryDate,
      ...(exitDate ? { exitDate } : {}),
      ...(label ? { label } : {}),
      createdAt: now,
      updatedAt: now
    };
    void saveData({ ...data, stays: [...data.stays, stay] }, "Stay added.");
    form.reset();
    setShowStayForm(false);
  };

  const updateStay = (form: HTMLFormElement, stayId: string): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    const entryDate = String(formData.get("entryDate"));
    const exitDate = optionalString(formData.get("exitDate"));
    if (exitDate && isBefore(exitDate, entryDate)) {
      setMessage("Exit date cannot be before entry date.");
      return;
    }
    const label = optionalString(formData.get("label"));
    const now = new Date().toISOString();
    const stays = data.stays.map((stay) => {
      if (stay.id !== stayId) {
        return stay;
      }
      return {
        id: stay.id,
        country: String(formData.get("country") ?? stay.country).toUpperCase(),
        entryDate,
        ...(exitDate ? { exitDate } : {}),
        ...(label ? { label } : {}),
        createdAt: stay.createdAt,
        updatedAt: now
      };
    });
    void saveData({ ...data, stays }, "Stay updated.");
    setEditingStayId(null);
    setExpandedStayIds((current) => new Set(current).add(stayId));
  };

  const deleteStay = (stay: TimelineStay): void => {
    if (!data || stay.source !== "explicit") {
      return;
    }
    if (
      stay.evidence.length > 0 &&
      !window.confirm("Delete this stay and its linked evidence?")
    ) {
      return;
    }
    void saveData(
      {
        ...data,
        stays: data.stays.filter((item) => item.id !== stay.id),
        evidence: data.evidence.filter((item) => item.stayId !== stay.id)
      },
      "Stay deleted."
    );
    setExpandedStayIds((current) => {
      const next = new Set(current);
      next.delete(stay.id);
      return next;
    });
    setEditingStayId(null);
    setProofStayId(null);
  };

  const addEvidence = (form: HTMLFormElement, stayId: string): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    const evidence = evidenceFromForm(formData, stayId);
    void saveData({ ...data, evidence: [...data.evidence, evidence] }, "Evidence added.");
    form.reset();
    setProofStayId(null);
    setExpandedStayIds((current) => new Set(current).add(stayId));
  };

  const updateEvidence = (form: HTMLFormElement, item: EvidenceItem): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    const updated = evidenceFromForm(formData, item.stayId, item);
    void saveData(
      {
        ...data,
        evidence: data.evidence.map((evidence) => (evidence.id === item.id ? updated : evidence))
      },
      "Evidence updated."
    );
    setEditingEvidenceId(null);
  };

  const deleteEvidence = (item: EvidenceItem): void => {
    if (!data) {
      return;
    }
    void saveData(
      {
        ...data,
        evidence: data.evidence.filter((evidence) => evidence.id !== item.id)
      },
      "Evidence deleted."
    );
    setEditingEvidenceId(null);
  };

  const evidenceFromForm = (
    formData: FormData,
    stayId: string,
    existing?: EvidenceItem
  ): EvidenceItem => {
    const file = formData.get("file");
    const evidenceDate = optionalString(formData.get("date"));
    const fileMeta =
      file instanceof File && file.name
        ? {
            fileName: file.name,
            ...(file.type ? { mimeType: file.type } : {}),
            sizeBytes: file.size
          }
        : {
            ...(existing?.fileName ? { fileName: existing.fileName } : {}),
            ...(existing?.mimeType ? { mimeType: existing.mimeType } : {}),
            ...(existing?.sizeBytes !== undefined ? { sizeBytes: existing.sizeBytes } : {})
          };
    return {
      id: existing?.id ?? createId("evidence"),
      stayId,
      type: String(formData.get("type")) as EvidenceType,
      title: String(formData.get("title") || (file instanceof File ? file.name : "Evidence")),
      ...(evidenceDate ? { date: evidenceDate } : {}),
      ...fileMeta,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
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
          countEntryExitDays: data.settings.countEntryExitDays
        }
      },
      "Settings saved."
    );
  };

  const upsertRule = (form: HTMLFormElement, ruleId?: string): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    const countries = normalizeCountryScope(formData.get("countryScope"));
    if (countries.length === 0) {
      setMessage("Add at least one country code for the target.");
      return;
    }
    const nextRule: Rule = {
      id: ruleId ?? createId("rule"),
      label: String(formData.get("label") || "Custom target").trim(),
      countryScope: countries,
      threshold: numberFromForm(formData, "threshold", 1),
      direction: String(formData.get("direction")) as RuleDirection,
      window: windowFromForm(formData),
      counting: String(formData.get("counting")) as CountingConvention,
      description: String(formData.get("description") || "").trim()
    };
    if (hasEquivalentRule(data.rules, nextRule, ruleId)) {
      setMessage("That target already exists.");
      return;
    }
    const rules = ruleId
      ? data.rules.map((rule) => (rule.id === ruleId ? nextRule : rule))
      : [...data.rules, nextRule];
    void saveData({ ...data, rules }, ruleId ? "Target updated." : "Target added.");
    form.reset();
  };

  const deleteRule = (ruleId: string): void => {
    if (!data) {
      return;
    }
    void saveData(
      { ...data, rules: data.rules.filter((rule) => rule.id !== ruleId) },
      "Target deleted."
    );
  };

  const addSuggestedRule = (suggestion: (typeof ruleSuggestions)[number]): void => {
    if (!data) {
      return;
    }
    const rule: Rule = {
      id: createId("rule"),
      ...suggestion.build()
    };
    if (hasEquivalentRule(data.rules, rule)) {
      setMessage("That suggested target is already added.");
      return;
    }
    void saveData({ ...data, rules: [...data.rules, rule] }, "Suggested target added.");
    setShowTargetEditor(true);
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
        {progress.length > 0 ? (
          progress.map((item) => <TargetCard key={item.rule.id} progress={item} />)
        ) : (
          <article className="target-card empty-target-card">
            <h2>No targets configured</h2>
            <p>Add a target to start tracking day-count pressure.</p>
          </article>
        )}
      </section>

      <div className="target-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setShowTargetEditor((value) => !value)}
        >
          <Settings size={16} /> {showTargetEditor ? "Hide target settings" : "Configure targets"}
        </button>
      </div>

      {showTargetEditor && (
        <TargetEditor
          rules={data.rules}
          onSaveRule={upsertRule}
          onDeleteRule={deleteRule}
          onAddSuggestion={addSuggestedRule}
        />
      )}

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
            editing={editingStayId === stay.id}
            editingEvidenceId={editingEvidenceId}
            onStartEdit={() => {
              setEditingStayId(stay.id);
              setProofStayId(null);
            }}
            onCancelEdit={() => setEditingStayId(null)}
            onSaveEdit={(form) => updateStay(form, stay.id)}
            onDelete={() => deleteStay(stay)}
            onAddProof={() => {
              setProofStayId(stay.id);
              setEditingEvidenceId(null);
            }}
            onCancelProof={() => setProofStayId(null)}
            onSaveProof={(form) => addEvidence(form, stay.id)}
            onStartEditEvidence={(item) => {
              setEditingEvidenceId(item.id);
              setProofStayId(null);
            }}
            onCancelEditEvidence={() => setEditingEvidenceId(null)}
            onSaveEvidenceEdit={updateEvidence}
            onDeleteEvidence={deleteEvidence}
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
            Default gap country
            <select name="homeBaseCountry" defaultValue={data.settings.homeBaseCountry}>
              {countryOptions.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
            <span className="field-help">
              Used only to infer timeline gaps between explicit stays.
            </span>
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
            <span className="field-help">Profile metadata for suggestions, not day counting.</span>
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
            <span className="field-help">Profile metadata for suggestions, not day counting.</span>
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
  editing,
  editingEvidenceId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onAddProof,
  onCancelProof,
  onSaveProof,
  onStartEditEvidence,
  onCancelEditEvidence,
  onSaveEvidenceEdit,
  onDeleteEvidence
}: {
  stay: TimelineStay;
  expanded: boolean;
  onToggle: () => void;
  addingProof: boolean;
  editing: boolean;
  editingEvidenceId: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (form: HTMLFormElement) => void;
  onDelete: () => void;
  onAddProof: () => void;
  onCancelProof: () => void;
  onSaveProof: (form: HTMLFormElement) => void;
  onStartEditEvidence: (item: EvidenceItem) => void;
  onCancelEditEvidence: () => void;
  onSaveEvidenceEdit: (form: HTMLFormElement, item: EvidenceItem) => void;
  onDeleteEvidence: (item: EvidenceItem) => void;
}) {
  const isHomeBase = stay.source === "inferred_home_base";
  return (
    <article className={`stay-row ${isHomeBase ? "home-base" : ""}`}>
      <span className="timeline-dot" aria-hidden="true" />
      <button type="button" className="stay-summary" onClick={onToggle}>
        <span className="country-avatar" title={countryName(stay.country)}>
          {countryFlag(stay.country)}
        </span>
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
          {!isHomeBase && (
            <div className="stay-actions">
              <button type="button" className="secondary" onClick={onStartEdit}>
                <Edit3 size={15} /> Edit stay
              </button>
              <button type="button" className="danger-button" onClick={onDelete}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}

          {editing && !isHomeBase && (
            <StayEditForm stay={stay} onCancel={onCancelEdit} onSave={onSaveEdit} />
          )}

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
              {stay.evidence.map((item) =>
                editingEvidenceId === item.id ? (
                  <EvidenceForm
                    key={item.id}
                    item={item}
                    onCancel={onCancelEditEvidence}
                    onSave={(form) => onSaveEvidenceEdit(form, item)}
                  />
                ) : (
                  <EvidenceRow
                    key={item.id}
                    item={item}
                    onEdit={() => onStartEditEvidence(item)}
                    onDelete={() => onDeleteEvidence(item)}
                  />
                )
              )}
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

function StayEditForm({
  stay,
  onCancel,
  onSave
}: {
  stay: Stay;
  onCancel: () => void;
  onSave: (form: HTMLFormElement) => void;
}) {
  return (
    <form
      className="stay-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(event.currentTarget);
      }}
    >
      <label>
        Country
        <select name="country" defaultValue={stay.country}>
          {countryOptions.map((code) => (
            <option key={code} value={code}>
              {countryName(code)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Entry
        <input name="entryDate" type="date" defaultValue={stay.entryDate} required />
      </label>
      <label>
        Exit
        <input name="exitDate" type="date" defaultValue={stay.exitDate ?? ""} />
      </label>
      <label>
        Label
        <input name="label" defaultValue={stay.label ?? ""} placeholder="City, trip, or reason" />
      </label>
      <div className="button-row">
        <button type="submit">
          <Save size={15} /> Save stay
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          <X size={15} /> Cancel
        </button>
      </div>
    </form>
  );
}

function TargetEditor({
  rules,
  onSaveRule,
  onDeleteRule,
  onAddSuggestion
}: {
  rules: Rule[];
  onSaveRule: (form: HTMLFormElement, ruleId?: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onAddSuggestion: (suggestion: (typeof ruleSuggestions)[number]) => void;
}) {
  return (
    <section className="panel target-editor">
      <div className="panel-title-row">
        <h2>
          <Target size={18} /> Target settings
        </h2>
        <div className="suggestion-row" aria-label="Suggested targets">
          {ruleSuggestions.map((suggestion) => {
            const suggestionRule: Rule = { id: suggestion.label, ...suggestion.build() };
            const alreadyAdded = hasEquivalentRule(rules, suggestionRule);
            return (
              <button
                key={suggestion.label}
                type="button"
                className="secondary"
                disabled={alreadyAdded}
                onClick={() => onAddSuggestion(suggestion)}
              >
                <Plus size={14} /> {alreadyAdded ? "Added" : suggestion.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="rule-list">
        {rules.map((rule) => (
          <RuleForm
            key={rule.id}
            rule={rule}
            onSave={(form) => onSaveRule(form, rule.id)}
            onDelete={() => onDeleteRule(rule.id)}
          />
        ))}
      </div>
      <RuleForm onSave={(form) => onSaveRule(form)} />
    </section>
  );
}

function RuleForm({
  rule,
  onSave,
  onDelete
}: {
  rule?: Rule;
  onSave: (form: HTMLFormElement) => void;
  onDelete?: () => void;
}) {
  const windowType = rule?.window.type ?? "calendar_year";
  const startMonth = rule?.window.type === "fiscal_year" ? rule.window.startMonth : 1;
  const startDay = rule?.window.type === "fiscal_year" ? rule.window.startDay : 1;
  const rollingDays = rule?.window.type === "rolling_days" ? rule.window.days : 180;
  const [selectedCounting, setSelectedCounting] = useState<CountingConvention>(
    rule?.counting ?? "entry_exit_count"
  );
  return (
    <form
      className={`rule-form ${rule ? "" : "new-rule"}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(event.currentTarget);
      }}
    >
      <div className="rule-form-heading">
        <strong>{rule ? rule.label : "Add custom target"}</strong>
        {rule && onDelete && (
          <button type="button" className="danger-button" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
      <div className="rule-form-grid">
        <label>
          Label
          <input name="label" defaultValue={rule?.label ?? ""} placeholder="India under 60" />
        </label>
        <label>
          Countries
          <input
            name="countryScope"
            defaultValue={rule?.countryScope.join(", ") ?? "IN"}
            placeholder="IN or FR, DE, ES"
            required
          />
        </label>
        <label>
          Direction
          <select name="direction" defaultValue={rule?.direction ?? "ceiling"}>
            <option value="ceiling">Ceiling / budget</option>
            <option value="minimum">Minimum / target</option>
          </select>
        </label>
        <label>
          Max or target days
          <input
            name="threshold"
            type="number"
            min="1"
            defaultValue={rule?.threshold ?? 59}
            required
          />
        </label>
        <label>
          Year/window
          <select name="windowType" defaultValue={windowType}>
            <option value="calendar_year">Calendar year</option>
            <option value="fiscal_year">Fiscal/tax year</option>
            <option value="rolling_days">Rolling days</option>
          </select>
        </label>
        <label>
          Fiscal start month
          <input name="startMonth" type="number" min="1" max="12" defaultValue={startMonth} />
        </label>
        <label>
          Fiscal start day
          <input name="startDay" type="number" min="1" max="31" defaultValue={startDay} />
        </label>
        <label>
          Rolling window days
          <input name="rollingDays" type="number" min="1" defaultValue={rollingDays} />
        </label>
        <label>
          Counting
          <select
            name="counting"
            value={selectedCounting}
            onChange={(event) => setSelectedCounting(event.target.value as CountingConvention)}
          >
            <option value="entry_exit_count">Inclusive dates: entry + exit count</option>
            <option value="exclude_exit_day">Exclude exit date: nights-style</option>
            <option value="presence_any_part">Any touched date: date-only inclusive</option>
          </select>
          <span className="field-help">{countingDescriptions[selectedCounting]}</span>
        </label>
        <label className="rule-description-field">
          Description
          <input
            name="description"
            defaultValue={rule?.description ?? ""}
            placeholder="Maximum 59 days · FY Apr-Mar"
          />
        </label>
      </div>
      <button type="submit">
        <Save size={15} /> {rule ? "Save target" : "Add target"}
      </button>
    </form>
  );
}

function EvidenceRow({
  item,
  onEdit,
  onDelete
}: {
  item: EvidenceItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
      <div className="evidence-actions">
        <button type="button" className="icon-button secondary" aria-label={`Edit ${item.title}`} onClick={onEdit}>
          <Edit3 size={14} />
        </button>
        <button type="button" className="icon-button danger-button" aria-label={`Delete ${item.title}`} onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function EvidenceForm({
  item,
  onCancel,
  onSave
}: {
  item?: EvidenceItem;
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
        <select name="type" defaultValue={item?.type ?? "boarding_pass"}>
          {Object.entries(evidenceLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input
          name="title"
          defaultValue={item?.title ?? ""}
          placeholder="Boarding pass, visa, hotel invoice"
        />
      </label>
      <label>
        Date
        <input name="date" type="date" defaultValue={item?.date ?? ""} />
      </label>
      <label>
        File
        <input name="file" type="file" />
        {item?.fileName && <span className="field-help">Current file: {item.fileName}</span>}
      </label>
      <div className="button-row">
        <button type="submit">
          {item ? <Save size={15} /> : <Upload size={15} />} {item ? "Save proof" : "Add proof"}
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
