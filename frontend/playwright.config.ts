import { defineConfig, devices } from "@playwright/test"

// Runs against the app started by `make start` (Docker). Override with E2E_BASE_URL.
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.FRONTEND_PORT ?? 5173}`,
    trace: "retain-on-failure",
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) }, // ms pause per action, to watch runs
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
