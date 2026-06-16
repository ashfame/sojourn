import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createInitialData, defaultRules, migrateAppData } from "../../src/domain/seed";
import { STORAGE_BACKUP_KEY, createIndexedDbStorage } from "../../src/storage/indexedDbStorage";

describe("indexedDbStorage", () => {
  it("loads empty starter data on first run", async () => {
    const storage = createIndexedDbStorage();
    const snapshot = await storage.load();

    expect(snapshot.data.stays).toHaveLength(0);
    expect(snapshot.data.evidence).toHaveLength(0);
    expect(snapshot.data.rules).toHaveLength(0);
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

  it("uses the local mirror when it is newer than the IndexedDB record", async () => {
    const storage = createIndexedDbStorage();
    const data = createInitialData();
    const mirroredData = {
      ...data,
      stays: [
        {
          id: "stay_from_mirror",
          country: "AE",
          entryDate: "2026-06-01",
          exitDate: "2026-06-02",
          label: "Mirror",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    };

    localStorage.setItem(
      STORAGE_BACKUP_KEY,
      JSON.stringify({
        key: "current",
        data: mirroredData,
        savedAt: "2999-01-01T00:00:00.000Z",
        revision: 999
      })
    );
    const reloaded = await storage.load();

    expect(reloaded.data.stays.map((stay) => stay.id)).toContain("stay_from_mirror");
    expect(reloaded.metadata.revision).toBe(999);
  });

  it("imports a JSON snapshot through the storage driver", async () => {
    const storage = createIndexedDbStorage();
    const data = {
      ...createInitialData(),
      stays: [
        {
          id: "stay_imported",
          country: "AE",
          entryDate: "2026-06-01",
          exitDate: "2026-06-05",
          label: "Imported stay",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    };

    const imported = await storage.importData({
      text: () => Promise.resolve(JSON.stringify(data))
    } as Blob);

    expect(imported.stays.map((stay) => stay.id)).toEqual(["stay_imported"]);
  });

  it("removes old starter targets during migration", () => {
    const data = createInitialData();
    const oldData = {
      ...data,
      rules: defaultRules.map((rule) => ({ ...rule, countryScope: [...rule.countryScope] }))
    };

    const migrated = migrateAppData(oldData);

    expect(migrated.rules).toHaveLength(0);
  });

  it("removes duplicate persisted targets during migration", () => {
    const data = createInitialData();
    const india = {
      ...defaultRules.find((rule) => rule.id === "rule_india_nri")!,
      id: "custom_india"
    };

    const migrated = migrateAppData({
      ...data,
      rules: [...data.rules, india, { ...india, id: "custom_india_duplicate", label: "Duplicate" }]
    });

    expect(migrated.rules.filter((rule) => rule.threshold === india.threshold)).toHaveLength(1);
  });

  it("removes old demo stays and their evidence during migration", () => {
    const data = createInitialData();

    const migrated = migrateAppData({
      ...data,
      stays: [
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
          id: "stay_real",
          country: "IN",
          entryDate: "2026-05-24",
          exitDate: "2026-06-03",
          label: "Real stay",
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      evidence: [
        {
          id: "ev_es_visa",
          stayId: "stay_spain_2026",
          type: "visa",
          title: "Schengen visa",
          createdAt: "2026-06-10T00:00:00.000Z"
        },
        {
          id: "ev_real",
          stayId: "stay_real",
          type: "visa",
          title: "Real evidence",
          createdAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    });

    expect(migrated.stays.map((stay) => stay.id)).toEqual(["stay_real"]);
    expect(migrated.evidence.map((item) => item.id)).toEqual(["ev_real"]);
  });
});
