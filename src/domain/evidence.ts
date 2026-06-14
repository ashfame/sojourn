import type { EvidenceItem, EvidenceStatus } from "./types";

const transportTypes = new Set([
  "flight_ticket",
  "boarding_pass",
  "flight_confirmation_certificate"
]);

export const evidenceLabel: Record<EvidenceItem["type"], string> = {
  visa: "Visa",
  flight_ticket: "Flight ticket",
  boarding_pass: "Boarding pass",
  flight_confirmation_certificate: "Flight confirmation certificate",
  accommodation: "Accommodation",
  entry_stamp: "Entry stamp",
  other: "Other"
};

export const scoreEvidence = (
  evidence: EvidenceItem[],
  options: { ongoing: boolean }
): EvidenceStatus => {
  const hasPermission = evidence.some((item) => item.type === "visa" || item.type === "entry_stamp");
  const transportCount = evidence.filter((item) => transportTypes.has(item.type)).length;
  const hasEntryProof = hasPermission || transportCount >= 1;
  const hasExitProof = options.ongoing || transportCount >= 2 || evidence.some(
    (item) => item.type === "flight_confirmation_certificate"
  );
  const hasAccommodation = evidence.some((item) => item.type === "accommodation");
  const hasAuditTrail = evidence.length >= 2;
  const checks = [
    { label: "entry proof", ok: hasEntryProof },
    { label: "exit proof", ok: hasExitProof },
    { label: "accommodation", ok: hasAccommodation },
    { label: "supporting trail", ok: hasAuditTrail }
  ];
  const satisfied = checks.filter((check) => check.ok).length;
  return {
    satisfied,
    required: checks.length,
    missing: checks.filter((check) => !check.ok).map((check) => check.label),
    tone: satisfied === checks.length ? "complete" : satisfied >= 2 ? "partial" : "weak"
  };
};
