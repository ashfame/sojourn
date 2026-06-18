import {
  Archive as ArchiveIcon,
  BadgeCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Database,
  Edit3,
  Eye,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType
} from "react";
import { COUNTRY_NAMES, countryFlag, countryName } from "../domain/countries";
import {
  formatDateRange,
  isAfter,
  isBefore,
  millisecondsUntilNextUtcDay,
  todayString
} from "../domain/dates";
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
import { STORAGE_BACKUP_KEY, createIndexedDbStorage } from "../storage/indexedDbStorage";
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

const countryOptions = Object.keys(COUNTRY_NAMES).sort((left, right) =>
  countryName(left).localeCompare(countryName(right))
);

const defaultProjection: ProjectionInput = {
  country: "",
  entryDate: "",
  exitDate: "",
  label: ""
};

const indiaFiscalWindow: WindowDefinition = { type: "fiscal_year", startMonth: 4, startDay: 1 };

const ruleSuggestions: Array<{
  label: string;
  build: () => Omit<Rule, "id">;
}> = [
  {
    label: "UAE: 183 Minimum",
    build: () => ({
      label: "UAE Tax Residency",
      countryScope: ["AE"],
      threshold: 183,
      direction: "minimum",
      window: { type: "calendar_year" },
      counting: "entry_exit_count",
      description: "183 days in calendar year"
    })
  },
  {
    label: "India: Under 60",
    build: () => ({
      label: "India Under 60",
      countryScope: ["IN"],
      threshold: 59,
      direction: "ceiling",
      window: indiaFiscalWindow,
      counting: "entry_exit_count",
      description: "Maximum 59 days · FY Apr-Mar"
    })
  },
  {
    label: "India: Under 120",
    build: () => ({
      label: "India Under 120",
      countryScope: ["IN"],
      threshold: 119,
      direction: "ceiling",
      window: indiaFiscalWindow,
      counting: "entry_exit_count",
      description: "Maximum 119 days · FY Apr-Mar"
    })
  },
  {
    label: "India: Under 183",
    build: () => ({
      label: "India Under 183",
      countryScope: ["IN"],
      threshold: 182,
      direction: "ceiling",
      window: indiaFiscalWindow,
      counting: "entry_exit_count",
      description: "Maximum 182 days · FY Apr-Mar"
    })
  },
  {
    label: "Schengen: 90/180",
    build: () => ({
      label: "Schengen 90/180",
      countryScope: ["AT", "BE", "CH", "CZ", "DE", "ES", "FR", "GR", "IT", "NL", "PL", "PT"],
      threshold: 90,
      direction: "ceiling",
      window: { type: "rolling_days", days: 180 },
      counting: "entry_exit_count",
      description: "Rolling 180-day window · all Schengen states"
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

const storageBackendLabel = (backend: StorageMetadata["backend"]): string => {
  if (backend === "indexeddb") {
    return "IndexedDB";
  }
  if (backend === "remote_sqlite") {
    return "Remote SQLite";
  }
  return "Memory";
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

const normalizeCountryCode = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);

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

type VisibleCountingConvention = Exclude<CountingConvention, "presence_any_part">;

const normalizeVisibleCounting = (counting: unknown): VisibleCountingConvention =>
  counting === "exclude_exit_day" ? "exclude_exit_day" : "entry_exit_count";

const ruleSignature = (rule: Pick<Rule, "countryScope" | "direction" | "threshold" | "window" | "counting">): string =>
  [
    [...new Set(rule.countryScope.map((country) => country.toUpperCase()))].sort().join(","),
    rule.direction,
    rule.threshold,
    windowSignature(rule.window),
    normalizeVisibleCounting(rule.counting)
  ].join("|");

const hasEquivalentRule = (rules: Rule[], candidate: Rule, ignoredRuleId?: string): boolean =>
  rules.some((rule) => rule.id !== ignoredRuleId && ruleSignature(rule) === ruleSignature(candidate));

const isActiveTimelineStay = (stay: TimelineStay): boolean =>
  stay.source === "explicit" &&
  (stay.knownExitDate === undefined ||
    (stay.exitDate !== undefined && isAfter(stay.knownExitDate, stay.exitDate)));

const countingDescriptions: Record<VisibleCountingConvention, string> = {
  entry_exit_count: "Counts both the arrival date and departure date.",
  exclude_exit_day: "Counts the arrival date, but not the departure date."
};

const countingLabels: Record<VisibleCountingConvention, string> = {
  entry_exit_count: "Arrival and Departure Dates",
  exclude_exit_day: "Exclude Departure Date"
};

const countingOptions: VisibleCountingConvention[] = [
  "entry_exit_count",
  "exclude_exit_day"
];

const ruleDirectionLabels: Record<RuleDirection, string> = {
  ceiling: "Ceiling",
  minimum: "Minimum"
};

type TimelineRenderItem =
  | { type: "year"; id: string; year: string }
  | { type: "stay"; id: string; stay: TimelineStay };

type AppView = "timeline" | "targets" | "projection" | "data";

interface EvidencePreview {
  item: EvidenceItem;
  url: string;
  mimeType: string;
}

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [metadata, setMetadata] = useState<StorageMetadata>({ backend: "indexeddb" });
  const [expandedStayIds, setExpandedStayIds] = useState<Set<string>>(new Set());
  const [showStayForm, setShowStayForm] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("timeline");
  const [editingStayId, setEditingStayId] = useState<string | null>(null);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [proofStayId, setProofStayId] = useState<string | null>(null);
  const [projection, setProjection] = useState<ProjectionInput>(defaultProjection);
  const [plannedProjections, setPlannedProjections] = useState<ProjectionInput[]>([]);
  const [asOf, setAsOf] = useState(() => todayString());
  const [message, setMessage] = useState<string>("");
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreview | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const closeEvidencePreview = useCallback((): void => {
    setEvidencePreview((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    let active = true;
    const loadSnapshot = async (): Promise<void> => {
      const snapshot = await storage.load();
      if (!active) {
        return;
      }
      setData(snapshot.data);
      setMetadata(snapshot.metadata);
    };
    void loadSnapshot().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_BACKUP_KEY) {
        void loadSnapshot().catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : String(error));
        });
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    let timeoutId: number | undefined;
    const refreshAsOf = (): void => {
      setAsOf((current) => {
        const next = todayString();
        return next === current ? current : next;
      });
    };
    const scheduleNextRefresh = (): void => {
      timeoutId = window.setTimeout(() => {
        refreshAsOf();
        scheduleNextRefresh();
      }, millisecondsUntilNextUtcDay());
    };
    const refreshWhenVisible = (): void => {
      if (document.visibilityState !== "hidden") {
        refreshAsOf();
      }
    };

    scheduleNextRefresh();
    window.addEventListener("focus", refreshAsOf);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", refreshAsOf);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const timeline = useMemo(() => (data ? createTimeline(data, asOf) : []), [asOf, data]);
  const timelineItems = useMemo<TimelineRenderItem[]>(() => {
    const items: TimelineRenderItem[] = [];
    let currentYear: string | undefined;
    for (const stay of timeline) {
      const year = stay.entryDate.slice(0, 4);
      if (year !== currentYear) {
        items.push({ type: "year", id: `year_${year}`, year });
        currentYear = year;
      }
      items.push({ type: "stay", id: stay.id, stay });
    }
    return items;
  }, [timeline]);
  const progress = useMemo(() => (data ? computeRuleProgress(data, asOf) : []), [asOf, data]);
  const projectedStays = useMemo(
    () =>
      plannedProjections.map((item, index) => ({
        ...projectionStay(item),
        id: `projection_${index}_${item.country}_${item.entryDate}_${item.exitDate}`
      })),
    [plannedProjections]
  );
  const projectionProgress = useMemo(() => {
    if (!data || projectedStays.length === 0) {
      return [];
    }
    return computeRuleProgress(data, ruleAsOfDate(projectedStays, asOf), projectedStays);
  }, [asOf, data, projectedStays]);
  const planProgress = projectionProgress.length > 0 ? projectionProgress : progress;
  useEffect(() => {
    if (!evidencePreview) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeEvidencePreview();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeEvidencePreview, evidencePreview]);

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
      country: normalizeCountryCode(String(formData.get("country") ?? "AE")),
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

  const addPlannedProjection = (input: ProjectionInput): void => {
    const country = normalizeCountryCode(input.country);
    const label = input.label.trim();
    if (!country || !input.entryDate || !input.exitDate) {
      setMessage("Add country, entry, and exit dates for the planned trip.");
      return;
    }
    if (isBefore(input.exitDate, input.entryDate)) {
      setMessage("Planned trip exit cannot be before entry.");
      return;
    }
    setPlannedProjections((current) => [
      ...current,
      {
        country,
        entryDate: input.entryDate,
        exitDate: input.exitDate,
        label
      }
    ]);
    setProjection(defaultProjection);
    setMessage("Planned trip added.");
  };

  const removePlannedProjection = (index: number): void => {
    setPlannedProjections((current) => current.filter((_, itemIndex) => itemIndex !== index));
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
        country: normalizeCountryCode(String(formData.get("country") ?? stay.country)),
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
    const linkedEvidence = data.evidence.filter((item) => item.stayId === stay.id);
    void Promise.all(linkedEvidence.map((item) => storage.deleteEvidenceFile(item.blobKey))).then(
      () =>
        saveData(
          {
            ...data,
            stays: data.stays.filter((item) => item.id !== stay.id),
            evidence: data.evidence.filter((item) => item.stayId !== stay.id)
          },
          "Stay deleted."
        )
    );
    setExpandedStayIds((current) => {
      const next = new Set(current);
      next.delete(stay.id);
      return next;
    });
    setEditingStayId(null);
    setProofStayId(null);
  };

  const endStayToday = (stay: TimelineStay): void => {
    if (!data || !isActiveTimelineStay(stay)) {
      return;
    }
    const now = new Date().toISOString();
    void saveData(
      {
        ...data,
        stays: data.stays.map((item) =>
          item.id === stay.id ? { ...item, exitDate: asOf, updatedAt: now } : item
        )
      },
      "Active stay ended today."
    );
    setExpandedStayIds((current) => new Set(current).add(stay.id));
  };

  const addEvidence = (form: HTMLFormElement, stayId: string): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    void evidenceFromForm(formData, stayId).then((evidence) =>
      saveData({ ...data, evidence: [...data.evidence, evidence] }, "Evidence added.").then(() => {
        form.reset();
        setProofStayId(null);
        setExpandedStayIds((current) => new Set(current).add(stayId));
      })
    );
  };

  const updateEvidence = (form: HTMLFormElement, item: EvidenceItem): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    void evidenceFromForm(formData, item.stayId, item).then((updated) =>
      saveData(
        {
          ...data,
          evidence: data.evidence.map((evidence) => (evidence.id === item.id ? updated : evidence))
        },
        "Evidence updated."
      ).then(() => setEditingEvidenceId(null))
    );
  };

  const deleteEvidence = (item: EvidenceItem): void => {
    if (!data) {
      return;
    }
    void storage.deleteEvidenceFile(item.blobKey).then(() =>
      saveData(
        {
          ...data,
          evidence: data.evidence.filter((evidence) => evidence.id !== item.id)
        },
        "Evidence deleted."
      ).then(() => setEditingEvidenceId(null))
    );
  };

  const openEvidencePreview = (item: EvidenceItem): void => {
    void storage
      .getEvidenceFile(item)
      .then((blob) => {
        if (!blob) {
          setMessage("No file is stored for that evidence item.");
          return;
        }
        closeEvidencePreview();
        setEvidencePreview({
          item,
          url: URL.createObjectURL(blob),
          mimeType: blob.type || item.mimeType || "application/octet-stream"
        });
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not open evidence file.");
      });
  };

  const evidenceFromForm = async (
    formData: FormData,
    stayId: string,
    existing?: EvidenceItem
  ): Promise<EvidenceItem> => {
    const id = existing?.id ?? createId("evidence");
    const file = formData.get("file");
    const evidenceDate = optionalString(formData.get("date"));
    const hasFile = file instanceof File && file.name;
    const blobKey = hasFile ? `evidence/${id}` : existing?.blobKey;
    if (hasFile && blobKey) {
      await storage.saveEvidenceFile(blobKey, file);
    }
    const fileMeta =
      hasFile
        ? {
            fileName: file.name,
            ...(file.type ? { mimeType: file.type } : {}),
            sizeBytes: file.size,
            ...(blobKey ? { blobKey } : {})
          }
        : {
            ...(existing?.fileName ? { fileName: existing.fileName } : {}),
            ...(existing?.mimeType ? { mimeType: existing.mimeType } : {}),
            ...(existing?.sizeBytes !== undefined ? { sizeBytes: existing.sizeBytes } : {}),
            ...(blobKey ? { blobKey } : {})
          };
    return {
      id,
      stayId,
      type: String(formData.get("type")) as EvidenceType,
      title: String(formData.get("title") || (file instanceof File ? file.name : "Evidence")),
      ...(evidenceDate ? { date: evidenceDate } : {}),
      ...fileMeta,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
  };

  const updateProfile = (form: HTMLFormElement): void => {
    if (!data) {
      return;
    }
    const formData = new FormData(form);
    void saveData(
      {
        ...data,
        settings: {
          homeBaseCountry: data.settings.homeBaseCountry,
          nationality: String(formData.get("nationality") ?? "IN").toUpperCase(),
          legalResidence: String(formData.get("legalResidence") ?? "AE").toUpperCase(),
          countEntryExitDays: data.settings.countEntryExitDays
        }
      },
      "Profile saved."
    );
  };

  const importSnapshot = (file: File | undefined): void => {
    if (!file) {
      return;
    }
    void storage
      .importData(file)
      .then((imported) => saveData(imported, "Data imported."))
      .then(() => {
        setExpandedStayIds(new Set());
        setEditingStayId(null);
        setEditingEvidenceId(null);
        setProofStayId(null);
        setShowStayForm(false);
        setActiveView("timeline");
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? `Import failed: ${error.message}` : "Import failed.");
      });
  };

  const upsertRule = (form: HTMLFormElement, ruleId?: string): boolean => {
    if (!data) {
      return false;
    }
    const formData = new FormData(form);
    const countries = normalizeCountryScope(formData.get("countryScope"));
    if (countries.length === 0) {
      setMessage("Add at least one country code for the target.");
      return false;
    }
    const nextRule: Rule = {
      id: ruleId ?? createId("rule"),
      label: String(formData.get("label") || "Custom Target").trim(),
      countryScope: countries,
      threshold: numberFromForm(formData, "threshold", 1),
      direction: String(formData.get("direction")) as RuleDirection,
      window: windowFromForm(formData),
      counting: normalizeVisibleCounting(formData.get("counting")),
      description: String(formData.get("description") || "").trim()
    };
    if (hasEquivalentRule(data.rules, nextRule, ruleId)) {
      setMessage("That target already exists.");
      return false;
    }
    const rules = ruleId
      ? data.rules.map((rule) => (rule.id === ruleId ? nextRule : rule))
      : [...data.rules, nextRule];
    void saveData({ ...data, rules }, ruleId ? "Target updated." : "Target added.");
    setActiveView("targets");
    form.reset();
    return true;
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
    setActiveView("targets");
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
          <h1>{activeView === "timeline" ? "Timeline" : activeView === "targets" ? "Targets" : activeView === "projection" ? "Projection" : "Data"}</h1>
          <p>{timelineSummary(timeline)}</p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => {
            setActiveView("timeline");
            setShowStayForm((value) => !value);
          }}>
            {showStayForm ? <X size={17} /> : <Plus size={17} />}
            {showStayForm ? "Close" : "Add stay"}
          </button>
          <div className="view-switcher" aria-label="App sections">
            <button
              type="button"
              className={activeView === "timeline" ? "secondary active" : "secondary"}
              aria-pressed={activeView === "timeline"}
              onClick={() => setActiveView("timeline")}
            >
              <CalendarDays size={16} /> Timeline
            </button>
            <button
              type="button"
              className={activeView === "targets" ? "secondary active" : "secondary"}
              aria-pressed={activeView === "targets"}
              onClick={() => setActiveView("targets")}
            >
              <Target size={16} /> Targets
            </button>
            <button
              type="button"
              className={activeView === "projection" ? "secondary active" : "secondary"}
              aria-pressed={activeView === "projection"}
              onClick={() => setActiveView("projection")}
            >
              <Plane size={16} /> Plan
            </button>
            <button
              type="button"
              className={activeView === "data" ? "secondary active" : "secondary"}
              aria-pressed={activeView === "data"}
              onClick={() => setActiveView("data")}
            >
              <Settings size={16} /> Data
            </button>
          </div>
        </div>
      </header>
      <CountryOptionsDatalist />

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      {activeView === "timeline" && data.rules.length === 0 && (
        <section className="panel setup-panel">
          <h2>
            <Target size={18} /> Set up targets
          </h2>
          <p>Add at least one target to calculate day-count pressure. You can still add stays now.</p>
          <button type="button" className="secondary" onClick={() => setActiveView("targets")}>
            <Target size={16} /> Open targets
          </button>
        </section>
      )}

      {activeView === "timeline" && progress.length > 0 && (
        <TargetStrip progress={progress} label="Residency targets" />
      )}

      {activeView === "targets" && (
        <>
          {progress.length > 0 && (
            <TargetStrip progress={progress} label="Residency targets" />
          )}
          <TargetEditor
            rules={data.rules}
            onSaveRule={upsertRule}
            onDeleteRule={deleteRule}
            onAddSuggestion={addSuggestedRule}
          />
        </>
      )}

      {activeView === "timeline" && showStayForm && (
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
              <CountryCodeField name="country" defaultValue="AE" />
            </label>
            <label>
              Entry
              <input name="entryDate" type="date" required />
            </label>
            <label>
              Exit
              <input name="exitDate" type="date" />
              <span className="field-help">
                Leave blank for your current stay. Future planned stays should include an exit date.
              </span>
            </label>
            <label>
              Label
              <input name="label" placeholder="City, trip, or reason" />
            </label>
            <button type="submit" className="form-submit">
              <Plus size={16} /> Save stay
            </button>
          </form>
        </section>
      )}

      {activeView === "timeline" && (
        <section className="timeline-section" aria-label="Stay timeline">
          <div className="timeline-line" aria-hidden="true" />
          {timeline.length === 0 && (
            <article className="timeline-empty">
              <CalendarDays size={18} />
              <span>No stays entered yet.</span>
            </article>
          )}
          {timelineItems.map((item) =>
            item.type === "year" ? (
              <TimelineYearMarker key={item.id} year={item.year} />
            ) : (
              <StayRow
                key={item.id}
                stay={item.stay}
                expanded={expandedStayIds.has(item.stay.id)}
                onToggle={() => toggleStay(item.stay.id)}
                addingProof={proofStayId === item.stay.id}
                editing={editingStayId === item.stay.id}
                editingEvidenceId={editingEvidenceId}
                onStartEdit={() => {
                  setEditingStayId(item.stay.id);
                  setProofStayId(null);
                }}
                onCancelEdit={() => setEditingStayId(null)}
                onSaveEdit={(form) => updateStay(form, item.stay.id)}
                onDelete={() => deleteStay(item.stay)}
                onEndToday={() => endStayToday(item.stay)}
                onAddProof={() => {
                  setProofStayId(item.stay.id);
                  setEditingEvidenceId(null);
                }}
                onCancelProof={() => setProofStayId(null)}
                onSaveProof={(form) => addEvidence(form, item.stay.id)}
                onStartEditEvidence={(evidence) => {
                  setEditingEvidenceId(evidence.id);
                  setProofStayId(null);
                }}
                onCancelEditEvidence={() => setEditingEvidenceId(null)}
                onSaveEvidenceEdit={updateEvidence}
                onDeleteEvidence={deleteEvidence}
                onViewEvidence={openEvidencePreview}
              />
            )
          )}
        </section>
      )}

      {activeView === "projection" && (
        <>
          {planProgress.length > 0 && (
            <TargetStrip
              progress={planProgress}
              label={
                plannedProjections.length > 0 ? "Projected residency targets" : "Residency targets"
              }
            />
          )}
          <ProjectionPanel
            projection={projection}
            setProjection={setProjection}
            plannedProjections={plannedProjections}
            onAddProjection={addPlannedProjection}
            onRemoveProjection={removePlannedProjection}
          />
        </>
      )}

      {activeView === "data" && (
        <section className="panel settings-panel">
          <h2>
            <Database size={18} /> Data & profile
          </h2>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              updateProfile(event.currentTarget);
            }}
          >
            <label>
              Nationality
              <CountryCodeField name="nationality" defaultValue={data.settings.nationality} />
              <span className="field-help">Profile metadata for suggestions, not day counting.</span>
            </label>
            <label>
              Legal residence
              <CountryCodeField
                name="legalResidence"
                defaultValue={data.settings.legalResidence}
              />
              <span className="field-help">Profile metadata for suggestions, not day counting.</span>
            </label>
            <button type="submit" className="form-submit">
              <Save size={16} /> Save profile
            </button>
          </form>
          <div className="storage-row">
            <span>
              Built from: {__SOJOURN_BUILD_COMMIT__}
              <br />
              Saved in {storageBackendLabel(metadata.backend)} · revision {metadata.revision ?? 1} ·{" "}
              {formatSavedAt(metadata.savedAt)}
            </span>
            <div className="storage-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => importInputRef.current?.click()}
              >
                <Upload size={16} /> Import
              </button>
              <input
                ref={importInputRef}
                aria-label="Import data"
                className="file-input"
                type="file"
                accept="application/json,application/zip,.json,.zip"
                onChange={(event) => {
                  importSnapshot(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void storage
                    .exportData(data)
                    .then((blob) => downloadBlob(blob, "sojourn-export.zip"));
                }}
              >
                <ArchiveIcon size={16} /> Export archive
              </button>
            </div>
          </div>
        </section>
      )}
      {evidencePreview && (
        <EvidencePreviewModal preview={evidencePreview} onClose={closeEvidencePreview} />
      )}
    </main>
  );
}

