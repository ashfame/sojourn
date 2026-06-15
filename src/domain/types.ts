export type CountryCode = string;

export type EvidenceType =
  | "visa"
  | "flight_ticket"
  | "boarding_pass"
  | "flight_confirmation_certificate"
  | "accommodation"
  | "entry_stamp"
  | "other";

export type RuleDirection = "minimum" | "ceiling";

export type WindowDefinition =
  | { type: "calendar_year" }
  | { type: "fiscal_year"; startMonth: number; startDay: number }
  | { type: "rolling_days"; days: number };

export type CountingConvention =
  | "entry_exit_count"
  | "presence_any_part"
  | "exclude_exit_day";

export interface Stay {
  id: string;
  country: CountryCode;
  entryDate: string;
  exitDate?: string | undefined;
  label?: string | undefined;
  projected?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineStay extends Stay {
  source: "explicit" | "unaccounted";
  countEntryDate: string;
  countExitDate: string;
  knownExitDate?: string | undefined;
  durationDays: number;
  evidence: EvidenceItem[];
  evidenceStatus: EvidenceStatus;
}

export interface EvidenceItem {
  id: string;
  stayId: string;
  type: EvidenceType;
  title: string;
  date?: string | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  blobKey?: string | undefined;
  createdAt: string;
}

export interface EvidenceStatus {
  satisfied: number;
  required: number;
  missing: string[];
  tone: "complete" | "partial" | "weak";
}

export interface Rule {
  id: string;
  label: string;
  countryScope: CountryCode[];
  threshold: number;
  direction: RuleDirection;
  window: WindowDefinition;
  counting: CountingConvention;
  description: string;
}

export interface RuleProgress {
  rule: Rule;
  periodStart: string;
  periodEnd: string;
  windowLabel: string;
  usedDays: number;
  threshold: number;
  percent: number;
  remaining: number;
  tone: "safe" | "good" | "watch" | "danger" | "neutral";
  statusText: string;
  detailText: string;
}

export interface AppSettings {
  homeBaseCountry: CountryCode;
  nationality: CountryCode;
  legalResidence: CountryCode;
  countEntryExitDays: boolean;
}

export interface AppData {
  schemaVersion: 1;
  settings: AppSettings;
  stays: Stay[];
  evidence: EvidenceItem[];
  rules: Rule[];
  updatedAt: string;
}

export interface ProjectionInput {
  country: CountryCode;
  entryDate: string;
  exitDate: string;
  label: string;
}
