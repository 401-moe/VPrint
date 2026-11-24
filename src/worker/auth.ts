import { betterAuth } from "better-auth";
import type { D1Database } from "@cloudflare/workers-types";

export interface AuthEnvironment {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

export function createAuth(env: AuthEnvironment) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: {
      allowedHosts: [new URL(env.BETTER_AUTH_URL).host],
      protocol: "auto",
      fallback: env.BETTER_AUTH_URL,
    },
    emailAndPassword: {
      enabled: true,
    },
  });
}
