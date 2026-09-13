import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 30000 },
  use: {
    baseURL: "http://127.0.0.1:8788",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/e2e-server.mjs",
      url: "http://127.0.0.1:8788/api/vocabulary",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command:
        "npx wrangler dev --name ch-study-auth-test --ip 127.0.0.1 --port 8789 --host 127.0.0.1:8789 --persist-to .wrangler/auth-test --var LOCAL_DEV:false",
      url: "http://127.0.0.1:8789/api/admin/session",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  reporter: "list",
});
