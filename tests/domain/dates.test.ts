import { afterEach, describe, expect, it, vi } from "vitest";
import { millisecondsUntilNextLocalDay, todayString } from "../../src/domain/dates";

describe("date helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats today from local calendar fields", () => {
    const date = new Date("2026-06-16T22:30:00.000Z");
    vi.spyOn(date, "getFullYear").mockReturnValue(2026);
    vi.spyOn(date, "getMonth").mockReturnValue(5);
    vi.spyOn(date, "getDate").mockReturnValue(17);

    expect(todayString(date)).toBe("2026-06-17");
  });

  it("schedules refresh at the next local day boundary", () => {
    const date = new Date(2026, 5, 16, 23, 59, 59, 500);

    expect(millisecondsUntilNextLocalDay(date)).toBe(1500);
  });
});
