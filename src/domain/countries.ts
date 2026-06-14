import type { CountryCode } from "./types";

export const COUNTRY_NAMES: Record<CountryCode, string> = {
  AE: "United Arab Emirates",
  IN: "India",
  NP: "Nepal",
  ES: "Spain",
  PL: "Poland",
  FR: "France",
  DE: "Germany",
  IT: "Italy",
  NL: "Netherlands",
  PT: "Portugal",
  CH: "Switzerland",
  AT: "Austria",
  BE: "Belgium",
  CZ: "Czechia",
  GR: "Greece"
};

export const SCHENGEN_COUNTRIES: CountryCode[] = [
  "AT",
  "BE",
  "CH",
  "CZ",
  "DE",
  "ES",
  "FR",
  "GR",
  "IT",
  "NL",
  "PL",
  "PT"
];

export const countryName = (code: CountryCode): string => COUNTRY_NAMES[code] ?? code;

export const countryInitials = (code: CountryCode): string => code.slice(0, 2).toUpperCase();
