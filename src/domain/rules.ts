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

const endDateFor = (stay: Stay, asOf: string, nextStay?: Stay): string => {
  if (stay.exitDate) {
    return stay.exitDate;
  }
  if (isAfter(stay.entryDate, asOf)) {
    return stay.entryDate;
  }
  if (nextStay && !isAfter(stay.entryDate, nextStay.entryDate)) {
    return minDate(asOf, maxDate(stay.entryDate, addDays(nextStay.entryDate, -1)));
  }
  return asOf;
};

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

  let cursor: string | undefined;
  const timeline: TimelineStay[] = [];

  const pushStay = (
    stay: Stay,
    source: TimelineStay["source"],
    countEntryDate: string,
    countExitDate: string,
    knownExitDate?: string
  ): void => {
    const evidence = evidenceByStay.get(stay.id) ?? [];
    timeline.push({
      ...stay,
      source,
      countEntryDate,
      countExitDate,
      ...(knownExitDate ? { knownExitDate } : {}),
      durationDays: daysInclusive(countEntryDate, countExitDate),
      evidence,
      evidenceStatus: scoreEvidence(evidence, { ongoing: knownExitDate === undefined })
    });
  };

  const pushUnaccounted = (start: string, end: string): void => {
    const durationDays = daysInclusive(start, end);
    timeline.push({
      id: `gap_${start}_${end}`,
      country: "",
      entryDate: start,
      exitDate: end,
      label: `${durationDays} days unaccounted for`,
      createdAt: data.updatedAt,
      updatedAt: data.updatedAt,
      source: "unaccounted",
      countEntryDate: start,
      countExitDate: end,
      durationDays,
      evidence: [],
      evidenceStatus: { satisfied: 0, required: 0, missing: [], tone: "weak" }
    });
  };

  const endDateAt = (index: number): string =>
    endDateFor(stays[index]!, asOf, stays[index + 1]);

  const timelineEnd = stays.reduce(
    (latest, _stay, index) => maxDate(latest, endDateAt(index)),
    asOf
  );

  for (let index = 0; index < stays.length; index += 1) {
    const stay = stays[index]!;
    const stayEnd = endDateAt(index);
    if (cursor && isBefore(cursor, stay.entryDate)) {
      const gapEnd = addDays(stay.entryDate, -1);
      pushUnaccounted(cursor, gapEnd);
    }
    pushStay(
      { ...stay, exitDate: stayEnd },
      "explicit",
      stay.entryDate,
      stayEnd,
      stay.exitDate
    );
    cursor = addDays(cursor ? maxDate(cursor, stayEnd) : stayEnd, 1);
  }

  if (cursor && !isAfter(cursor, timelineEnd)) {
    pushUnaccounted(cursor, timelineEnd);
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
    const clippedEnd = minDate(stay.countExitDate, periodEnd);
    const shouldExcludeExit =
      rule.counting === "exclude_exit_day" &&
      stay.knownExitDate !== undefined &&
      !isAfter(stay.knownExitDate, periodEnd);
    const end = shouldExcludeExit ? addDays(clippedEnd, -1) : clippedEnd;
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
      status: remaining === 0 ? "safe" : `${remaining} days to go`,
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
  if (timeline.length === 0) {
    return "No stays yet";
  }
  const trackedDates = new Set<string>();
  for (const stay of timeline) {
    if (stay.source === "explicit") {
      for (const day of eachDayInclusive(stay.countEntryDate, stay.countExitDate)) {
        trackedDates.add(day);
      }
    }
  }
  const trackedDays = trackedDates.size;
  const unaccountedDays = timeline
    .filter((stay) => stay.source === "unaccounted")
    .reduce((sum, stay) => sum + stay.durationDays, 0);
  const countries = new Set(
    timeline.filter((stay) => stay.source === "explicit").map((stay) => stay.country)
  );
  return unaccountedDays > 0
    ? `${trackedDays} days tracked · ${unaccountedDays} unaccounted`
    : `${trackedDays} days tracked · ${countries.size} countries`;
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

export const formatStayTitle = (stay: TimelineStay): string =>
  stay.source === "unaccounted" ? "Unaccounted period" : countryName(stay.country);

export const ruleAsOfDate = (extraStays: Stay[], fallback: string): string =>
  extraStays.reduce((asOf, stay) => {
    const end = stay.exitDate ?? asOf;
    return isAfter(end, asOf) ? end : asOf;
  }, fallback);

export const currentYearStart = (date = new Date()): string =>
  `${date.getUTCFullYear()}-01-01`;

export const normalizeDateInput = (value: string): string => toDateString(toUtcDate(value));
