import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";
import { createContest, createTeam, join, memberCookie, request, workspace } from "./team-fixtures";

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

test("workspace restores the last accessible team and contest links take priority", async () => {
  const cookie = await memberCookie("多队队员");
  const firstTeam = await createTeam(cookie, "第一队");
  const secondTeam = await createTeam(cookie, "第二队");
  const createdContest = await createContest(cookie, firstTeam.id, "旧队训练");

  const initial = await workspace(cookie);
  expect(await initial.json()).toMatchObject({ selectedTeamId: null });

  const switched = await worker.fetch(
    request(`/api/teams/${secondTeam.id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    }),
    env,
  );
  expect(switched.status).toBe(200);
  const restored = await workspace(cookie);
  expect(((await restored.json()) as { selectedTeamId: string }).selectedTeamId).toBe(
    secondTeam.id,
  );

  const deepLinked = await workspace(cookie, { teamId: firstTeam.id, contestId: createdContest.id });
  expect(await deepLinked.json()).toEqual({
    scope: "contest",
    team: { id: firstTeam.id, name: "第一队", role: "owner" },
    contest: createdContest,
  });
  const mismatched = await workspace(cookie, { teamId: secondTeam.id, contestId: createdContest.id });
  expect(mismatched.status).toBe(403);

  await env.DB.prepare("DELETE FROM team_member WHERE teamId = ? AND userId = ?").bind(
    secondTeam.id,
    (
      (await (
        await worker.fetch(request("/api/me", { headers: { cookie } }), env)
      ).json()) as { id: string }
    ).id,
  ).run();
  const afterLoss = await workspace(cookie);
  expect(await afterLoss.json()).toMatchObject({ selectedTeamId: null });
});

test("workspace scopes contest counts and membership to the requested team", async () => {
  const [owner, member] = await Promise.all([memberCookie("队长"), memberCookie("队员")]);
  const first = await createTeam(owner, "一队");
  const second = await createTeam(owner, "二队");
  expect((await join(member, first.invitationToken)).ok).toBe(true);
  const contest = await createContest(owner, first.id, "周六训练");

  const scoped = await workspace(owner, { teamId: first.id });
  expect(scoped.status).toBe(200);
  expect(await scoped.json()).toEqual({
    scope: "team", team: { id: first.id, name: "一队", role: "owner" },
    contests: [{ ...contest, printCount: 0 }],
  });
  expect(await (await workspace(owner)).json()).toEqual({
    scope: "user", selectedTeamId: null,
    teams: expect.arrayContaining([{ id: first.id, name: "一队", role: "owner", memberCount: 2, contestCount: 1 }]),
  });
  expect((await workspace(member, { teamId: second.id })).status).toBe(403);
});
