import { betterAuth } from "better-auth";
import type { D1Database } from "@cloudflare/workers-types";

export function createAuth(database: D1Database, secret: string, fallbackOrigin: string) {
  return betterAuth({
    database,
    secret,
    baseURL: {
      allowedHosts: [new URL(fallbackOrigin).host],
      protocol: "auto",
      fallback: fallbackOrigin,
    },
    emailAndPassword: {
      enabled: true,
    },
  });
}
