import { betterAuth } from "better-auth";
import type { D1Database } from "@cloudflare/workers-types";
import { createEmailOtpPlugin } from "./email-otp";

export interface AuthEnvironment {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  EMAIL: SendEmail;
}

interface SendEmail {
  send: (message: {
    to: string;
    from: string;
    subject: string;
    text: string;
  }) => Promise<void>;
}

export function createAuth(env: AuthEnvironment) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
    },
    plugins: [createEmailOtpPlugin(env)],
  });
}