function TargetStrip({ progress, label }: { progress: RuleProgress[]; label: string }) {
  return (
    <section className="target-strip" aria-label={label}>
      {progress.map((item) => (
        <TargetCard key={item.rule.id} progress={item} />
      ))}
    </section>
  );
}

function TargetCard({ progress }: { progress: RuleProgress }) {
  const statusLines = splitTargetStatus(progress.statusText);
  return (
    <article className={`target-card ${progress.tone}`}>
      <div className="target-title-row">
        <h2>{progress.rule.label}</h2>
        <span className={`rule-badge ${progress.rule.direction}`}>
          {ruleDirectionLabels[progress.rule.direction]}
        </span>
      </div>
      <p>{progress.rule.description}</p>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="target-meta">
        <span>{progress.detailText}</span>
        <strong className="target-status" aria-label={progress.statusText}>
          {statusLines.map((line, index) => (
            <span key={`${line}-${index}`}>{line}</span>
          ))}
        </strong>
      </div>
      <small>{describeRuleWindow(progress)}</small>
    </article>
  );
}

function splitTargetStatus(status: string): string[] {
  const match = /^(\d+\s+days?)\s+(remaining|to go)$/.exec(status);
  return match ? [`${match[1]} `, match[2] ?? ""] : [status];
}

