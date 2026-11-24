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

export interface AuthUser {
  id: string;
  email: string;
  name: string;
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

export async function getCurrentUser(env: AuthEnvironment, headers: Headers) {
  const session = await createAuth(env).api.getSession({ headers });
  if (!session) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  } satisfies AuthUser;
}
