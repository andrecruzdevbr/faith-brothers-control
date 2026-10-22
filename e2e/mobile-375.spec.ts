import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

async function horizontalOverflow(page: { evaluate: (fn: () => number) => Promise<number> }) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("login remains usable at 375px without horizontal overflow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Acesse sua conta/i })).toBeVisible();
  await expect(page.getByLabel(/WhatsApp/i)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("public cadastro remains usable at 375px", async ({ page }) => {
  await page.goto("/cadastro");
  await expect(page.locator("body")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
