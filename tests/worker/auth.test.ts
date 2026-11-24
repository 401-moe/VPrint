import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
    }
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    d1Migrations: { name: string; queries: string[] }[];
  }
}

const loopbackOrigin = "http://127.0.0.1:8787";
const member = {
  email: "member@vprint.example",
  password: "correct horse battery staple",
  name: "VPrint Member",
};

function request(path: string, init: RequestInit = {}) {
  return new Request(`${loopbackOrigin}${path}`, init);
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

test("a member can sign up, leave, sign in again, and keep the same account", async () => {
  const anonymous = await worker.fetch(request("/api/me"), env);
  expect(anonymous.status).toBe(401);

  const signUp = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify(member),
    }),
    env,
  );
  expect(signUp.status).toBe(200);
  const created = await json(signUp);
  const createdUser = created.user as { id: string; email: string } | undefined;
  expect(createdUser?.email).toBe(member.email);

  const sessionCookies = cookies(signUp);
  const authenticated = await worker.fetch(
    request("/api/me", { headers: { cookie: sessionCookies } }),
    env,
  );
  expect(authenticated.status).toBe(200);
  const authenticatedUser = await json(authenticated);
  expect(authenticatedUser.id).toBe(createdUser?.id);

  const signOut = await worker.fetch(
    request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookies,
        origin: loopbackOrigin,
      },
      body: "{}",
    }),
    env,
  );
  expect(signOut.status).toBe(200);
  const signedOutCookies = cookies(signOut);

  const protectedAfterSignOut = await worker.fetch(
    request("/api/me", { headers: { cookie: signedOutCookies } }),
    env,
  );
  expect(protectedAfterSignOut.status).toBe(401);

  const wrongPassword = await worker.fetch(
    request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email: member.email, password: "not the password" }),
    }),
    env,
  );
  expect(wrongPassword.status).toBe(401);
  expect(cookies(wrongPassword)).toBe("");

  const signIn = await worker.fetch(
    request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email: member.email, password: member.password }),
    }),
    env,
  );
  expect(signIn.status).toBe(200);
  const restored = await json(signIn);
  const restoredUser = restored.user as { id: string } | undefined;
  expect(restoredUser?.id).toBe(createdUser?.id);
});
