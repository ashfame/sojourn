import { describe, expect, it } from "vitest";
import { createInitialData } from "../../src/domain/seed";
import { computeRuleProgress, createTimeline, projectionStay } from "../../src/domain/rules";
import type { AppData } from "../../src/domain/types";

const progressByRule = (data: AppData, asOf: string) =>
  new Map(computeRuleProgress(data, asOf).map((item) => [item.rule.id, item]));

describe("rule engine", () => {
  it("infers home-base stays around explicit travel", () => {
    const data = createInitialData();
    const timeline = createTimeline(data, "2026-06-10");

    expect(timeline[0]).toMatchObject({
      country: "AE",
      source: "inferred_home_base",
      entryDate: "2026-06-08"
    });
    expect(timeline.some((stay) => stay.country === "PL" && stay.durationDays === 5)).toBe(true);
    expect(timeline.some((stay) => stay.country === "ES" && stay.durationDays === 11)).toBe(true);
    expect(timeline.some((stay) => stay.country === "AE" && stay.entryDate === "2026-01-01")).toBe(
      true
    );
  });

  it("counts UAE minimum days in a calendar year", () => {
    const data = createInitialData();
    const uae = progressByRule(data, "2026-06-10").get("rule_uae_183");

    expect(uae?.usedDays).toBe(94);
    expect(uae?.remaining).toBe(89);
    expect(uae?.rule.direction).toBe("minimum");
  });

  it("counts India ceiling days in an Apr-Mar fiscal year", () => {
    const data = createInitialData();
    data.stays.push({
      id: "stay_india",
      country: "IN",
      entryDate: "2026-04-10",
      exitDate: "2026-04-19",
      label: "Family visit",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    });

    const india = progressByRule(data, "2026-06-10").get("rule_india_nri");

    expect(india?.windowLabel).toBe("FY 2026-27");
    expect(india?.usedDays).toBe(10);
    expect(india?.threshold).toBe(59);
    expect(india?.remaining).toBe(49);
  });

  it("counts Schengen days in the rolling 180-day window", () => {
    const data = createInitialData();
    const schengen = progressByRule(data, "2026-06-10").get("rule_schengen_90_180");

    expect(schengen?.usedDays).toBe(16);
    expect(schengen?.remaining).toBe(74);
    expect(schengen?.windowLabel).toBe("180-day rolling window");
  });

  it("uses the same rules for future projections", () => {
    const data = createInitialData();
    const projected = projectionStay({
      country: "NP",
      entryDate: "2026-08-01",
      exitDate: "2026-11-15",
      label: "Sabbatical"
    });
    const projectedProgress = new Map(
      computeRuleProgress(data, "2026-11-15", [projected]).map((item) => [
        item.rule.id,
        item
      ])
    );

    expect(projectedProgress.get("rule_uae_183")?.usedDays).toBeLessThan(183);
    expect(projectedProgress.get("rule_uae_183")?.statusText).toContain("to go");
  });
});
