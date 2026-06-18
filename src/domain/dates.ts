const MS_PER_DAY = 24 * 60 * 60 * 1000;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const padDatePart = (value: number): string => String(value).padStart(2, "0");

export const assertDateString = (value: string): string => {
  if (!datePattern.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return value;
};

export const toUtcDate = (value: string): Date => {
  assertDateString(value);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
};

export const toDateString = (date: Date): string => date.toISOString().slice(0, 10);

export const todayString = (date = new Date()): string =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

export const millisecondsUntilNextLocalDay = (date = new Date()): number => {
  const nextDay = new Date(date);
  nextDay.setHours(24, 0, 1, 0);
  return Math.max(1000, nextDay.getTime() - date.getTime());
};

export const addDays = (value: string, days: number): string =>
  toDateString(new Date(toUtcDate(value).getTime() + days * MS_PER_DAY));

export const compareDate = (left: string, right: string): number =>
  toUtcDate(left).getTime() - toUtcDate(right).getTime();

export const isBefore = (left: string, right: string): boolean => compareDate(left, right) < 0;

export const isAfter = (left: string, right: string): boolean => compareDate(left, right) > 0;

export const minDate = (left: string, right: string): string =>
  isBefore(left, right) ? left : right;

export const maxDate = (left: string, right: string): string =>
  isAfter(left, right) ? left : right;

export const daysInclusive = (start: string, end: string): number =>
  Math.max(0, Math.floor((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / MS_PER_DAY) + 1);

export const eachDayInclusive = (start: string, end: string): string[] => {
  const days = daysInclusive(start, end);
  return Array.from({ length: days }, (_, index) => addDays(start, index));
};

export const formatDateShort = (value: string): string =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    toUtcDate(value)
  );

export const formatDateRange = (start: string, end?: string): string =>
  `${formatDateShort(start)} ${end ? `– ${formatDateShort(end)}` : "→ ongoing"}`;

export const yearOf = (value: string): number => toUtcDate(value).getUTCFullYear();
