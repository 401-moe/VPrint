import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, expect, inject, test, vi } from "vitest";
import worker from "../../src/worker/index";

const origin = "http://127.0.0.1:8787";
const bindings = { ...env, GITHUB_CLIENT_ID: "local-fixture", GITHUB_CLIENT_SECRET: "local-fixture-only" };
const cookies = (r: Response) => r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const call = (path: string, cookie = "", body?: unknown) => worker.fetch(new Request(origin + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { origin, cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
}), bindings);

beforeAll(() => applyD1Migrations(env.DB, inject("d1Migrations")));
afterEach(() => vi.unstubAllGlobals());

function providerFixture(id: number, email: string, verified: boolean) {
  vi.stubGlobal("fetch", async (input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "fixture-access", token_type: "bearer", scope: "user:email" });
    if (url.href === "https://api.github.com/user") return Response.json({ id, login: "fixture-member", name: "Member", email: null });
    if (url.href === "https://api.github.com/user/emails") return Response.json([{ email, primary: true, verified }]);
    throw new Error("Unexpected fixture request " + url.origin);
  });
}

async function authorize() {
  const start = await call("/api/auth/github/start", "", { callbackURL: "/device" });
  expect(start.status).toBe(200);
  const { url } = await start.json() as { url: string };
  const auth = new URL(url);
  expect(auth.searchParams.get("redirect_uri")).toBe(origin + "/api/auth/callback/github");
  const state = auth.searchParams.get("state");
  return call("/api/auth/callback/github?code=fixture&state=" + encodeURIComponent(state!), cookies(start));
}

test("first GitHub authorization requires an explicit choice; repeated login finds that numeric identity", async () => {
  const email = "private-first@vprint.example";
  providerFixture(4150, email, true);
  const first = await authorize();
  expect(first.headers.get("location")).toBe(origin + "/github/choice");
  const cookie = cookies(first);
  const choice = await call("/api/auth/github/choice", cookie);
  expect(await choice.json()).toMatchObject({ email, login: "fixture-member", canCreate: true });
  expect(await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first()).toBeNull();
  await call("/api/auth/github/decision", cookie, { action: "cancel" });
  expect(await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first()).toBeNull();
  const confirmation = cookies(await authorize());
  const decisions = await Promise.all([1, 2].map(() => call("/api/auth/github/decision", confirmation, { action: "create" })));
  const success = decisions.find(response => response.ok);
  expect(success).toBeDefined();
  expect(await (await call("/api/me", cookies(success!))).json()).toMatchObject({ email });
  expect(await env.DB.prepare("SELECT COUNT(*) FROM account WHERE providerId = 'github' AND accountId = '4150'").first("COUNT(*)")).toBe(1);
  const second = await authorize();
  expect(second.headers.get("location")).toBe(origin + "/device");
  expect(await (await call("/api/me", cookies(second))).json()).toMatchObject({ email });
});

test("an unverified GitHub address cannot create or link; different verified addresses preserve the chosen VPrint account", async () => {
  const gh = "private-bind@vprint.example";
  providerFixture(4151, gh, false);
  const unverified = cookies(await authorize());
  expect(await (await call("/api/auth/github/choice", unverified)).json()).toMatchObject({ email: null, canCreate: false });
  expect((await call("/api/auth/github/decision", unverified, { action: "create" })).ok).toBe(false);
  providerFixture(4151, gh, true);
  const choice = cookies(await authorize());
  expect((await call("/api/auth/github/decision", choice, { action: "bind" })).status).toBe(401);
  const school = "bind-school@vprint.example";
  const registration = await call("/api/auth/sign-up/email", "", { email: school, password: "vprint-test-passphrase", name: "队长" });
  expect(registration.ok).toBe(true);
  expect((await call("/api/auth/github/decision", choice + "; " + cookies(registration), { action: "bind" })).ok).toBe(true);
  const again = await authorize();
  expect(await (await call("/api/me", cookies(again))).json()).toMatchObject({ email: school });
  providerFixture(4152, school, true);
  const sameEmail = cookies(await authorize());
  expect(await (await call("/api/auth/github/choice", sameEmail)).json()).toMatchObject({ email: school, canCreate: false });
  expect((await call("/api/auth/github/decision", sameEmail, { action: "create" })).status).toBe(409);
});
