import { defineConfig } from "@playwright/test";

const port = Number(process.env.VPRINT_E2E_PORT ?? 8787);
const baseURL = `http://127.0.0.1:${port}`;
const wrangler = "node_modules/.bin/wrangler";
const state = "--persist-to .wrangler/browser-test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: [
      "node_modules/.bin/vite build",
      `${wrangler} d1 migrations apply DB --local ${state}`,
      `${wrangler} dev --ip 127.0.0.1 --port ${port} --infer-origin-from-routes=false ${state}` +
        ` --var BETTER_AUTH_URL:${baseURL} --var BETTER_AUTH_SECRET:local-browser-test-only-secret-0123456789`,
    ].join(" && "),
    url: baseURL,
    reuseExistingServer: false,
  },
});
