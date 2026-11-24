import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      NOTIFICATIONS: DurableObjectNamespace;
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
      EMAIL: SendEmail;
    }
  }
}

interface SendEmail {
  send: (message: EmailMessage) => Promise<void>;
}

interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
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
  const restored = await json(signIn);
  expect(signIn.ok, JSON.stringify(restored)).toBe(true);
  const restoredUser = restored.user as { id: string } | undefined;
  expect(restoredUser?.id).toBe(createdUser?.id);
});

test("the CLI can start device authorization with its host metadata", async () => {
  const response = await worker.fetch(
    request("/api/auth/device/code", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-vprint-hostname": encodeURIComponent("机房主机"),
        "x-vprint-os": "linux",
      },
      body: new URLSearchParams({
        client_id: "vprint-cli",
        scope: "offline_access vprint:teams:read vprint:print",
        resource: loopbackOrigin + "/api",
      }).toString(),
    }),
    env,
  );

  expect(response.status).toBe(200);
  const body = await json(response);
  expect(body.user_code).toMatch(/^[A-Z0-9-]+$/);
  expect(body.verification_uri).toBe(`${loopbackOrigin}/device`);
  expect(body.device_code).toEqual(expect.any(String));
});

test("a member can sign in with an email OTP and cannot reuse the OTP", async () => {
  const sentEmails: EmailMessage[] = [];
  const email = "otp-member@vprint.example";
  const signUp = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({
        email,
        password: "correct horse battery staple",
        name: "OTP Member",
      }),
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(signUp.status).toBe(200);
  const unverifiedSessionCookies = cookies(signUp);
  const created = await json(signUp);
  const createdUser = created.user as { id: string };

  const requestOtp = await worker.fetch(
    request("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(requestOtp.status).toBe(200);
  expect(sentEmails.at(-1)?.to).toBe(email);
  expect(sentEmails.at(-1)?.from).toBe("noreply@vprint.401.moe");
  const otp = sentEmails.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  expect(otp).toBeDefined();

  const wrongOtp = await worker.fetch(
    request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, otp: "000000" === otp ? "000001" : "000000" }),
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(wrongOtp.status).toBe(400);
  expect(cookies(wrongOtp)).toBe("");

  const signIn = await worker.fetch(
    request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, otp }),
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  const restored = await json(signIn);
  expect(signIn.ok, JSON.stringify(restored)).toBe(true);
  expect((restored.user as { id: string }).id).toBe(createdUser.id);
  const otpCookies = cookies(signIn);

  const replayedOtp = await worker.fetch(
    request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, otp }),
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(replayedOtp.ok).toBe(false);
  expect(cookies(replayedOtp)).toBe("");

  const authenticated = await worker.fetch(
    request("/api/me", { headers: { cookie: otpCookies } }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(authenticated.ok).toBe(true);

  const revokedBeforePromotion = await worker.fetch(
    request("/api/me", { headers: { cookie: unverifiedSessionCookies } }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(revokedBeforePromotion.status).toBe(401);

  const signOut = await worker.fetch(
    request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: otpCookies,
        origin: loopbackOrigin,
      },
      body: "{}",
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(signOut.status).toBe(200);

  const preClaimPassword = await worker.fetch(
    request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, password: "correct horse battery staple" }),
    }),
    { ...env, EMAIL: { send: async (message) => sentEmails.push(message) } },
  );
  expect(preClaimPassword.status).toBe(401);
  expect(cookies(preClaimPassword)).toBe("");
});

test("a new mailbox owner can use an email OTP as the first sign-in method", async () => {
  const sentEmails: EmailMessage[] = [];
  const email = "otp-first-member@vprint.example";
  const emailBinding = { ...env, EMAIL: { send: async (message: EmailMessage) => sentEmails.push(message) } };

  const requestOtp = await worker.fetch(
    request("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
    emailBinding,
  );
  expect(requestOtp.status).toBe(200);
  expect(sentEmails.at(-1)?.to).toBe(email);
  const otp = sentEmails.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  expect(otp).toBeDefined();

  const signIn = await worker.fetch(
    request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, otp, name: "OTP First Member" }),
    }),
    emailBinding,
  );
  const created = await json(signIn);
  expect(signIn.ok, JSON.stringify(created)).toBe(true);
  expect(created.user).toMatchObject({ email, name: "OTP First Member" });

  const authenticated = await worker.fetch(
    request("/api/me", { headers: { cookie: cookies(signIn) } }),
    emailBinding,
  );
  expect(authenticated.status).toBe(200);
  expect(await authenticated.json()).toMatchObject({ email, name: "OTP First Member" });

  const noPassword = await worker.fetch(
    request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify({ email, password: "not a registered password" }),
    }),
    emailBinding,
  );
  expect(noPassword.status).toBe(401);
  expect(cookies(noPassword)).toBe("");
});
