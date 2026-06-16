import { SCHENGEN_COUNTRIES } from "./countries";
import type { AppData, EvidenceItem, Rule, Stay, WindowDefinition } from "./types";

const createdAt = "2026-06-10T00:00:00.000Z";

export const createId = (prefix: string): string => {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const stay = (
  id: string,
  country: string,
  entryDate: string,
  exitDate: string,
  label: string
): Stay => ({
  id,
  country,
  entryDate,
  exitDate,
  label,
  createdAt,
  updatedAt: createdAt
});

const evidence = (
  id: string,
  stayId: string,
  type: EvidenceItem["type"],
  title: string,
  date?: string
): EvidenceItem => ({
  id,
  stayId,
  type,
  title,
  date,
  createdAt
});

export const defaultRules: Rule[] = [
  {
    id: "rule_uae_183",
    label: "UAE tax residency",
    countryScope: ["AE"],
    threshold: 183,
    direction: "minimum",
    window: { type: "calendar_year" },
    counting: "entry_exit_count",
    description: "183 days in calendar year · for TRC"
  },
  {
    id: "rule_india_nri",
    label: "India NRI status",
    countryScope: ["IN"],
    threshold: 59,
    direction: "ceiling",
    window: { type: "fiscal_year", startMonth: 4, startDay: 1 },
    counting: "entry_exit_count",
    description: "Maximum 59 days · FY Apr-Mar"
  },
  {
    id: "rule_schengen_90_180",
    label: "Schengen 90/180",
    countryScope: SCHENGEN_COUNTRIES,
    threshold: 90,
    direction: "ceiling",
    window: { type: "rolling_days", days: 180 },
    counting: "entry_exit_count",
    description: "Rolling 180-day window · all Schengen states"
  }
];

const starterStays: Stay[] = [
  stay("stay_nepal_2026", "NP", "2026-04-02", "2026-05-23", "Pokhara"),
  stay("stay_spain_2026", "ES", "2026-05-24", "2026-06-03", "Tenerife"),
  stay("stay_poland_2026", "PL", "2026-06-03", "2026-06-08", "Krakow, WCEU")
];

const starterEvidence: EvidenceItem[] = [
  evidence("ev_np_visa", "stay_nepal_2026", "entry_stamp", "Visa on arrival stamp", "2026-04-02"),
  evidence("ev_np_flight", "stay_nepal_2026", "flight_ticket", "Flight · DXB → KTM", "2026-04-02"),
  evidence("ev_np_stay", "stay_nepal_2026", "accommodation", "Stay receipts · Pokhara"),
  evidence("ev_es_visa", "stay_spain_2026", "visa", "Schengen visa (Type C)"),
  evidence("ev_es_ticket", "stay_spain_2026", "flight_ticket", "Flight ticket · KTM → TFN", "2026-05-24"),
  evidence("ev_es_boarding", "stay_spain_2026", "boarding_pass", "Boarding pass · May 24", "2026-05-24"),
  evidence("ev_es_hotel", "stay_spain_2026", "accommodation", "Hotel invoice · RF San Borondon"),
  evidence("ev_pl_ticket", "stay_poland_2026", "flight_ticket", "Flight · TFN → KRK", "2026-06-03"),
  evidence("ev_pl_event", "stay_poland_2026", "other", "WCEU ticket · Krakow"),
  evidence("ev_pl_hotel", "stay_poland_2026", "accommodation", "Hotel booking · Krakow")
];

const starterStayIds = new Set(starterStays.map((item) => item.id));
const starterEvidenceIds = new Set(starterEvidence.map((item) => item.id));
const starterRuleIds = new Set(defaultRules.map((item) => item.id));

export const createInitialData = (): AppData => ({
  schemaVersion: 1,
  settings: {
    homeBaseCountry: "AE",
    nationality: "IN",
    legalResidence: "AE",
    countEntryExitDays: true
  },
  stays: [],
  evidence: [],
  rules: [],
  updatedAt: new Date().toISOString()
});

const windowSignature = (window: WindowDefinition): string => {
  if (window.type === "fiscal_year") {
    return `fiscal:${window.startMonth}:${window.startDay}`;
  }
  if (window.type === "rolling_days") {
    return `rolling:${window.days}`;
  }
  return "calendar";
};

const ruleSignature = (rule: Rule): string =>
  [
    [...new Set(rule.countryScope.map((country) => country.toUpperCase()))].sort().join(","),
    rule.direction,
    rule.threshold,
    windowSignature(rule.window),
    rule.counting
  ].join("|");

export const migrateAppData = (data: AppData): AppData => {
  let changed = false;
  const removedStarterStayIds = new Set<string>();
  const stays = data.stays.filter((item) => {
    if (starterStayIds.has(item.id)) {
      removedStarterStayIds.add(item.id);
      changed = true;
      return false;
    }
    return true;
  });
  const evidence = data.evidence.filter((item) => {
    if (starterEvidenceIds.has(item.id) || removedStarterStayIds.has(item.stayId)) {
      changed = true;
      return false;
    }
    return true;
  });
  const migratedRules = data.rules.flatMap((rule) => {
    if (starterRuleIds.has(rule.id)) {
      changed = true;
      return [];
    }
    if (rule.id === "rule_india_nri" && rule.threshold === 60) {
      changed = true;
      return [{
        ...rule,
        threshold: 59,
        description:
          rule.description === "Stay under 60 days · conservative limit"
            ? "Maximum 59 days · FY Apr-Mar"
            : rule.description
      }];
    }
    return [rule];
  });

  const seenRules = new Set<string>();
  const rules: Rule[] = [];
  for (const rule of migratedRules) {
    const signature = ruleSignature(rule);
    if (seenRules.has(signature)) {
      changed = true;
      continue;
    }
    seenRules.add(signature);
    rules.push(rule);
  }

  return changed ? { ...data, stays, evidence, rules } : data;
};
