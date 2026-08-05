import { defineConfig } from "@playwright/test";

const testWork = ".test-data/scenario";

/**
 * Scenario tests drive a dedicated server on :8790 with an accelerated
 * test clock. The manager plan's real numbers (24 h dormancy, 3-day
 * starvation, 30-min recap) stay contractual in DEFAULT_BALANCE — tests
 * compress real time only (technical plan, scenario-test section).
 */
const TEST_BALANCE = JSON.stringify({
  daySeconds: 6,
  dormancyHours: 1 / 120, // 30 s
  recapAwaySeconds: 15,
  snapshotIntervalSeconds: 10,
  boatSpeed: 40,
  birthChancePerDay: 1,
});

export default defineConfig({
  testDir: "scenario-tests",
  outputDir: "test-results",
  timeout: 90_000,
  workers: 1, // one shared world — scenarios join their own islands but run serially
  use: {
    baseURL: "http://localhost:8790",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command: `npm run build >/dev/null 2>&1; rm -rf ${testWork}/server-data; PORT=8790 npm run start`,
    url: "http://localhost:8790/api/world",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      CLAUDILIZATION_TEST: "1",
      // a scenario world is always a throwaway file world: an ambient
      // DATABASE_URL from the shell must never become the test's storage
      CLAUDILIZATION_DB: "",
      CLAUDILIZATION_BALANCE: TEST_BALANCE,
      CLAUDILIZATION_DATA: `${testWork}/server-data`,
    },
  },
});
