import { expect, test } from "@playwright/test";

test("loads the timeline app and adds stay evidence", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Sojourn")).toBeVisible();
  await expect(page.getByRole("heading", { name: "UAE tax residency" })).toBeVisible();
  await expect(page.getByLabel("Stay timeline")).toBeVisible();

  await expect(page.getByText("Schengen visa")).toBeVisible();

  await page.getByRole("button", { name: /Add evidence/ }).first().click();
  await page.getByLabel("Title").fill("Exit boarding pass");
  await page.getByLabel("Date").fill("2026-06-03");
  await page.getByRole("button", { name: /Save proof/ }).click();

  await expect(page.getByText("Evidence added.")).toBeVisible();
  await expect(page.getByText("Exit boarding pass")).toBeVisible();
});
