import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { SignJWT, calculateJwkThumbprint } from "jose";
import worker from "../../src/worker/index";

const loopbackOrigin = "http://127.0.0.1:8787";
const audience = loopbackOrigin + "/api";

function request(path: string, init: RequestInit = {}) {
  return new Request(loopbackOrigin + path, init);
}

async function approveDevice(sessionCookies: string) {
  const response = await worker.fetch(
    request("/api/auth/device/code", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-vprint-hostname": encodeURIComponent("比赛主机"),
        "x-vprint-os": "linux",
      },
      body: new URLSearchParams({
        client_id: "vprint-cli",
        scope: "offline_access vprint:teams:read vprint:print",
        resource: audience,
      }).toString(),
    }),
    env,
  );
  expect(response.status).toBe(200);
  const code = (await response.json()) as {
    device_code: string;
    user_code: string;
    interval: number;
  };

  const decision = await worker.fetch(
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
  expect(decision.status).toBe(200);
  return code;
}

export async function authorizeTestDevice(sessionCookies: string) {
  const device = await approveDevice(sessionCookies);
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKey = keyPair.privateKey as CryptoKey;
  const publicKey = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey as CryptoKey,
  )) as JsonWebKey;
  const thumbprint = await calculateJwkThumbprint(publicKey, "sha256");
  expect(thumbprint).toMatch(/^[A-Za-z0-9_-]+$/);

  const exchangeBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: device.device_code,
    client_id: "vprint-cli",
    resource: audience,
  });
  const exchangeProof = await new SignJWT({
    htu: `${loopbackOrigin}/api/auth/oauth2/token`,
    htm: "POST",
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicKey })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .sign(privateKey);
  const exchange = await worker.fetch(
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
  expect(exchange.status, exchange.ok ? "token exchange" : await exchange.clone().text()).toBe(200);
  const tokens = (await exchange.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
  };
  expect(tokens.token_type).toBe("DPoP");

  async function send(req: Request) {
    const path = new URL(req.url).pathname.slice("/api".length);
    const proof = await createResourceProof(tokens.access_token, privateKey, publicKey, req.method, path);
    const headers = new Headers(req.headers);
    headers.set("authorization", "DPoP " + tokens.access_token);
    headers.set("dpop", proof);
    return worker.fetch(new Request(req, { headers }), env);
  }
  return { tokens, privateKey, publicKey, thumbprint, exchangeProof, exchangeBody, send };
}

export async function createResourceProof(
  accessToken: string,
  privateKey: CryptoKey,
  publicKey: JsonWebKey,
  method: string,
  path: string,
) {
  const accessTokenBytes = new TextEncoder().encode(accessToken);
  const accessTokenDigest = await crypto.subtle.digest("SHA-256", accessTokenBytes);
  const ath = btoa(String.fromCharCode(...new Uint8Array(accessTokenDigest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return new SignJWT({
    ath,
    htu: `${audience}${path}`,
    htm: method,
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicKey })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .sign(privateKey);
}
