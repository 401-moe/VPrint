import { defineConfig } from "@playwright/test";

const port = Number(process.env.VPRINT_E2E_PORT ?? 8787);

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
});
