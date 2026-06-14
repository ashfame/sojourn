import { expect, test } from "@playwright/test";

test("loads the timeline app and edits stay data, evidence, and targets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Sojourn")).toBeVisible();
  await expect(page.getByRole("heading", { name: "UAE tax residency" })).toBeVisible();
  await expect(page.getByLabel("Stay timeline")).toBeVisible();

  await expect(page.getByText("Schengen visa")).toBeVisible();

  await page.getByRole("button", { name: /Edit stay/ }).first().click();
  const stayForm = page.locator("form.stay-edit-form");
  await stayForm.getByLabel("Label").fill("Tenerife audit stay");
  await stayForm.getByRole("button", { name: /Save stay/ }).click();
  await expect(page.getByText("Stay updated.")).toBeVisible();
  await expect(page.getByText(/Tenerife audit stay/)).toBeVisible();

  await page.getByRole("button", { name: /Add evidence/ }).first().click();
  await page.getByLabel("Title").fill("Exit boarding pass");
  await page.getByLabel("Date").fill("2026-06-03");
  await page.getByRole("button", { name: /Save proof/ }).click();

  await expect(page.getByText("Evidence added.")).toBeVisible();
  await expect(page.getByText("Exit boarding pass")).toBeVisible();

  await page.getByRole("button", { name: /Configure targets/ }).click();
  const indiaRule = page.locator("form.rule-form").filter({ hasText: "India NRI status" });
  await expect(indiaRule.getByLabel("Max or target days")).toHaveValue("59");
  await indiaRule.getByLabel("Max or target days").fill("58");
  await indiaRule.getByRole("button", { name: /Save target/ }).click();
  await expect(page.getByText("Target updated.")).toBeVisible();
  await expect(page.getByLabel("Residency targets").getByText("0 of 58 days used")).toBeVisible();

  await page.getByRole("button", { name: "India: under 120" }).click();
  await expect(page.getByText("Suggested target added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "India under 120" })).toBeVisible();
});
