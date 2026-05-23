import { Temporal } from "@js-temporal/polyfill";
import type { TaxYearProfile, TaxYearRange } from "./types";

const pad2 = (value: number): string => value.toString().padStart(2, "0");

export const todayInTimeZone = (timeZone: string): string =>
  Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate().toString();

export const plainDate = (date: string): Temporal.PlainDate =>
  Temporal.PlainDate.from(date);

export const instantToDateInTimeZone = (isoInstant: string, timeZone: string): string =>
  Temporal.Instant.from(isoInstant).toZonedDateTimeISO(timeZone).toPlainDate().toString();

export const localDateTimeToInstant = (
  localDateTime: string,
  timeZone: string
): string => {
  const dateTime = Temporal.PlainDateTime.from(localDateTime);
  return dateTime.toZonedDateTime(timeZone).toInstant().toString();
};

export const getTaxYearRange = (
  profile: TaxYearProfile,
  startYear: number
): TaxYearRange => {
  const startDate = Temporal.PlainDate.from(
    `${startYear}-${pad2(profile.start_month)}-${pad2(profile.start_day)}`
  );
  const endDate = startDate.add({ years: 1 }).subtract({ days: 1 });
  const label =
    profile.start_month === 1 && profile.start_day === 1
      ? `${startYear}`
      : `${startYear}-${(startYear + 1).toString().slice(-2)}`;

  return {
    profile,
    start_year: startYear,
    start_date: startDate.toString(),
    end_date: endDate.toString(),
    label
  };
};

export const currentTaxYearStart = (
  profile: TaxYearProfile,
  date = todayInTimeZone(profile.timezone)
): number => {
  const current = Temporal.PlainDate.from(date);
  const candidate = Temporal.PlainDate.from(
    `${current.year}-${pad2(profile.start_month)}-${pad2(profile.start_day)}`
  );
  return Temporal.PlainDate.compare(current, candidate) >= 0
    ? current.year
    : current.year - 1;
};

export const eachDateInclusive = (startDate: string, endDate: string): string[] => {
  const start = Temporal.PlainDate.from(startDate);
  const end = Temporal.PlainDate.from(endDate);
  if (Temporal.PlainDate.compare(start, end) > 0) {
    return [];
  }

  const dates: string[] = [];
  for (
    let cursor = start;
    Temporal.PlainDate.compare(cursor, end) <= 0;
    cursor = cursor.add({ days: 1 })
  ) {
    dates.push(cursor.toString());
  }
  return dates;
};

export const clampDateRange = (
  startDate: string,
  endDate: string,
  minDate: string,
  maxDate: string
): { start: string; end: string } | null => {
  const start = Temporal.PlainDate.compare(startDate, minDate) < 0 ? minDate : startDate;
  const end = Temporal.PlainDate.compare(endDate, maxDate) > 0 ? maxDate : endDate;
  if (Temporal.PlainDate.compare(start, end) > 0) {
    return null;
  }
  return { start, end };
};

export const addDays = (date: string, days: number): string =>
  Temporal.PlainDate.from(date).add({ days }).toString();

export const isWithinInclusive = (
  date: string,
  startDate: string,
  endDate: string
): boolean =>
  Temporal.PlainDate.compare(date, startDate) >= 0 &&
  Temporal.PlainDate.compare(date, endDate) <= 0;
