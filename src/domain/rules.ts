import { countryName } from "./countries";
import {
  addDays,
  compareDate,
  daysInclusive,
  eachDayInclusive,
  formatDateShort,
  isAfter,
  isBefore,
  maxDate,
  minDate,
  toDateString,
  toUtcDate,
  yearOf
} from "./dates";
import { scoreEvidence } from "./evidence";
import type {
  AppData,
  EvidenceItem,
  Rule,
  RuleProgress,
  Stay,
  TimelineStay,
  WindowDefinition
} from "./types";

const sortedStaysAsc = (stays: Stay[]): Stay[] =>
  [...stays].sort((left, right) => compareDate(left.entryDate, right.entryDate));

const endDateFor = (stay: Stay, asOf: string): string => stay.exitDate ?? asOf;

export const createTimeline = (
  data: AppData,
  asOf: string,
  extraStays: Stay[] = []
): TimelineStay[] => {
  const stays = sortedStaysAsc([...data.stays, ...extraStays]);
  const evidenceByStay = new Map<string, EvidenceItem[]>();
  for (const item of data.evidence) {
    evidenceByStay.set(item.stayId, [...(evidenceByStay.get(item.stayId) ?? []), item]);
  }

  const yearStart = `${yearOf(asOf)}-01-01`;
  let cursor = yearStart;
  let trailingHomeStartCandidate: string | undefined;
  const timeline: TimelineStay[] = [];

  const pushStay = (
    stay: Stay,
    source: TimelineStay["source"],
    countEntryDate: string,
    countExitDate: string,
    durationEntryDate = countEntryDate,
    durationExitDate = countExitDate
  ): void => {
    const evidence = evidenceByStay.get(stay.id) ?? [];
    timeline.push({
      ...stay,
      source,
      countEntryDate,
      countExitDate,
      durationDays: daysInclusive(durationEntryDate, durationExitDate),
      evidence,
      evidenceStatus: scoreEvidence(evidence, { ongoing: !stay.exitDate })
    });
  };

  for (const stay of stays) {
    if (isAfter(stay.entryDate, asOf)) {
      continue;
    }
    const stayEnd = minDate(endDateFor(stay, asOf), asOf);
    if (isBefore(cursor, stay.entryDate)) {
      const gapEnd = addDays(stay.entryDate, -1);
      pushStay(
        {
          id: `home_${cursor}_${gapEnd}`,
          country: data.settings.homeBaseCountry,
          entryDate: cursor,
          exitDate: gapEnd,
          label: "home base",
          createdAt: data.updatedAt,
          updatedAt: data.updatedAt
        },
        "inferred_home_base",
        cursor,
        gapEnd
      );
    }
    const durationStart = maxDate(stay.entryDate, cursor);
    pushStay(
      { ...stay, exitDate: stayEnd },
      "explicit",
      stay.entryDate,
      stayEnd,
      isAfter(durationStart, stayEnd) ? stay.entryDate : durationStart,
      stayEnd
    );
    cursor = addDays(maxDate(cursor, stayEnd), 1);
    trailingHomeStartCandidate =
      stay.country === data.settings.homeBaseCountry ? cursor : minDate(stayEnd, asOf);
  }

  const trailingHomeStart = trailingHomeStartCandidate ?? cursor;
  if (!isAfter(trailingHomeStart, asOf)) {
    pushStay(
      {
        id: `home_${trailingHomeStart}_open`,
        country: data.settings.homeBaseCountry,
        entryDate: trailingHomeStart,
        label: "home base",
        createdAt: data.updatedAt,
        updatedAt: data.updatedAt
      },
      "inferred_home_base",
      trailingHomeStart,
      asOf
    );
  }

  return timeline.sort((left, right) => compareDate(right.entryDate, left.entryDate));
};

const getWindowRange = (
  window: WindowDefinition,
  asOf: string
): { start: string; end: string; label: string } => {
  const year = yearOf(asOf);
  if (window.type === "calendar_year") {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      label: `${year} calendar year`
    };
  }
  if (window.type === "fiscal_year") {
    const currentStart = toDateString(
      new Date(Date.UTC(year, window.startMonth - 1, window.startDay))
    );
    const start = isBefore(asOf, currentStart)
      ? toDateString(new Date(Date.UTC(year - 1, window.startMonth - 1, window.startDay)))
      : currentStart;
    const end = addDays(
      toDateString(
        new Date(Date.UTC(yearOf(start) + 1, window.startMonth - 1, window.startDay))
      ),
      -1
    );
    return {
      start,
      end,
      label: `FY ${yearOf(start)}-${String(yearOf(end)).slice(2)}`
    };
  }
  const start = addDays(asOf, -(window.days - 1));
  return {
    start,
    end: asOf,
    label: `${window.days}-day rolling window`
  };
};

