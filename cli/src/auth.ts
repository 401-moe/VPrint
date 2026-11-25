import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { Key } from "node:readline";
import { spinner } from "@clack/prompts";
import { interactive, report } from "./terminal.ts";
import * as oauth from "oauth4webapi";
import { clearCredentials, readCredentials, readCredentialsIfPresent, withCredentialLock, writeCredentials, type Credentials } from "./state.ts";

const base = new URL(process.env.VPRINT_URL || "https://vprint.ac");
if (base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("VPRINT_URL 应为 VPrint 服务的源地址。");
const local = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
if (base.protocol !== "https:" && !local) throw new Error("VPrint 需要 HTTPS。");
const origin = base.origin;
const as: oauth.AuthorizationServer = {
  issuer: origin + "/api/auth",
  device_authorization_endpoint: origin + "/api/auth/device/code",
  token_endpoint: origin + "/api/auth/oauth2/token",
};
const client: oauth.Client = { client_id: "vprint-cli" };
const clientAuth = oauth.None();
const transport = { [oauth.allowInsecureRequests]: local, signal: () => AbortSignal.timeout(15000) };
const resource = origin + "/api";

async function retryNonce<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); } catch (error) {
    if (oauth.isDPoPNonceError(error)) return request();
    throw error;
  }
}

function tokenFields(tokens: oauth.TokenEndpointResponse, previous?: string) {
  const refreshToken = tokens.refresh_token || previous;
  if (tokens.token_type !== "dpop" || !refreshToken || !tokens.expires_in) throw new Error("服务端未返回完整的持钥登录凭证。");
  return { accessToken: tokens.access_token, refreshToken, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

async function handle(session: Credentials) {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const privateKey = await crypto.subtle.importKey("jwk", session.privateKey, algorithm, false, ["sign"]);
  const publicKey = await crypto.subtle.importKey("jwk", session.publicKey, algorithm, true, ["verify"]);
  return oauth.DPoP(client, { privateKey, publicKey });
}

function resourceRequest(key: oauth.DPoPHandle, token: string, path: string, method: string, headers?: Headers, body?: oauth.ProtectedResourceRequestBody) {
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/cli/")) throw new Error("CLI API 地址无效。");
  return retryNonce(() => oauth.protectedResourceRequest(token, method, url, headers, body, { ...transport, DPoP: key }));
}

async function refreshUnderLock(session: Credentials) {
  if (session.expiresAt > Date.now() + 15000) return session;
  const key = await handle(session);
  const tokens = await retryNonce(async () => oauth.processRefreshTokenResponse(as, client,
    await oauth.refreshTokenGrantRequest(as, client, clientAuth, session.refreshToken, {
      ...transport, DPoP: key, additionalParameters: { resource },
    })));
  Object.assign(session, tokenFields(tokens, session.refreshToken));
  await writeCredentials(session);
  return session;
}

async function currentSession() {
  const session = await readCredentials(origin);
  if (session.expiresAt > Date.now() + 15000) return session;
  return withCredentialLock(async () => refreshUnderLock(await readCredentials(origin)));
}

export async function apiRequest(path: string, method = "GET", headers?: Headers, body?: oauth.ProtectedResourceRequestBody) {
  try {
    const session = await currentSession();
    const response = await resourceRequest(await handle(session), session.accessToken, path, method, headers, body);
    if (response.status !== 401) return response;
  } catch (error) {
    const expired = error instanceof oauth.ResponseBodyError && error.error === "invalid_grant";
    const unauthorized = error instanceof oauth.WWWAuthenticateChallengeError && error.response.status === 401;
    if (!expired && !unauthorized) throw error;
  }
  throw new Error("本机登录已失效，请重新运行 vprint login。");
}

export async function login() {
  const keyPair = await oauth.generateKeyPair("ES256", { extractable: true });
  const key = oauth.DPoP(client, keyPair);
  const device = await oauth.processDeviceAuthorizationResponse(as, client,
    await oauth.deviceAuthorizationRequest(as, client, clientAuth, { scope: "offline_access vprint:teams:read vprint:print", resource }, {
      ...transport, headers: { "X-VPrint-Hostname": encodeURIComponent(hostname()), "X-VPrint-OS": process.platform },
    }));
  const verification = new URL(device.verification_uri);
  if (verification.origin !== origin) throw new Error("设备授权网址与当前 VPrint 服务不一致。");
  report("info", `请在浏览器打开 ${verification.href}\n输入终端短码 ${device.user_code}`);
  const waiting = "等待浏览器授权";
  const cancelled = "已取消登录。";
  const progress = interactive ? spinner({
    withGuide: false, cancelMessage: cancelled, onCancel: () => process.exit(130),
  }) : undefined;
  // Clack's raw-mode blocker otherwise exits successfully on a cancel key.
  const cancelKey = (_text: string, key: Key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape") {
      progress?.cancel(cancelled);
      process.exit(130);
    }
  };
  let tokens: oauth.TokenEndpointResponse;
  try {
    report("info", progress ? waiting + "（Ctrl+C 取消）" : waiting + "…");
    if (progress) {
      // Keep the instructions above the row Clack clears on every frame.
      progress.start();
      process.stdin.prependListener("keypress", cancelKey);
    }
    tokens = await pollForApproval(device, key);
  } finally {
    process.stdin.off("keypress", cancelKey);
    progress?.clear();
  }
  const fields = tokenFields(tokens);
  const response = await resourceRequest(key, fields.accessToken, "/api/cli/me", "GET");
  if (!response.ok) throw new Error("未能确认已登录账号。");
  const user = await response.json() as { email: string };
  if (!user.email) throw new Error("服务端未返回账号邮箱。");
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  await withCredentialLock(() => writeCredentials({ version: 1, origin, privateKey, publicKey, ...fields }));
  report("success", "已登录 " + user.email);
}

async function pollForApproval(device: oauth.DeviceAuthorizationResponse, key: oauth.DPoPHandle) {
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(1, device.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await delay(Math.min(interval, deadline - Date.now()));
    if (Date.now() >= deadline) break;
    try {
      return await retryNonce(async () => oauth.processDeviceCodeResponse(as, client,
        await oauth.deviceCodeGrantRequest(as, client, clientAuth, device.device_code, {
          ...transport, DPoP: key, additionalParameters: { resource },
        })));
    } catch (error) {
      if (!(error instanceof oauth.ResponseBodyError)) throw error;
      if (error.error === "authorization_pending") continue;
      if (error.error === "slow_down") { interval += 5000; continue; }
      if (error.error === "access_denied") throw new Error("设备授权已被拒绝。");
      if (error.error === "expired_token") break;
      throw error;
    }
  }
  throw new Error("设备短码已过期，请重新运行 vprint login。");
}

export async function logout() {
  const loggedOut = await withCredentialLock(async () => {
    const stored = await readCredentialsIfPresent(origin);
    if (!stored) return false;
    try {
      const session = await refreshUnderLock(stored);
      const response = await resourceRequest(await handle(session), session.accessToken, "/api/cli/logout", "POST");
      if (!response.ok && response.status !== 401) throw new Error("退出失败，请重试。");
    } catch (error) {
      const expired = error instanceof oauth.ResponseBodyError && error.error === "invalid_grant";
      const revoked = error instanceof oauth.WWWAuthenticateChallengeError && error.response.status === 401;
      if (!expired && !revoked) throw error;
    }
    await clearCredentials();
    return true;
  });
  report(loggedOut ? "success" : "info", loggedOut ? "已退出本机登录。" : "本机当前未登录。");
}
