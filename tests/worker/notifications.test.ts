import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";
import { publishPrint } from "../../src/worker/notifications";

const origin = "http://127.0.0.1:8787";
beforeAll(() => applyD1Migrations(env.DB, inject("d1Migrations")));
const call = (path: string, cookie = "", body?: unknown) => worker.fetch(new Request(origin + path, { method: body ? "POST" : "GET", headers: { cookie, origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);

test("a live socket receives only subscribed, authorized IDs and closes on signout", async () => {
  const registered = await call("/api/auth/sign-up/email", "", { email: crypto.randomUUID() + "@vprint.example", name: "队员", password: "vprint-test-passphrase" });
  const cookie = registered.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const team = await (await call("/api/teams", cookie, { name: "队伍" })).json() as { id: string };
  const contest = await (await call(`/api/teams/${team.id}/contests`, cookie, { name: "训练" })).json() as { id: string };
  const res = await worker.fetch(new Request(origin + "/api/notifications", { headers: { cookie, origin, Upgrade: "websocket" } }), env);
  expect(res.status).toBe(101);
  const socket = res.webSocket!;
  socket.accept();
  const nextMessage = () => new Promise(resolve => socket.addEventListener("message", event => resolve(JSON.parse(event.data as string)), { once: true }));
  const confirmation = nextMessage();
  socket.send(JSON.stringify({ contests: [contest.id, crypto.randomUUID()] }));
  expect(await confirmation).toEqual({ subscribed: [contest.id] });
  const event = { contestId: contest.id, printId: crypto.randomUUID() };
  const notification = nextMessage();
  await publishPrint(env, event);
  expect(await notification).toEqual(event);
  const closed = new Promise(resolve => socket.addEventListener("close", e => resolve(e.code), { once: true }));
  await call("/api/auth/sign-out", cookie, {});
  expect(await closed).toBe(4001);
});