function CountryOptionsDatalist() {
  return (
    <datalist id="country-code-options">
      {countryOptions.map((code) => (
        <option key={code} value={code}>
          {countryName(code)}
        </option>
      ))}
    </datalist>
  );
}

function CountryCodeField({
  name,
  value,
  defaultValue,
  onChange,
  required = true,
  placeholder = "AE"
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = normalizeCountryCode(event.currentTarget.value);
    if (event.currentTarget.value !== next) {
      event.currentTarget.value = next;
    }
    onChange?.(next);
  };
  return (
    <input
      name={name}
      value={value}
      defaultValue={value === undefined ? normalizeCountryCode(defaultValue ?? "") : undefined}
      onChange={handleChange}
      list="country-code-options"
      maxLength={2}
      pattern="[A-Za-z]{2}"
      placeholder={placeholder}
      required={required}
      autoCapitalize="characters"
    />
  );
}

function TimelineYearMarker({ year }: { year: string }) {
  return (
    <div className="timeline-year-marker" role="separator" aria-label={`Timeline year ${year}`}>
      <span className="timeline-year-dot" aria-hidden="true" />
      <span className="timeline-year-label">{year}</span>
    </div>
  );
}

function EvidencePreviewModal({
  preview,
  onClose
}: {
  preview: EvidencePreview;
  onClose: () => void;
}) {
  const isPdf =
    preview.mimeType === "application/pdf" || preview.item.fileName?.toLowerCase().endsWith(".pdf");
  const isImage =
    preview.mimeType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp)$/iu.test(preview.item.fileName ?? "");
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-preview-title"
      >
        <div className="preview-modal-header">
          <span>
            <strong id="evidence-preview-title">{preview.item.title}</strong>
            <small>{preview.item.fileName ?? evidenceLabel[preview.item.type]}</small>
          </span>
          <button type="button" className="icon-button secondary" aria-label="Close preview" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="preview-modal-body">
          {isPdf && <iframe title={preview.item.title} src={preview.url} />}
          {isImage && !isPdf && <img src={preview.url} alt={preview.item.title} />}
          {!isPdf && !isImage && (
            <div className="preview-fallback">
              <FileText size={24} />
              <span>This file type cannot be previewed inline.</span>
              <a href={preview.url} download={preview.item.fileName ?? preview.item.title}>
                Download file
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
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
  onEndToday,
  onAddProof,
  onCancelProof,
  onSaveProof,
  onStartEditEvidence,
  onCancelEditEvidence,
  onSaveEvidenceEdit,
  onDeleteEvidence,
  onViewEvidence
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
  onEndToday: () => void;
  onAddProof: () => void;
  onCancelProof: () => void;
  onSaveProof: (form: HTMLFormElement) => void;
  onStartEditEvidence: (item: EvidenceItem) => void;
  onCancelEditEvidence: () => void;
  onSaveEvidenceEdit: (form: HTMLFormElement, item: EvidenceItem) => void;
  onDeleteEvidence: (item: EvidenceItem) => void;
  onViewEvidence: (item: EvidenceItem) => void;
}) {
  const isUnaccounted = stay.source === "unaccounted";
  const isActive = isActiveTimelineStay(stay);
  const displayExitDate = isActive ? stay.knownExitDate : stay.exitDate;
  return (
    <article className={`stay-row ${isUnaccounted ? "unaccounted" : ""}`}>
      <span className="timeline-dot" aria-hidden="true" />
      <button type="button" className="stay-summary" onClick={isUnaccounted ? undefined : onToggle}>
        <span className="country-avatar" title={isUnaccounted ? "Unaccounted" : countryName(stay.country)}>
          {isUnaccounted ? <CircleAlert size={17} /> : countryFlag(stay.country)}
        </span>
        <span className="stay-copy">
          <strong>{formatStayTitle(stay)}</strong>
          <small>
            {formatDateRange(stay.entryDate, displayExitDate)} · {stay.label ?? "stay"}
            {isActive && <span className="active-chip">Active</span>}
          </small>
        </span>
        {!isUnaccounted && (
          <span className={`evidence-chip ${stay.evidenceStatus.tone}`}>
            {stay.evidenceStatus.satisfied}/{stay.evidenceStatus.required}
          </span>
        )}
        <span className="stay-duration">{stay.durationDays}d</span>
        {!isUnaccounted &&
          (expanded ? (
            <ChevronUp className="expand-icon" size={16} />
          ) : (
            <ChevronDown className="expand-icon" size={16} />
          ))}
      </button>

      {expanded && !isUnaccounted && (
        <div className="evidence-box">
          <div className="stay-actions">
            <button type="button" className="secondary" onClick={onStartEdit}>
              <Edit3 size={15} /> Edit stay
            </button>
            <button type="button" className="danger-button" onClick={onDelete}>
              <Trash2 size={15} /> Delete
            </button>
            {isActive && (
              <button type="button" className="secondary" onClick={onEndToday}>
                <CalendarDays size={15} /> End today
              </button>
            )}
          </div>

          {editing && <StayEditForm stay={stay} onCancel={onCancelEdit} onSave={onSaveEdit} />}

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
                    onView={() => onViewEvidence(item)}
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
  stay: TimelineStay;
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
        <CountryCodeField name="country" defaultValue={stay.country} />
      </label>
      <label>
        Entry
        <input name="entryDate" type="date" defaultValue={stay.entryDate} required />
      </label>
      <label>
        Exit
        <input name="exitDate" type="date" defaultValue={stay.knownExitDate ?? ""} />
        <span className="field-help">
          Leave blank for your current stay. Future planned stays should include an exit date.
        </span>
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
  onSaveRule: (form: HTMLFormElement, ruleId?: string) => boolean;
  onDeleteRule: (ruleId: string) => void;
  onAddSuggestion: (suggestion: (typeof ruleSuggestions)[number]) => void;
}) {
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [showNewRuleForm, setShowNewRuleForm] = useState(false);

  const saveExistingRule = (form: HTMLFormElement, ruleId: string): void => {
    if (onSaveRule(form, ruleId)) {
      setEditingRuleId(null);
    }
  };

  const saveNewRule = (form: HTMLFormElement): void => {
    if (onSaveRule(form)) {
      setShowNewRuleForm(false);
    }
  };

  return (
    <section className="panel target-editor">
      <div className="panel-title-row">
        <h2>
          <Target size={18} /> Targets
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
          editingRuleId === rule.id ? (
            <RuleForm
              key={rule.id}
              rule={rule}
              onSave={(form) => saveExistingRule(form, rule.id)}
              onDelete={() => {
                onDeleteRule(rule.id);
                setEditingRuleId(null);
              }}
              onCancel={() => setEditingRuleId(null)}
            />
          ) : (
            <RuleSummary
              key={rule.id}
              rule={rule}
              onEdit={() => setEditingRuleId(rule.id)}
              onDelete={() => onDeleteRule(rule.id)}
            />
          )
        ))}
      </div>
      {showNewRuleForm ? (
        <RuleForm onSave={saveNewRule} onCancel={() => setShowNewRuleForm(false)} />
      ) : (
        <button
          type="button"
          className="secondary add-custom-target"
          onClick={() => setShowNewRuleForm(true)}
        >
          <Plus size={15} /> Add Custom Target
        </button>
      )}
    </section>
  );
}

