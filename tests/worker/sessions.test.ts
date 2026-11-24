import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";
import { authorizeTestDevice } from "./authorized-device";

const origin = "http://127.0.0.1:8787";
const call = (path: string, cookie = "", method = "GET") => worker.fetch(new Request(origin + path, { method, headers: { cookie, origin } }), env);
async function register() {
  const result = await worker.fetch(new Request(origin + "/api/auth/sign-up/email", { method: "POST",
    headers: { "content-type": "application/json", origin, "user-agent": "Browser fixture" },
    body: JSON.stringify({ email: crypto.randomUUID() + "@vprint.example", name: "队员", password: "vprint-test-passphrase" }),
  }), env);
  return result.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
beforeAll(() => applyD1Migrations(env.DB, inject("d1Migrations")));

test("two CLI hosts and one Web session are independently visible and revocable", async () => {
  const owner = await register(), outsider = await register();
  const first = await authorizeTestDevice(owner), second = await authorizeTestDevice(owner);
  const path = "/api/account/sessions";
  const entries = async (cookie: string) => (await (await call(path, cookie)).json() as { sessions: { id: string; type: string; current: boolean; device: string }[] }).sessions;
  const sessions = await entries(owner);
  expect(sessions).toHaveLength(3);
  expect(sessions[0]).toMatchObject({ type: "web", current: true, device: "Browser fixture" });
  const firstId = await env.DB.prepare("SELECT id FROM vprint_cli_grant WHERE keyThumbprint = ?").bind(first.thumbprint).first<string>("id");
  const endpoint = path + "/cli/" + firstId;
  expect((await call(endpoint, outsider, "DELETE")).status).toBe(404);
  expect(await entries(outsider)).toHaveLength(1);
  expect((await call(endpoint, owner, "DELETE")).ok).toBe(true);
  expect((await first.send(new Request(origin + "/api/cli/me"))).status).toBe(401);
  expect((await second.send(new Request(origin + "/api/cli/me"))).status).toBe(200);
  expect(await entries(owner)).toHaveLength(2);
  expect((await call(path + "/web/" + sessions[0].id, owner, "DELETE")).ok).toBe(true);
  expect((await call("/api/me", owner)).status).toBe(401);
  expect((await second.send(new Request(origin + "/api/cli/me"))).status).toBe(200);
});
