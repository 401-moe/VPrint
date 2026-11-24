import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import { SignJWT } from "jose";
import { authorizeTestDevice, createResourceProof } from "./authorized-device";
import worker from "../../src/worker/index";

const loopbackOrigin = "http://127.0.0.1:8787";
const audience = loopbackOrigin + "/api";

function request(path: string, init: RequestInit = {}) {
  return new Request(`${loopbackOrigin}${path}`, init);
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function signUp() {
  const response = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: loopbackOrigin,
      },
      body: JSON.stringify({
        email: `grant-${crypto.randomUUID()}@vprint.example`,
        password: "correct horse battery staple",
        name: "Grant Member",
      }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  return cookies(response);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

test("an approved CLI exchanges once, uses DPoP, and logs out through the grant boundary", async () => {
  const sessionCookies = await signUp();
  const { tokens, privateKey, publicKey, thumbprint, exchangeProof, exchangeBody } = await authorizeTestDevice(sessionCookies);

  const proof = await createResourceProof(
    tokens.access_token,
    privateKey,
    publicKey,
    "GET",
    "/cli/me",
  );
  const identity = await worker.fetch(
    request("/api/cli/me", {
      headers: { authorization: `DPoP ${tokens.access_token}`, dpop: proof },
    }),
    env,
  );
  expect(identity.status, "protected identity").toBe(200);
  await expect(identity.json()).resolves.toMatchObject({
    email: expect.stringContaining("@vprint.example"),
    name: "Grant Member",
  });

  const replay = await worker.fetch(
    request("/api/cli/me", {
      headers: { authorization: `DPoP ${tokens.access_token}`, dpop: proof },
    }),
    env,
  );
  expect(replay.status).toBe(401);

  const secondExchange = await worker.fetch(
    request("/api/auth/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        dpop: exchangeProof,
      },
      body: exchangeBody,
    }),
    env,
  );
  expect(secondExchange.status).toBe(400);

  const refreshToken = async (refresh: string) => {
    const dpop = await new SignJWT({ htu: loopbackOrigin + "/api/auth/oauth2/token", htm: "POST" })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicKey })
      .setJti(crypto.randomUUID()).setIssuedAt().sign(privateKey);
    return worker.fetch(request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", dpop },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: "vprint-cli", resource: audience }),
    }), env);
  };
  const before = await env.DB.prepare("SELECT id, approvedAt, expiresAt FROM vprint_cli_grant WHERE keyThumbprint = ?").bind(thumbprint).first<{ id: string; approvedAt: number; expiresAt: number }>();
  expect(before!.expiresAt - before!.approvedAt).toBe(8 * 3600);
  const renewed = await refreshToken(tokens.refresh_token);
  expect(renewed.status, renewed.ok ? "renew the same CLI grant" : await renewed.clone().text()).toBe(200);
  const fresh = await renewed.json<typeof tokens>();
  expect(fresh.token_type).toBe("DPoP");
  const effectiveRefresh = fresh.refresh_token ?? tokens.refresh_token;
  expect(await env.DB.prepare("SELECT id, approvedAt, expiresAt FROM vprint_cli_grant WHERE keyThumbprint = ?").bind(thumbprint).first()).toEqual(before);
  const secondProof = await createResourceProof(
    fresh.access_token,
    privateKey,
    publicKey,
    "POST",
    "/cli/logout",
  );
  const logout = await worker.fetch(
    request("/api/cli/logout", {
      method: "POST",
      headers: {
        authorization: `DPoP ${fresh.access_token}`,
        dpop: secondProof,
      },
    }),
    env,
  );
  expect(logout.status).toBe(200);

  const thirdProof = await createResourceProof(
    fresh.access_token,
    privateKey,
    publicKey,
    "GET",
    "/cli/me",
  );
  const afterLogout = await worker.fetch(
    request("/api/cli/me", {
      headers: {
        authorization: `DPoP ${fresh.access_token}`,
        dpop: thirdProof,
      },
    }),
    env,
  );
  expect(afterLogout.status).toBe(401);
  expect((await refreshToken(effectiveRefresh)).status).toBe(400);
});
