import type { Context } from "hono";
import type { Environment } from "./index";
import { createAuth } from "./auth";

const allowedOperatingSystems = new Set(["linux", "darwin", "win32"]);

interface DeviceRequestRow {
  deviceCode: string;
  userCode: string;
  hostname: string;
  os: string;
}

interface DeviceCodeRow {
  id: string;
  deviceCode: string;
  userCode: string;
  userId: string | null;
  status: string;
  expiresAt: string;
  scope: string | null;
}

async function findDeviceCode(database: Environment["DB"], deviceCode: string) {
  return database
    .prepare(
      "select id, userCode, userId, status, expiresAt, scope, oauthClientId from deviceCode where deviceCode = ?",
    )
    .bind(deviceCode)
    .first<
      DeviceCodeRow & { oauthClientId: string | null }
    >();
}

async function findDeviceRequest(
  database: Environment["DB"],
  userCode: string,
): Promise<DeviceRequestRow | null> {
  return database.prepare(
    "SELECT deviceCode, userCode, hostname, os FROM vprint_cli_device_request WHERE userCode = ?",
  ).bind(userCode.toUpperCase()).first<DeviceRequestRow>();
}

export async function captureDeviceRequest(
  context: Context<{ Bindings: Environment }>,
) {
  if (context.req.header("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
    return context.json({ error: "invalid_request" }, 400);
  }
  const params = new URLSearchParams(new TextDecoder().decode(await context.req.raw.clone().arrayBuffer()));
  const scopes = params.get("scope")?.trim().split(/\s+/).sort().join(" ");
  if (params.get("client_id") !== "vprint-cli" || params.getAll("resource").length !== 1 ||
      params.get("resource") !== context.env.BETTER_AUTH_URL + "/api") return context.json({ error: "invalid_request" }, 400);
  if (scopes !== "offline_access vprint:print vprint:teams:read") return context.json({ error: "invalid_scope" }, 400);
  const hostname = decodeHeaderValue(
    context.req.header("x-vprint-hostname") ?? "未知主机",
  );
  const operatingSystem = context.req.header("x-vprint-os") ?? "linux";
  if (!allowedOperatingSystems.has(operatingSystem) || hostname.length > 255) {
    return context.json({ error: "invalid_request" }, 400);
  }

  const response = await createAuth(context.env, true).handler(context.req.raw);
  if (!response.ok) return response;

  const body = await response.clone().json<{ device_code?: string; user_code?: string }>();
  if (!body.device_code || !body.user_code) return response;

  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(
    `insert into vprint_cli_device_request (deviceCode, userCode, hostname, os, createdAt)
     values (?, ?, ?, ?, ?)`,
  )
    .bind(body.device_code, body.user_code, hostname, operatingSystem, now)
    .run();
  return response;
}

function decodeHeaderValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function requireSession(context: Context<{ Bindings: Environment }>) {
  const auth = createAuth(context.env);
  return auth.api.getSession({ headers: context.req.raw.headers });
}

export async function getDeviceRequest(context: Context<{ Bindings: Environment }>) {
  const session = await requireSession(context);
  if (!session) return context.json({ error: "authentication required" }, 401);

  const userCode = (context.req.query("userCode") ?? "").trim();
  if (!userCode) return context.json({ error: "user code required" }, 400);

  const deviceRequest = await findDeviceRequest(context.env.DB, userCode);
  if (!deviceRequest) return context.json({ error: "user code not found" }, 404);

  const deviceCode = await findDeviceCode(context.env.DB, deviceRequest.deviceCode);
  if (!deviceCode) return context.json({ error: "user code not found" }, 404);
  if (new Date(deviceCode.expiresAt).getTime() <= Date.now() || deviceCode.status !== "pending") {
    return context.json({ error: "user code is no longer available" }, 410);
  }

  return context.json({
    hostname: deviceRequest.hostname,
    os: deviceRequest.os,
    scope: deviceCode.scope ?? "",
    userCode: deviceCode.userCode,
  });
}

export async function decideDeviceRequest(context: Context<{ Bindings: Environment }>) {
  if (context.req.header("x-vprint-device-decision") !== "1") {
    return context.json({ error: "missing CSRF token" }, 403);
  }
  const requestOrigin = context.req.header("origin");
  if (requestOrigin && requestOrigin !== new URL(context.req.url).origin) {
    return context.json({ error: "invalid origin" }, 403);
  }

  const session = await requireSession(context);
  if (!session) return context.json({ error: "authentication required" }, 401);

  const decision = await context.req.json<{
    userCode?: unknown;
    approve?: unknown;
    keepSignedIn?: unknown;
  }>();
  if (
    typeof decision.userCode !== "string" ||
    typeof decision.approve !== "boolean" ||
    typeof decision.keepSignedIn !== "boolean"
  ) {
    return context.json({ error: "invalid decision" }, 400);
  }

  const deviceRequest = await findDeviceRequest(context.env.DB, decision.userCode.trim());
  if (!deviceRequest) return context.json({ error: "user code not found" }, 404);
  const deviceCode = await findDeviceCode(context.env.DB, deviceRequest.deviceCode);
  if (!deviceCode) return context.json({ error: "user code not found" }, 404);
  if (new Date(deviceCode.expiresAt).getTime() <= Date.now()) {
    return context.json({ error: "user code expired" }, 410);
  }

  const nowIso = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt =
    now + (decision.keepSignedIn ? 30 * 24 * 60 * 60 : 8 * 60 * 60);
  const approval = context.env.DB.prepare(
    `update deviceCode
     set status = ?, userId = ?
     where deviceCode = ? and status = 'pending' and userId is null
       and oauthClientId = 'vprint-cli' and expiresAt > ?`,
  )
    .bind(
      decision.approve ? "approved" : "denied",
      session.user.id,
      deviceRequest.deviceCode,
      nowIso,
    );

  if (decision.approve) {
    const grant = context.env.DB.prepare(
      `insert into vprint_cli_grant (
         id, deviceCodeId, userId, clientId, keyThumbprint, hostname, os, scope,
         approvedAt, expiresAt, revokedAt, refreshTokenHash, createdAt, updatedAt
       ) SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?
         FROM deviceCode WHERE deviceCode = ? AND status = 'pending' AND userId IS NULL
           AND oauthClientId = 'vprint-cli' AND expiresAt > ?`,
    ).bind(
      crypto.randomUUID(),
      deviceRequest.deviceCode,
      session.user.id,
      "vprint-cli",
      deviceRequest.hostname,
      deviceRequest.os,
      deviceCode.scope ?? "",
      now,
      expiresAt,
      now,
      now,
      deviceRequest.deviceCode,
      nowIso,
    );
    const results = await context.env.DB.batch([grant, approval]);
    if (!results[0]?.meta.changes) {
      return context.json({ error: "user code is no longer available" }, 410);
    }
  } else {
    const result = await approval.run();
    if (!result.meta.changes) {
      return context.json({ error: "user code is no longer available" }, 410);
    }
  }
  return context.json({ success: true });
}
