import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.CHROMIUM_PATH } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath: process.env.CHROMIUM_PATH } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npx next start -p 3100", port: 3100, reuseExistingServer: true, timeout: 60_000 },
});
