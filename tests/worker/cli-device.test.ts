import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";

const loopbackOrigin = "http://127.0.0.1:8787";

function request(path: string, init: RequestInit = {}) {
  return new Request(`${loopbackOrigin}${path}`, init);
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

test("a Preview issues device links on its own HTTPS host", async () => {
  const bindings = { ...env, VPRINT_PREVIEW_DOMAIN: "pr.vprint.ac" };
  const origin = "https://test-branch.pr.vprint.ac";
  const response = await worker.fetch(new Request(origin + "/api/auth/device/code", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "vprint-cli",
      scope: "offline_access vprint:teams:read vprint:print",
      resource: origin + "/api",
    }),
  }), bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ verification_uri: origin + "/device" });
  expect(bindings.BETTER_AUTH_URL).toBe(loopbackOrigin);

  const wrongHost = await worker.fetch(new Request("https://vprint.ac/api/me"), bindings);
  expect(wrongHost.status).toBe(400);
});

test("a member can inspect and approve a pending CLI device request", async () => {
  const signUp = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: loopbackOrigin,
      },
      body: JSON.stringify({
        email: "device-member@vprint.example",
        password: "correct horse battery staple",
        name: "Device Member",
      }),
    }),
    env,
  );
  expect(signUp.status).toBe(200);
  const sessionCookies = cookies(signUp);

  const codeResponse = await worker.fetch(
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
  const code = (await codeResponse.json()) as { user_code: string };

  const anonymous = await worker.fetch(request(`/api/cli/device?userCode=${code.user_code}`), env);
  expect(anonymous.status).toBe(401);

  const detailsResponse = await worker.fetch(
    request(`/api/cli/device?userCode=${code.user_code}`, {
      headers: { cookie: sessionCookies },
    }),
    env,
  );
  expect(detailsResponse.status).toBe(200);
  await expect(detailsResponse.json()).resolves.toEqual({
    hostname: "机房主机",
    os: "linux",
    scope: "offline_access vprint:teams:read vprint:print",
    userCode: code.user_code,
  });

  const missingCsrf = await worker.fetch(
    request("/api/cli/device/decision", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookies,
        origin: loopbackOrigin,
      },
      body: JSON.stringify({
        userCode: code.user_code,
        approve: true,
        keepSignedIn: false,
      }),
    }),
    env,
  );
  expect(missingCsrf.status).toBe(403);

  const decisionResponse = await worker.fetch(
    request("/api/cli/device/decision", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookies,
        origin: loopbackOrigin,
        "x-vprint-device-decision": "1",
      },
      body: JSON.stringify({
        userCode: code.user_code,
        approve: true,
        keepSignedIn: false,
      }),
    }),
    env,
  );
  expect(decisionResponse.status).toBe(200);

  const afterDecision = await worker.fetch(
    request(`/api/cli/device?userCode=${code.user_code}`, {
      headers: { cookie: sessionCookies },
    }),
    env,
  );
  expect(afterDecision.status).toBe(410);
});
