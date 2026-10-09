/* ============================================================
   Playwright config - the phone + desktop test runs

   Two "projects", so every page is tested twice:
     phone    390 x 844, touch, isMobile (an iPhone-ish screen)
     desktop  1280 x 800, mouse and keyboard

   Browsers: cloud sessions have Chromium preinstalled at
   /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH points there).
   Never run `playwright install` in a session. CI installs
   its own copy in .github/workflows/test.yml.
   ============================================================ */

import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  globalSetup: "./tests/e2e/global-setup.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 30_000,

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },

  projects: [
    {
      name: "phone",
      testIgnore: /privacy\.spec\.js/,     // browser-level checks: desktop run is enough
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      }
    },
    {
      name: "desktop",
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false
      }
    }
  ],

  webServer: {
    command: "node tests/server.js",
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    stdout: "ignore"
  }
});
