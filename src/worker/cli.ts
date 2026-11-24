import type { Context } from "hono";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createDpopReplayStore } from "better-auth/oauth2";
import { decodeJwt } from "jose";
import { createAuth } from "./auth";
import type { Environment } from "./index";

type CliContext = Context<{ Bindings: Environment }>;
const clientId = "vprint-cli";
const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code";
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function invalidGrant(c: CliContext) {
  return c.json({ error: "invalid_grant" }, 400);
}

export async function cliToken(c: CliContext) {
  const request = c.req.raw;
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
    return c.json({ error: "invalid_request" }, 400);
  }
  const form = new URLSearchParams(new TextDecoder().decode(await request.clone().arrayBuffer()));
  if (form.get("client_id") !== clientId || !request.headers.has("dpop")) return c.json({ error: "invalid_request" }, 400);
  const resources = form.getAll("resource");
  if (resources.length !== 1 || resources[0] !== c.env.BETTER_AUTH_URL + "/api") return c.json({ error: "invalid_target" }, 400);
  const type = form.get("grant_type");
  const exchange = type === deviceGrantType;
  if (!exchange && type !== "refresh_token") return c.json({ error: "unsupported_grant_type" }, 400);
  const credential = form.get(exchange ? "device_code" : "refresh_token");
  if (!credential) return c.json({ error: "invalid_request" }, 400);

  let oldRefreshHash: string | undefined;
  if (!exchange) {
    oldRefreshHash = await digest(credential);
    const active = await c.env.DB.prepare(
      "SELECT 1 FROM vprint_cli_grant WHERE clientId = ? AND refreshTokenHash = ? AND revokedAt IS NULL AND expiresAt > ?",
    ).bind(clientId, oldRefreshHash, nowSeconds()).first();
    if (!active) return invalidGrant(c);
  }

  const response = await createAuth(c.env, true).handler(request);
  if (!response.ok) return response;
  const tokens = await response.clone().json<{ access_token?: string; refresh_token?: string; token_type?: string }>();
  if (tokens.token_type?.toLowerCase() !== "dpop" || !tokens.access_token || !tokens.refresh_token) return invalidGrant(c);
  // This JWT comes directly from the provider above, after it validated the grant and DPoP.
  const claims = decodeJwt(tokens.access_token);
  const jkt = (claims.cnf as { jkt?: unknown } | undefined)?.jkt;
  if (typeof jkt !== "string" || typeof claims.sub !== "string") return invalidGrant(c);
  const newHash = await digest(tokens.refresh_token);
  const now = nowSeconds();
  const statement = exchange
    ? c.env.DB.prepare(
      `UPDATE OR IGNORE vprint_cli_grant SET keyThumbprint = ?, refreshTokenHash = ?, updatedAt = ?
       WHERE deviceCodeId = ? AND userId = ? AND clientId = ? AND keyThumbprint IS NULL
         AND revokedAt IS NULL AND expiresAt > ?`,
    ).bind(jkt, newHash, now, credential, claims.sub, clientId, now)
    : c.env.DB.prepare(
      `UPDATE vprint_cli_grant SET refreshTokenHash = ?, updatedAt = ?
       WHERE refreshTokenHash = ? AND userId = ? AND clientId = ? AND keyThumbprint = ?
         AND revokedAt IS NULL AND expiresAt > ?`,
    ).bind(newHash, now, oldRefreshHash, claims.sub, clientId, jkt, now);
  if ((await statement.run()).meta.changes !== 1) return invalidGrant(c);
  return response;
}

export async function requireCliIdentity(c: CliContext, requiredScopes: readonly string[]) {
  const auth = createAuth(c.env);
  const verifier = oauthProviderResourceClient(auth).getActions();
  let claims;
  try {
    claims = await verifier.verifyAccessTokenRequest(c.req.raw, {
      verifyOptions: { audience: c.env.BETTER_AUTH_URL + "/api", typ: "at+jwt" },
      requiredScopes, dpop: { replayStore: createDpopReplayStore(await auth.$context) },
    });
  } catch {
    return null;
  }
  const jkt = (claims.cnf as { jkt?: unknown } | undefined)?.jkt;
  if (typeof claims.sub !== "string" || typeof jkt !== "string" || claims.azp !== clientId) return null;
  const row = await c.env.DB.prepare(
    `SELECT g.id AS grantId, u.id, u.email, u.name
     FROM vprint_cli_grant g JOIN user u ON u.id = g.userId
     WHERE g.userId = ? AND g.clientId = ? AND g.keyThumbprint = ?
       AND g.revokedAt IS NULL AND g.expiresAt > ?`,
  ).bind(claims.sub, clientId, jkt, nowSeconds()).first<{ grantId: string; id: string; email: string; name: string }>();
  if (!row) return null;
  const { grantId, ...user } = row;
  return { grantId, payload: claims, user };
}

export async function getCliMe(c: CliContext) {
  const identity = await requireCliIdentity(c, ["vprint:teams:read"]);
  return identity ? c.json(identity.user) : c.json({ error: "authentication required" }, 401);
}

export async function logoutCli(c: CliContext) {
  const identity = await requireCliIdentity(c, ["vprint:teams:read"]);
  if (!identity) return c.json({ error: "authentication required" }, 401);
  await c.env.DB.prepare(
    "UPDATE vprint_cli_grant SET revokedAt = ?, refreshTokenHash = NULL WHERE id = ? AND userId = ? AND revokedAt IS NULL",
  ).bind(nowSeconds(), identity.grantId, identity.user.id).run();
  return c.json({ success: true });
}
