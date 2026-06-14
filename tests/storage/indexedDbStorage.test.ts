import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createInitialData, migrateAppData } from "../../src/domain/seed";
import { createIndexedDbStorage } from "../../src/storage/indexedDbStorage";

describe("indexedDbStorage", () => {
  it("loads seeded data on first run", async () => {
    const storage = createIndexedDbStorage();
    const snapshot = await storage.load();

    expect(snapshot.data.stays.length).toBeGreaterThan(0);
    expect(snapshot.metadata.backend).toBe("indexeddb");
  });

  it("saves and reloads app data through the storage driver interface", async () => {
    const storage = createIndexedDbStorage();
    const data = createInitialData();
    const next = {
      ...data,
      stays: [
        ...data.stays,
        {
          id: "stay_test",
          country: "IN",
          entryDate: "2026-12-01",
          exitDate: "2026-12-02",
          label: "Test",
          createdAt: "2026-12-01T00:00:00.000Z",
          updatedAt: "2026-12-01T00:00:00.000Z"
        }
      ]
    };

    await storage.save(next);
    const reloaded = await storage.load();

    expect(reloaded.data.stays.some((stay) => stay.id === "stay_test")).toBe(true);
    expect(reloaded.metadata.revision).toBeGreaterThan(1);
  });

  it("migrates the old India under-60 starter target to a 59-day ceiling", () => {
    const data = createInitialData();
    const oldData = {
      ...data,
      rules: data.rules.map((rule) =>
        rule.id === "rule_india_nri"
          ? {
              ...rule,
              threshold: 60,
              description: "Stay under 60 days · conservative limit"
            }
          : rule
      )
    };

    const migrated = migrateAppData(oldData);

    expect(migrated.rules.find((rule) => rule.id === "rule_india_nri")?.threshold).toBe(59);
  });

  it("removes duplicate persisted targets during migration", () => {
    const data = createInitialData();
    const india = data.rules.find((rule) => rule.id === "rule_india_nri");
    if (!india) {
      throw new Error("Missing India rule");
    }

    const migrated = migrateAppData({
      ...data,
      rules: [...data.rules, { ...india, id: "rule_india_nri_duplicate", label: "Duplicate" }]
    });

    expect(migrated.rules.filter((rule) => rule.threshold === india.threshold)).toHaveLength(1);
  });

  it("restores missing starter evidence without replacing edited evidence", () => {
    const data = createInitialData();
    const editedVisa = {
      ...data.evidence.find((item) => item.id === "ev_es_visa")!,
      title: "Edited visa title"
    };

    const migrated = migrateAppData({
      ...data,
      evidence: [editedVisa]
    });

    expect(migrated.evidence.find((item) => item.id === "ev_es_visa")?.title).toBe(
      "Edited visa title"
    );
    expect(migrated.evidence.some((item) => item.id === "ev_es_ticket")).toBe(true);
  });
});
