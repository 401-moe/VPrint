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

test("email registration requires a nonblank name and preserves internal spaces", async () => {
  const register = (name: string) => worker.fetch(request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: loopbackOrigin },
    body: JSON.stringify({ ...member, email: "name-check@vprint.example", name }),
  }), env);
  expect((await register("　 ")).status).toBe(400);
  const created = await register("　王 小明 ");
  expect(created.status).toBe(200);
  expect(await json(created)).toMatchObject({ user: { name: "王 小明" } });
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
  expect(sentEmails.at(-1)?.from).toBe("noreply@vprint.ac");
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

  const passwordStatus = await worker.fetch(
    request("/api/account/password", { headers: { cookie: cookies(signIn) } }),
    emailBinding,
  );
  expect(passwordStatus.status).toBe(200);
  expect(await passwordStatus.json()).toEqual({ hasPassword: false });
});

test("a member can change a password and revoke other web sessions", async () => {
  const email = crypto.randomUUID() + "@vprint.example";
  const password = "correct horse battery staple";
  const post = (path: string, data: object, cookie = "") => worker.fetch(request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: loopbackOrigin, cookie },
    body: JSON.stringify(data),
  }), env);

  const first = await post("/api/auth/sign-up/email", { email, password, name: "密码队员" });
  expect(first.ok).toBe(true);
  const firstCookie = cookies(first);
  const second = await post("/api/auth/sign-in/email", { email, password });
  expect(second.ok).toBe(true);
  const secondCookie = cookies(second);

  const before = await worker.fetch(request("/api/account/password", { headers: { cookie: secondCookie } }), env);
  expect(await before.json()).toEqual({ hasPassword: true });
  const wrong = await post("/api/auth/change-password", {
    currentPassword: "not the password",
    newPassword: "updated horse battery staple",
    revokeOtherSessions: true,
  }, secondCookie);
  expect(wrong.status).toBe(400);

  const changed = await post("/api/auth/change-password", {
    currentPassword: password,
    newPassword: "updated horse battery staple",
    revokeOtherSessions: true,
  }, secondCookie);
  expect(changed.ok).toBe(true);
  expect(await (await worker.fetch(request("/api/me", { headers: { cookie: firstCookie } }), env)).status).toBe(401);
  expect(await (await worker.fetch(request("/api/me", { headers: { cookie: cookies(changed) || secondCookie } }), env)).status).toBe(200);
  await expect(post("/api/auth/sign-in/email", { email, password: "updated horse battery staple" })).resolves.toMatchObject({ ok: true });
});

test("an email OTP can reset a password or set the first password without creating users", async () => {
  const messages: EmailMessage[] = [];
  const emailBinding = { ...env, EMAIL: { send: async (message: EmailMessage) => messages.push(message) } };
  const email = crypto.randomUUID() + "@vprint.example";
  const post = (path: string, data: object) => worker.fetch(request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: loopbackOrigin },
    body: JSON.stringify(data),
  }), emailBinding);
  const lastOtp = () => messages.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  const unknown = crypto.randomUUID() + "@vprint.example";

  const unknownRequest = await post("/api/auth/email-otp/request-password-reset", { email: unknown });
  expect(unknownRequest.ok).toBe(true);
  expect(messages).toHaveLength(0);
  const unknownReset = await post("/api/auth/email-otp/reset-password", { email: unknown, otp: "000000", password: "recovered horse battery staple" });
  expect(unknownReset.ok).toBe(false);
  expect(await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(unknown).first()).toBeNull();

  const registered = await post("/api/auth/sign-up/email", {
    email,
    password: "correct horse battery staple",
    name: "重置密码队员",
  });
  expect(registered.ok).toBe(true);
  expect((await post("/api/auth/email-otp/request-password-reset", { email })).ok).toBe(true);
  expect(messages.at(-1)?.subject).toBe("VPrint 重置密码验证码");
  expect((await post("/api/auth/email-otp/reset-password", {
    email,
    otp: lastOtp() === "000000" ? "000001" : "000000",
    password: "recovered horse battery staple",
  })).status).toBe(400);
  expect((await post("/api/auth/email-otp/reset-password", {
    email,
    otp: lastOtp(),
    password: "recovered horse battery staple",
  })).ok).toBe(true);
  const previousSession = await worker.fetch(request("/api/me", { headers: { cookie: cookies(registered) } }), emailBinding);
  expect(previousSession.status).toBe(401);
  await expect(post("/api/auth/sign-in/email", { email, password: "recovered horse battery staple" })).resolves.toMatchObject({ ok: true });

  const otpOnly = crypto.randomUUID() + "@vprint.example";
  await post("/api/auth/email-otp/send-verification-otp", { email: otpOnly, type: "sign-in" });
  const otpOnlySignIn = await post("/api/auth/sign-in/email-otp", { email: otpOnly, otp: lastOtp(), name: "验证码队员" });
  expect(otpOnlySignIn.ok).toBe(true);
  const cookie = cookies(otpOnlySignIn);
  const withoutPassword = await worker.fetch(request("/api/account/password", { headers: { cookie } }), emailBinding);
  expect(await withoutPassword.json()).toEqual({ hasPassword: false });
  expect((await post("/api/auth/email-otp/request-password-reset", { email: otpOnly })).ok).toBe(true);
  expect((await post("/api/auth/email-otp/reset-password", { email: otpOnly, otp: lastOtp(), password: "first horse battery staple" })).ok).toBe(true);
  await expect(post("/api/auth/sign-in/email", { email: otpOnly, password: "first horse battery staple" })).resolves.toMatchObject({ ok: true });
});

test("binding an existing account with an email code cannot register a new account", async () => {
  const email = "bind-choice@vprint.example";
  const messages: EmailMessage[] = [];
  const bindings = { ...env, EMAIL: { send: async (message: EmailMessage) => { messages.push(message); } } };
  const send = "/api/auth/email-otp/send-verification-otp";
  const signin = "/api/auth/sign-in/email-otp";
  const post = (path: string, data: object, existingOnly: boolean) => {
    const headers = new Headers({ origin: loopbackOrigin, "content-type": "application/json" });
    if (existingOnly) headers.set("x-vprint-existing-account", "1");
    return worker.fetch(request(path, { method: "POST", headers, body: JSON.stringify(data) }), bindings);
  };
  const requestCode = { email, type: "sign-in" };
  const lastCode = () => messages.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  expect((await post(send, requestCode, true)).ok).toBe(true);
  expect(messages).toHaveLength(0);
  expect((await post(send, requestCode, false)).ok).toBe(true);
  const valid = lastCode();
  expect(valid).toBeDefined();
  expect((await post(signin, { email, otp: valid }, true)).ok).toBe(false);
  expect(await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first()).toBeNull();
  expect((await post(send, requestCode, false)).ok).toBe(true);
  const created = await post(signin, { email, otp: lastCode() }, false);
  expect(created.ok).toBe(true);
  const original = (await created.json() as { user: { id: string } }).user;
  expect((await post(send, requestCode, true)).ok).toBe(true);
  const restored = await post(signin, { email, otp: lastCode() }, true);
  expect(restored.ok).toBe(true);
  expect((await restored.json() as { user: { id: string } }).user.id).toBe(original.id);
});
