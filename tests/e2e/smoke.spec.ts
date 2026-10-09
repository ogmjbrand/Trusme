import { expect, test } from "@playwright/test";

const PUBLIC = ["/", "/pricing", "/security", "/help", "/terms", "/privacy", "/login", "/signup", "/forgot-password"];

for (const path of PUBLIC) {
  test(`public page ${path} renders without horizontal overflow`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("security headers are set", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("app routes never render without authentication", async ({ page }) => {
  await page.goto("/app/invoices");
  // Without Supabase configured the proxy sends users to /setup; with it, to /login.
  await expect(page).toHaveURL(/\/(setup|login)/);
});

test("signup form validates required fields client-side", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test("webhooks reject unsigned requests", async ({ request }) => {
  const res = await request.post("/api/webhooks/stripe", { data: { id: "evt" } });
  expect([401, 503]).toContain(res.status());
});

test("cron endpoint requires its secret", async ({ request }) => {
  const res = await request.get("/api/cron/executions");
  expect([401, 503]).toContain(res.status());
});
