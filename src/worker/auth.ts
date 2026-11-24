import { betterAuth } from "better-auth";
import type { D1Database } from "@cloudflare/workers-types";

export interface AuthEnvironment {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
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
