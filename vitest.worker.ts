import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
const migrations = await readD1Migrations(`${rootDirectory}/migrations`);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
          BETTER_AUTH_URL: "http://127.0.0.1:8787",
        },
      },
    }),
  ],
  test: {
    include: ["tests/worker/**/*.test.ts"],
    provide: { d1Migrations: migrations },
  },
});