const countRuleDays = (
  timeline: TimelineStay[],
  rule: Rule,
  periodStart: string,
  periodEnd: string
): number => {
  const countries = new Set(rule.countryScope);
  const counted = new Set<string>();
  for (const stay of timeline) {
    if (!countries.has(stay.country)) {
      continue;
    }
    const start = maxDate(stay.countEntryDate, periodStart);
    const end = minDate(stay.countExitDate, periodEnd);
    if (isAfter(start, end)) {
      continue;
    }
    for (const day of eachDayInclusive(start, end)) {
      counted.add(day);
    }
  }
  return counted.size;
};

const toneFor = (rule: Rule, usedDays: number): RuleProgress["tone"] => {
  const ratio = usedDays / rule.threshold;
  if (rule.direction === "minimum") {
    if (ratio >= 1) {
      return "safe";
    }
    return ratio >= 0.65 ? "good" : "neutral";
  }
  if (ratio >= 0.9) {
    return "danger";
  }
  if (ratio >= 0.7) {
    return "watch";
  }
  return "good";
};

const progressText = (rule: Rule, usedDays: number): { status: string; detail: string } => {
  const remaining = Math.max(0, rule.threshold - usedDays);
  if (rule.direction === "minimum") {
    return {
      status: remaining === 0 ? "safe" : `${remaining} to go`,
      detail: `${usedDays} of ${rule.threshold} days`
    };
  }
  return {
    status: remaining === 0 ? "limit reached" : `${remaining} days remaining`,
    detail: `${usedDays} of ${rule.threshold} days used`
  };
};

export const computeRuleProgress = (
  data: AppData,
  asOf: string,
  extraStays: Stay[] = []
): RuleProgress[] => {
  const timeline = createTimeline(data, asOf, extraStays);
  return data.rules.map((rule) => {
    const range = getWindowRange(rule.window, asOf);
    const usedDays = countRuleDays(timeline, rule, range.start, range.end);
    const { status, detail } = progressText(rule, usedDays);
    return {
      rule,
      periodStart: range.start,
      periodEnd: range.end,
      windowLabel: range.label,
      usedDays,
      threshold: rule.threshold,
      percent: Math.min(100, Math.round((usedDays / rule.threshold) * 100)),
      remaining: Math.max(0, rule.threshold - usedDays),
      tone: toneFor(rule, usedDays),
      statusText: status,
      detailText: detail
    };
  });
};

export const timelineSummary = (timeline: TimelineStay[]): string => {
  const totalDays = timeline.reduce((sum, stay) => sum + stay.durationDays, 0);
  const countries = new Set(timeline.map((stay) => stay.country));
  return `${totalDays} days tracked · ${countries.size} countries`;
};

export const describeRuleWindow = (progress: RuleProgress): string =>
  `${formatDateShort(progress.periodStart)} – ${formatDateShort(progress.periodEnd)} · ${
    progress.windowLabel
  }`;

export const projectionStay = (
  input: { country: string; entryDate: string; exitDate: string; label: string },
  nowIso = new Date().toISOString()
): Stay => ({
  id: "projection_active",
  country: input.country.toUpperCase(),
  entryDate: input.entryDate,
  exitDate: input.exitDate,
  label: input.label || "projection",
  projected: true,
  createdAt: nowIso,
  updatedAt: nowIso
});

export const formatStayTitle = (stay: TimelineStay): string => countryName(stay.country);

export const ruleAsOfDate = (extraStays: Stay[], fallback: string): string =>
  extraStays.reduce((asOf, stay) => {
    const end = stay.exitDate ?? asOf;
    return isAfter(end, asOf) ? end : asOf;
  }, fallback);

export const currentYearStart = (date = new Date()): string =>
  `${date.getUTCFullYear()}-01-01`;

export const normalizeDateInput = (value: string): string => toDateString(toUtcDate(value));