function RuleSummary({
  rule,
  onEdit,
  onDelete
}: {
  rule: Rule;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="rule-summary-row">
      <span className="rule-summary-copy">
        <strong>{rule.label}</strong>
        <small>{rule.description || formatRuleWindowConfig(rule.window)}</small>
      </span>
      <span className="rule-summary-meta">
        <span>{rule.countryScope.join(", ")}</span>
        <span>
          {ruleDirectionLabels[rule.direction]} {rule.threshold}
        </span>
        <span>{formatRuleWindowConfig(rule.window)}</span>
      </span>
      <span className="rule-summary-actions">
        <button
          type="button"
          className="secondary"
          onClick={onEdit}
          aria-label={`Edit ${rule.label}`}
        >
          <Edit3 size={14} /> Edit
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={onDelete}
          aria-label={`Delete ${rule.label}`}
        >
          <Trash2 size={14} /> Delete
        </button>
      </span>
    </article>
  );
}

function formatRuleWindowConfig(window: WindowDefinition): string {
  if (window.type === "fiscal_year") {
    return `Fiscal Year from ${window.startMonth}/${window.startDay}`;
  }
  if (window.type === "rolling_days") {
    return `${window.days}-Day Rolling Window`;
  }
  return "Calendar Year";
}

function RuleForm({
  rule,
  onSave,
  onDelete,
  onCancel
}: {
  rule?: Rule;
  onSave: (form: HTMLFormElement) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  const windowType = rule?.window.type ?? "calendar_year";
  const startMonth = rule?.window.type === "fiscal_year" ? rule.window.startMonth : 1;
  const startDay = rule?.window.type === "fiscal_year" ? rule.window.startDay : 1;
  const rollingDays = rule?.window.type === "rolling_days" ? rule.window.days : 180;
  const [selectedCounting, setSelectedCounting] = useState<VisibleCountingConvention>(
    normalizeVisibleCounting(rule?.counting)
  );
  const [selectedWindowType, setSelectedWindowType] = useState<WindowDefinition["type"]>(
    windowType
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
        <strong>{rule ? rule.label : "Add Custom Target"}</strong>
        {rule && onDelete && (
          <button type="button" className="danger-button" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
      <div className="rule-form-grid">
        <label className="rule-label-field">
          Label
          <input name="label" defaultValue={rule?.label ?? ""} placeholder="India Under 60" />
        </label>
        <label className="rule-countries-field">
          Countries
          <input
            name="countryScope"
            defaultValue={rule?.countryScope.join(", ") ?? "IN"}
            placeholder="IN or FR, DE, ES"
            required
          />
        </label>
        <label className="rule-description-field">
          Description
          <input
            name="description"
            defaultValue={rule?.description ?? ""}
            placeholder="Maximum 59 days · FY Apr-Mar"
          />
        </label>
        <label>
          Direction
          <select name="direction" defaultValue={rule?.direction ?? "ceiling"}>
            <option value="ceiling">Ceiling / Budget</option>
            <option value="minimum">Minimum / Target</option>
          </select>
        </label>
        <label>
          Max or Target Days
          <input
            name="threshold"
            type="number"
            min="1"
            defaultValue={rule?.threshold ?? 59}
            required
          />
        </label>
        <fieldset className="rule-counting-field">
          <legend>Counting</legend>
          <div className="rule-radio-options">
            {countingOptions.map((counting) => (
              <label key={counting} className="rule-radio-option">
                <input
                  type="radio"
                  name="counting"
                  value={counting}
                  checked={selectedCounting === counting}
                  onChange={() => setSelectedCounting(counting)}
                />
                <span>
                  <strong>{countingLabels[counting]}</strong>
                  <span>{countingDescriptions[counting]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rule-window-row">
          <label>
            Year / Window
            <select
              name="windowType"
              value={selectedWindowType}
              onChange={(event) =>
                setSelectedWindowType(event.target.value as WindowDefinition["type"])
              }
            >
              <option value="calendar_year">Calendar Year</option>
              <option value="fiscal_year">Fiscal / Tax Year</option>
              <option value="rolling_days">Rolling Days</option>
            </select>
          </label>
          {selectedWindowType === "fiscal_year" && (
            <>
              <label>
                Fiscal Start Month
                <input
                  name="startMonth"
                  type="number"
                  min="1"
                  max="12"
                  defaultValue={startMonth}
                />
              </label>
              <label>
                Fiscal Start Day
                <input name="startDay" type="number" min="1" max="31" defaultValue={startDay} />
              </label>
            </>
          )}
          {selectedWindowType === "rolling_days" && (
            <label>
              Rolling Window Days
              <input name="rollingDays" type="number" min="1" defaultValue={rollingDays} />
            </label>
          )}
        </div>
      </div>
      <div className="button-row">
        <button type="submit">
          <Save size={15} /> {rule ? "Save Target" : "Add Target"}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            <X size={15} /> Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function EvidenceRow({
  item,
  onView,
  onEdit,
  onDelete
}: {
  item: EvidenceItem;
  onView: () => void;
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
        {item.blobKey && (
          <button type="button" className="icon-button secondary" aria-label={`View ${item.title}`} onClick={onView}>
            <Eye size={14} />
          </button>
        )}
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
  plannedProjections,
  onAddProjection,
  onRemoveProjection
}: {
  projection: ProjectionInput;
  setProjection: React.Dispatch<React.SetStateAction<ProjectionInput>>;
  plannedProjections: ProjectionInput[];
  onAddProjection: (projection: ProjectionInput) => void;
  onRemoveProjection: (index: number) => void;
}) {
  return (
    <section className="panel projection-panel">
      <h2>
        <Target size={18} /> Projection
      </h2>
      <p>Plan one or more future trips against current targets.</p>
      <form
        className="projection-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onAddProjection(projection);
        }}
      >
        <label>
          Country
          <CountryCodeField
            value={projection.country}
            onChange={(country) => setProjection((current) => ({ ...current, country }))}
            required={false}
          />
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
        <button type="submit" className="projection-add-button">
          <Plus size={16} /> Add trip
        </button>
      </form>
      {plannedProjections.length > 0 && (
        <div className="planned-trip-list" aria-label="Planned trips">
          {plannedProjections.map((item, index) => (
            <div key={`${item.country}-${item.entryDate}-${item.exitDate}-${index}`} className="planned-trip-row">
              <span className="country-avatar" title={countryName(item.country)}>
                {countryFlag(item.country)}
              </span>
              <span>
                <strong>{item.label || countryName(item.country)}</strong>
                <small>
                  {countryName(item.country)} · {formatDateRange(item.entryDate, item.exitDate)}
                </small>
              </span>
              <button
                type="button"
                className="icon-button danger-button"
                aria-label={`Remove ${item.label || countryName(item.country)}`}
                onClick={() => onRemoveProjection(index)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
