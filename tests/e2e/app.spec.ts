import { expect, test } from "@playwright/test";

test("sets up targets, tracks stays, shows gaps, and manages data panels", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Sojourn")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up targets" })).toBeVisible();
  await expect(page.getByText("No stays entered yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export data/ })).not.toBeVisible();

  await page.getByRole("button", { name: "India: under 60" }).click();
  await expect(page.getByText("Suggested target added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "India under 60" })).toBeVisible();
  await expect(page.getByLabel("Suggested targets").getByRole("button", { name: "Added" })).toHaveCount(1);

  await page.getByRole("button", { name: /Add stay/ }).click();
  await page.locator("form.stay-form").getByLabel("Country").fill("IN");
  await page.locator("form.stay-form").getByLabel("Entry").fill("2026-04-10");
  await page.locator("form.stay-form").getByLabel("Exit").fill("2026-04-19");
  await page.locator("form.stay-form").getByLabel("Label").fill("Family visit");
  await page.locator("form.stay-form").getByRole("button", { name: /Save stay/ }).click();
  await expect(page.getByText("Stay added.")).toBeVisible();
  await expect(page.getByText("10 of 59 days used")).toBeVisible();

  await page.getByRole("button", { name: /Add stay/ }).click();
  await page.locator("form.stay-form").getByLabel("Country").fill("IN");
  await page.locator("form.stay-form").getByLabel("Entry").fill("2026-05-01");
  await page.locator("form.stay-form").getByLabel("Exit").fill("2026-05-02");
  await page.locator("form.stay-form").getByLabel("Label").fill("Follow-up");
  await page.locator("form.stay-form").getByRole("button", { name: /Save stay/ }).click();
  await expect(page.getByText("12 of 59 days used")).toBeVisible();
  await expect(page.getByText("11 days unaccounted for")).toBeVisible();

  const indiaTarget = page.locator("form.rule-form").filter({ hasText: "India under 60" });
  await indiaTarget.getByLabel("Max or target days").fill("58");
  await indiaTarget.getByRole("button", { name: /Save target/ }).click();
  await expect(page.getByText("Target updated.")).toBeVisible();
  await expect(page.getByText("12 of 58 days used")).toBeVisible();

  await page.getByRole("button", { name: "India: under 120" }).click();
  await expect(page.getByText("Suggested target added.")).toBeVisible();
  const indiaUnder120 = page.locator("form.rule-form").filter({ hasText: "India under 120" });
  await indiaUnder120.getByRole("button", { name: /Delete/ }).click();
  await expect(page.getByText("Target deleted.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "India under 120" })).not.toBeVisible();

  await page.getByRole("button", { name: /Family visit/ }).click();
  await page.getByRole("button", { name: /Add evidence/ }).click();
  await page.getByLabel("Title").fill("Entry stamp");
  await page.getByRole("button", { name: /Add proof/ }).click();
  await expect(page.getByText("Evidence added.")).toBeVisible();
  await page.getByRole("button", { name: /Edit Entry stamp/ }).click();
  await page.getByLabel("Title").fill("Updated entry stamp");
  await page.getByRole("button", { name: /Save proof/ }).click();
  await expect(page.getByText("Updated entry stamp")).toBeVisible();
  await page.getByRole("button", { name: /Delete Updated entry stamp/ }).click();
  await expect(page.getByText("Evidence deleted.")).toBeVisible();

  await page.getByRole("button", { name: /Edit stay/ }).click();
  await page.locator("form.stay-edit-form").getByLabel("Label").fill("Updated family visit");
  await page.locator("form.stay-edit-form").getByRole("button", { name: /Save stay/ }).click();
  await expect(page.getByText("Stay updated.")).toBeVisible();
  await expect(page.getByText("Updated family visit")).toBeVisible();

  const followUpRow = page.locator(".stay-row").filter({ hasText: "Follow-up" });
  await followUpRow.getByRole("button", { name: /Follow-up/ }).click();
  await followUpRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Stay deleted.")).toBeVisible();
  await expect(page.getByText(/Follow-up/)).not.toBeVisible();

  await page.getByRole("button", { name: /Data & profile/ }).click();
  await expect(page.getByRole("button", { name: /Export data/ })).toBeVisible();
});

test("imports a JSON snapshot into an empty app", async ({ page }) => {
  await page.goto("/");

  const snapshot = JSON.stringify({
    schemaVersion: 1,
    settings: {
      homeBaseCountry: "AE",
      nationality: "IN",
      legalResidence: "AE",
      countEntryExitDays: true
    },
    stays: [
      {
        id: "stay_imported_uae",
        country: "AE",
        entryDate: "2026-06-01",
        exitDate: "2026-06-05",
        label: "Dubai import",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z"
      }
    ],
    evidence: [],
    rules: [
      {
        id: "rule_imported_uae",
        label: "Imported UAE target",
        countryScope: ["AE"],
        threshold: 183,
        direction: "minimum",
        window: { type: "calendar_year" },
        counting: "presence_any_part",
        description: "Imported calendar year target"
      }
    ],
    updatedAt: "2026-06-01T00:00:00.000Z"
  });

  await page.getByRole("button", { name: /Data & profile/ }).click();
  await page.getByLabel("Import JSON").evaluate((node, content) => {
    const input = node as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([content], "sojourn-data.json", { type: "application/json" })
    );
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, snapshot);

  await expect(page.getByText("Data imported.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Imported UAE target" })).toBeVisible();
  await expect(page.getByText("Dubai import")).toBeVisible();
  await expect(page.getByText("5 of 183 days")).toBeVisible();
});
