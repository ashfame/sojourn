import { describe, expect, it } from "vitest";
import { createInitialData, defaultRules } from "../../src/domain/seed";
import { computeRuleProgress, createTimeline, projectionStay } from "../../src/domain/rules";
import type { AppData } from "../../src/domain/types";

const progressByRule = (data: AppData, asOf: string) =>
  new Map(computeRuleProgress(data, asOf).map((item) => [item.rule.id, item]));

const sampleData = (): AppData => ({
  ...createInitialData(),
  rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] })),
  stays: [
    {
      id: "stay_nepal_2026",
      country: "NP",
      entryDate: "2026-04-02",
      exitDate: "2026-05-23",
      label: "Pokhara",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z"
    },
    {
      id: "stay_spain_2026",
      country: "ES",
      entryDate: "2026-05-24",
      exitDate: "2026-06-03",
      label: "Tenerife",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z"
    },
    {
      id: "stay_poland_2026",
      country: "PL",
      entryDate: "2026-06-03",
      exitDate: "2026-06-08",
      label: "Krakow, WCEU",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z"
    }
  ]
});

describe("rule engine", () => {
  it("starts with no targets or stays", () => {
    const data = createInitialData();

    expect(data.rules).toHaveLength(0);
    expect(data.stays).toHaveLength(0);
    expect(createTimeline(data, "2026-06-10")).toHaveLength(0);
  });

  it("renders unaccounted gaps around explicit travel", () => {
    const data = createInitialData();
    data.stays.push(
      {
        id: "stay_india_1",
        country: "IN",
        entryDate: "2026-04-10",
        exitDate: "2026-04-19",
        label: "Family visit",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      },
      {
        id: "stay_india_2",
        country: "IN",
        entryDate: "2026-05-01",
        exitDate: "2026-05-02",
        label: "Follow-up",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      }
    );

    const timeline = createTimeline(data, "2026-05-02");

    expect(timeline.some((stay) => stay.source === "unaccounted" && stay.durationDays === 11)).toBe(
      true
    );
    expect(timeline.some((stay) => stay.label === "11 days unaccounted for")).toBe(true);
  });

  it("shows inclusive display durations for explicit travel", () => {
    const data = sampleData();
    const timeline = createTimeline(data, "2026-06-10");

    expect(timeline.some((stay) => stay.source === "unaccounted" && stay.entryDate === "2026-06-09")).toBe(
      true
    );
    expect(timeline.some((stay) => stay.country === "PL" && stay.durationDays === 6)).toBe(true);
    expect(timeline.some((stay) => stay.country === "ES" && stay.durationDays === 11)).toBe(true);
  });

  it("shows India stays as inclusive ranges even when arrival overlaps a transfer day", () => {
    const data = createInitialData();
    data.stays.push(
      {
        id: "stay_uae_before_march_india",
        country: "AE",
        entryDate: "2026-03-01",
        exitDate: "2026-03-10",
        label: "Dubai",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      },
      {
        id: "stay_india_march",
        country: "IN",
        entryDate: "2026-03-10",
        exitDate: "2026-03-14",
        label: "March India",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z"
      },
      {
        id: "stay_uae_before_may_india",
        country: "AE",
        entryDate: "2026-05-01",
        exitDate: "2026-05-18",
        label: "Dubai",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "stay_india_may",
        country: "IN",
        entryDate: "2026-05-18",
        exitDate: "2026-05-24",
        label: "May India",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z"
      },
      {
        id: "stay_india_june_active",
        country: "IN",
        entryDate: "2026-06-08",
        label: "June India",
        createdAt: "2026-06-08T00:00:00.000Z",
        updatedAt: "2026-06-08T00:00:00.000Z"
      }
    );

    const timeline = createTimeline(data, "2026-06-16");

    expect(timeline.find((stay) => stay.id === "stay_india_march")?.durationDays).toBe(5);
    expect(timeline.find((stay) => stay.id === "stay_india_may")?.durationDays).toBe(7);
    expect(timeline.find((stay) => stay.id === "stay_india_june_active")?.durationDays).toBe(9);
  });

  it("counts UAE minimum days in a calendar year", () => {
    const data = sampleData();
    const uae = progressByRule(data, "2026-06-10").get("rule_uae_183");

    expect(uae?.usedDays).toBe(0);
    expect(uae?.remaining).toBe(183);
    expect(uae?.rule.direction).toBe("minimum");
  });

  it("does not count closed prior-period stays in the current target window", () => {
    const data = {
      ...createInitialData(),
      rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] })),
      stays: [
        {
          id: "stay_uae_last_year",
          country: "AE",
          entryDate: "2025-11-01",
          exitDate: "2025-12-31",
          label: "Previous calendar year",
          createdAt: "2025-11-01T00:00:00.000Z",
          updatedAt: "2025-11-01T00:00:00.000Z"
        },
        {
          id: "stay_india_previous_fy",
          country: "IN",
          entryDate: "2026-01-10",
          exitDate: "2026-01-20",
          label: "Previous India fiscal year",
          createdAt: "2026-01-10T00:00:00.000Z",
          updatedAt: "2026-01-10T00:00:00.000Z"
        }
      ]
    };

    const progress = progressByRule(data, "2026-06-15");

    expect(progress.get("rule_uae_183")?.windowLabel).toBe("2026 calendar year");
    expect(progress.get("rule_uae_183")?.usedDays).toBe(0);
    expect(progress.get("rule_india_nri")?.windowLabel).toBe("FY 2026-27");
    expect(progress.get("rule_india_nri")?.usedDays).toBe(0);
  });

  it("extends an active stay through the current as-of date", () => {
    const data = {
      ...createInitialData(),
      rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] })),
      stays: [
        {
          id: "stay_uae_active",
          country: "AE",
          entryDate: "2026-06-10",
          label: "Current stay",
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    };

    const firstDay = progressByRule(data, "2026-06-10").get("rule_uae_183");
    const secondDay = progressByRule(data, "2026-06-11").get("rule_uae_183");
    const timeline = createTimeline(data, "2026-06-11");

    expect(firstDay?.usedDays).toBe(1);
    expect(secondDay?.usedDays).toBe(2);
    expect(timeline[0]).toMatchObject({
      id: "stay_uae_active",
      exitDate: "2026-06-11",
      durationDays: 2
    });
    expect(timeline[0]?.knownExitDate).toBeUndefined();
  });

  it("caps active stays before projected stays instead of extending them to the projection horizon", () => {
    const data = {
      ...createInitialData(),
      rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] })),
      stays: [
        {
          id: "stay_india_active",
          country: "IN",
          entryDate: "2026-06-01",
          label: "Current India stay",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    };
    const nepal = {
      ...projectionStay({
        country: "NP",
        entryDate: "2026-06-17",
        exitDate: "2026-06-30",
        label: "June Nepal"
      }),
      id: "projection_nepal"
    };
    const uae = {
      ...projectionStay({
        country: "AE",
        entryDate: "2026-07-01",
        exitDate: "2026-07-31",
        label: "July UAE"
      }),
      id: "projection_uae"
    };

    const projectedProgress = new Map(
      computeRuleProgress(data, "2026-07-31", [nepal, uae]).map((item) => [
        item.rule.id,
        item
      ])
    );
    const timeline = createTimeline(data, "2026-07-31", [nepal, uae]);

    expect(projectedProgress.get("rule_india_nri")?.usedDays).toBe(16);
    expect(projectedProgress.get("rule_uae_183")?.usedDays).toBe(31);
    expect(timeline.find((stay) => stay.id === "stay_india_active")).toMatchObject({
      exitDate: "2026-06-16",
      countExitDate: "2026-06-16",
      durationDays: 16
    });
  });

  it("counts stored dated stays through a known future exit", () => {
    const data = {
      ...createInitialData(),
      rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] })),
      stays: [
        {
          id: "stay_uae_known_future_exit",
          country: "AE",
          entryDate: "2025-12-15",
          exitDate: "2026-12-31",
          label: "Current stay with planned exit",
          createdAt: "2025-12-15T00:00:00.000Z",
          updatedAt: "2025-12-15T00:00:00.000Z"
        }
      ]
    };

    const uae = progressByRule(data, "2026-06-15").get("rule_uae_183");
    const timeline = createTimeline(data, "2026-06-15");

    expect(uae?.usedDays).toBe(365);
    expect(timeline[0]).toMatchObject({
      id: "stay_uae_known_future_exit",
      exitDate: "2026-12-31",
      knownExitDate: "2026-12-31",
      durationDays: 382
    });
  });

  it("counts future planned stays in the current target window", () => {
    const data = {
      ...createInitialData(),
      rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] })),
      stays: [
        {
          id: "stay_uae_future",
          country: "AE",
          entryDate: "2026-08-01",
          exitDate: "2026-08-10",
          label: "Planned Dubai stay",
          createdAt: "2026-06-15T00:00:00.000Z",
          updatedAt: "2026-06-15T00:00:00.000Z"
        }
      ]
    };

    const uae = progressByRule(data, "2026-06-15").get("rule_uae_183");
    const timeline = createTimeline(data, "2026-06-15");

    expect(uae?.usedDays).toBe(10);
    expect(uae?.statusText).toBe("173 days to go");
    expect(timeline[0]).toMatchObject({
      id: "stay_uae_future",
      entryDate: "2026-08-01",
      exitDate: "2026-08-10",
      durationDays: 10
    });
  });

  it("counts India ceiling days in an Apr-Mar fiscal year", () => {
    const data = sampleData();
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

  it("can exclude the exit day for nights-style counting", () => {
    const data = sampleData();
    data.rules.push({
      id: "rule_india_nights",
      label: "India nights",
      countryScope: ["IN"],
      threshold: 59,
      direction: "ceiling",
      window: { type: "fiscal_year", startMonth: 4, startDay: 1 },
      counting: "exclude_exit_day",
      description: "Exit day does not count"
    });
    data.stays.push({
      id: "stay_india",
      country: "IN",
      entryDate: "2026-04-10",
      exitDate: "2026-04-19",
      label: "Family visit",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    });

    const nights = progressByRule(data, "2026-06-10").get("rule_india_nights");

    expect(nights?.usedDays).toBe(9);
  });

  it("does not drop the reporting period end when exit-day exclusion falls after the window", () => {
    const data = sampleData();
    data.rules.push({
      id: "rule_fr_nights",
      label: "France nights",
      countryScope: ["FR"],
      threshold: 90,
      direction: "ceiling",
      window: { type: "calendar_year" },
      counting: "exclude_exit_day",
      description: "Exit day does not count"
    });
    data.stays.push({
      id: "stay_fr_long",
      country: "FR",
      entryDate: "2026-12-30",
      exitDate: "2027-01-05",
      label: "Year boundary",
      createdAt: "2026-12-01T00:00:00.000Z",
      updatedAt: "2026-12-01T00:00:00.000Z"
    });

    const france = progressByRule(data, "2026-12-31").get("rule_fr_nights");

    expect(france?.usedDays).toBe(2);
  });

  it("counts Schengen days in the rolling 180-day window", () => {
    const data = sampleData();
    const schengen = progressByRule(data, "2026-06-10").get("rule_schengen_90_180");

    expect(schengen?.usedDays).toBe(16);
    expect(schengen?.remaining).toBe(74);
    expect(schengen?.windowLabel).toBe("180-day rolling window");
  });

  it("uses the same rules for future projections", () => {
    const data = sampleData();
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
