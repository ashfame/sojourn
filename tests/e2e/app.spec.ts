import { expect, test } from "@playwright/test";

test("loads the browser app and records a travel event", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Residency Days")).toBeVisible();
  await expect(page.getByText("Included days")).toBeVisible();

  await page.getByRole("button", { name: /Events/ }).click();
  await page.getByLabel("Origin country").fill("IN");
  await page.getByLabel("Destination country").fill("AE");
  await page.getByLabel("Departure", { exact: true }).fill("2026-03-31T23:30");
  await page.getByLabel("Arrival", { exact: true }).fill("2026-04-01T01:30");
  await page.getByRole("button", { name: /Save travel/ }).click();

  await expect(page.getByText("Travel event saved.")).toBeVisible();
  await page.getByRole("button", { name: /Timeline/ }).click();
  await expect(page.getByLabel("Day ledger")).toBeVisible();
});
