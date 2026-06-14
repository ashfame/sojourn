import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createInitialData } from "../../src/domain/seed";
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
});
