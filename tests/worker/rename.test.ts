import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";
import { createContest, createTeam, join, loopbackOrigin, memberCookie, request } from "./team-fixtures";

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

function rename(path: string, cookie: string, name: string, origin = loopbackOrigin) {
  return worker.fetch(request(path, {
    method: "PATCH", headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify({ name }),
  }), env);
}

test("only the owner can rename a team with a valid name and origin", async () => {
  const [owner, member] = await Promise.all([memberCookie("队长"), memberCookie("队员")]);
  const team = await createTeam(owner, "一队");
  expect((await join(member, team.invitationToken)).ok).toBe(true);
  const path = `/api/teams/${team.id}`;
  expect((await rename(path, member, "新队名")).status).toBe(403);
  expect((await rename(path, owner, "   ")).status).toBe(400);
  expect((await rename(path, owner, "新队名", "https://other.example")).status).toBe(403);
  const saved = await rename(path, owner, "新队名");
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ id: team.id, name: "新队名" });
});

test("a teammate can rename a contest with a valid name and origin", async () => {
  const [owner, member, outsider] = await Promise.all([memberCookie("队长"), memberCookie("队员"), memberCookie("队外")]);
  const team = await createTeam(owner, "一队");
  expect((await join(member, team.invitationToken)).ok).toBe(true);
  const contest = await createContest(owner, team.id, "周六训练");
  const path = `/api/contests/${contest.id}`;
  expect((await rename(path, outsider, "新赛名")).status).toBe(403);
  expect((await rename(path, member, "")).status).toBe(400);
  expect((await rename(path, member, "新赛名", "https://other.example")).status).toBe(403);
  const saved = await rename(path, member, "新赛名");
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ id: contest.id, name: "新赛名", teamId: team.id });
});
