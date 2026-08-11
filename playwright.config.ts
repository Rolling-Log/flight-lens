import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3000);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4000);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
      : {}),
  },
  webServer: [
    {
      command: `node_modules/.bin/next start --hostname 127.0.0.1 --port ${webPort}`,
      cwd: "apps/web",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_WEB_PORT,
      timeout: 30_000,
    },
    {
      command: `PORT=${apiPort} node --conditions=development --import tsx tests/fixtures/ui-server.ts`,
      cwd: "apps/api",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_API_PORT,
      timeout: 10_000,
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
      },
    },
  ],
});
