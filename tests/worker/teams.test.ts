import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, inject, test } from "vitest";
import worker from "../../src/worker/index";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
    }
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    d1Migrations: { name: string; queries: string[] }[];
  }
}

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

async function signUp(member: { email: string; password: string; name: string }) {
  const response = await worker.fetch(
    request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: loopbackOrigin },
      body: JSON.stringify(member),
    }),
    env,
  );

  if (!response.ok) throw new Error(`sign-up failed: ${response.status}`);
  return { response, cookie: cookies(response) };
}

async function createTeam(cookie: string, name: string) {
  const response = await worker.fetch(
    request("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name }),
    }),
    env,
  );
  if (!response.ok) throw new Error(`team creation failed: ${response.status}`);
  return (await response.json()) as { id: string; invitationToken: string };
}

async function join(cookie: string, token: string) {
  return worker.fetch(request(`/api/team-invitations/${token}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  }), env);
}

async function previewInvitation(cookie: string, token: string) {
  return worker.fetch(request(`/api/team-invitations/${token}`, { headers: { cookie } }), env);
}

async function workspace(cookie: string, params: Record<string, string> = {}) {
  return worker.fetch(
    request(`/api/workspace?${new URLSearchParams(params)}`, {
      headers: { cookie },
    }),
    env,
  );
}

async function members(cookie: string, teamId: string) {
  return worker.fetch(request(`/api/teams/${teamId}/members`, { headers: { cookie } }), env);
}

async function resetInvitation(cookie: string, teamId: string) {
  return worker.fetch(request(`/api/teams/${teamId}/invitation`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: loopbackOrigin },
    body: "{}",
  }), env);
}

async function removeMember(cookie: string, teamId: string, memberUserId: string) {
  return worker.fetch(request(`/api/teams/${teamId}/members/${memberUserId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie, origin: loopbackOrigin },
  }), env);
}

async function leaveTeam(cookie: string, teamId: string) {
  return worker.fetch(request(`/api/teams/${teamId}/membership`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie, origin: loopbackOrigin },
  }), env);
}

async function userId(cookie: string) {
  return (
    (await (
      await worker.fetch(request("/api/me", { headers: { cookie } }), env)
    ).json()) as { id: string }
  ).id;
}

async function insertPrintout({
  id,
  contestId,
  userId,
  requestId,
  filename,
}: {
  id: string;
  contestId: string;
  userId: string;
  requestId: string;
  filename: string;
}) {
  const result = await env.DB.prepare(
    `
      INSERT INTO printout (id, contestId, userId, requestId, filename, content, createdAt)
      VALUES (?, ?, ?, ?, ?, 'int source', 1000)
    `,
  )
    .bind(id, contestId, userId, requestId, filename)
    .run();
  if (!result.success) throw new Error("printout fixture failed");
  return { contestId, filename };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

test("two members can reuse one invitation and keep team-specific roles", async () => {
  const anonymous = await worker.fetch(
    request("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "火苗" }),
    }),
    env,
  );
  expect(anonymous.status).toBe(401);

  const { cookie } = await signUp({
    email: `owner-${Date.now()}@vprint.example`,
    password: "correct horse battery staple",
    name: "建队队员",
  });
  const creation = await worker.fetch(
    request("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "火苗" }),
    }),
    env,
  );
  expect(creation.status).toBe(201);

  const body = (await creation.json()) as {
    id: string;
    name: string;
    role: string;
    invitationUrl: string;
    invitationToken: string;
  };
  expect(body.name).toBe("火苗");
  expect(body.role).toBe("owner");
  const token = body.invitationToken;
  expect(token).toMatch(/^[a-f0-9]{32}$/);
  expect(body.invitationUrl).toBe(`${loopbackOrigin}/invite/${token}`);

  const anonymousPreview = await worker.fetch(request(`/api/team-invitations/${token}`), env);
  expect(anonymousPreview.status).toBe(401);
  expect(await anonymousPreview.json()).toEqual({ error: "authentication required" });

  const outsider = await signUp({
    email: `preview-outsider-${Date.now()}@vprint.example`,
    password: "correct horse battery staple",
    name: "预览队友",
  });
  const outsiderPreview = await previewInvitation(outsider.cookie, token);
  expect(outsiderPreview.status).toBe(200);
  expect(((await outsiderPreview.json()) as { joined: boolean }).joined).toBe(false);

  const anonymousJoin = await join("", token);
  expect(anonymousJoin.status).toBe(401);

  const invitations = ["第一队友", "第二队友"].map((name, index) =>
    signUp({
      email: `member-${Date.now()}-${index}@vprint.example`,
      password: "correct horse battery staple",
      name,
    }),
  );
  const [{ cookie: firstCookie }, { cookie: secondCookie }] = await Promise.all(invitations);
  for (const cookie of [firstCookie, secondCookie]) {
    const joined = await join(cookie, token);
    expect(joined.status).toBe(200);
  }

  const duplicateJoin = await join(firstCookie, token);
  expect(duplicateJoin.status).toBe(200);

  const memberPreview = await previewInvitation(firstCookie, token);
  expect(memberPreview.status).toBe(200);
  expect(await memberPreview.json()).toEqual({
    teamId: body.id,
    teamName: "火苗",
    ownerName: "建队队员",
    memberCount: 3,
    contestCount: 0,
    printoutCount: 0,
    joined: true,
  });

  const missingJoin = await join(
    firstCookie,
    "00000000000000000000000000000000",
  );
  expect(missingJoin.status).toBe(404);

  const ownerWorkspace = await workspace(cookie);
  const ownerBody = (await ownerWorkspace.json()) as {
    teams: { id: string; role: string }[];
  };
  expect(ownerBody.teams.find((team) => team.id === body.id)?.role).toBe("owner");

  for (const memberCookie of [firstCookie, secondCookie]) {
    const memberWorkspace = await workspace(memberCookie);
    const memberBody = (await memberWorkspace.json()) as {
      teams: { id: string; role: string }[];
    };
    expect(memberBody.teams.find((team) => team.id === body.id)?.role).toBe("member");
  }
});

test("same-named contests have independent ids and appear newest first", async () => {
  const suffix = Date.now();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }] = await Promise.all([
    signUp({
      email: `contest-owner-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "建队队员",
    }),
    signUp({
      email: `contest-member-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "队友",
    }),
  ]);
  const team = await createTeam(ownerCookie, "火苗");
  const joined = await join(memberCookie, team.invitationToken);
  expect(joined.status).toBe(200);

  const first = await worker.fetch(
    request(`/api/teams/${team.id}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ name: "周六训练" }),
    }),
    env,
  );
  expect(first.status).toBe(201);

  const second = await worker.fetch(
    request(`/api/teams/${team.id}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: JSON.stringify({ name: "周六训练" }),
    }),
    env,
  );
  expect(second.status).toBe(201);

  const firstContest = (await first.json()) as { id: string; createdAt: number };
  const secondContest = (await second.json()) as { id: string; createdAt: number };
  expect(secondContest.id).not.toBe(firstContest.id);
  expect(secondContest.createdAt).toBeGreaterThanOrEqual(firstContest.createdAt);

  const ownerId = await userId(ownerCookie);
  const printIds = [crypto.randomUUID(), crypto.randomUUID()].sort();
  for (const id of printIds) {
    await insertPrintout({ id, contestId: firstContest.id, userId: ownerId, requestId: crypto.randomUUID(), filename: "A.cpp" });
  }

  const listed = await workspace(memberCookie, { teamId: team.id });
  expect(await listed.json()).toEqual({
    scope: "team",
    team: { id: team.id, name: "火苗", role: "member" },
    contests: [
      { ...secondContest, printCount: 0 },
      { ...firstContest, printCount: 2 },
    ],
  });
});

test("workspace restores the last accessible team and contest links take priority", async () => {
  const suffix = Date.now();
  const { cookie } = await signUp({
    email: `multi-team-${suffix}@vprint.example`,
    password: "correct horse battery staple",
    name: "多队队员",
  });
  const firstTeam = await createTeam(cookie, "第一队");
  const secondTeam = await createTeam(cookie, "第二队");
  const contest = await worker.fetch(
    request(`/api/teams/${firstTeam.id}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "旧队训练" }),
    }),
    env,
  );
  expect(contest.status).toBe(201);
  const createdContest = (await contest.json()) as { id: string };

  const initial = await workspace(cookie);
  expect(((await initial.json()) as { selectedTeamId: string }).selectedTeamId).toBe(
    firstTeam.id,
  );

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
  expect(((await afterLoss.json()) as { selectedTeamId: string }).selectedTeamId).toBe(
    firstTeam.id,
  );
});

test("an outside account cannot open a contest or create one for the team", async () => {
  const suffix = Date.now();
  const { cookie: ownerCookie } = await signUp({
    email: `inside-${suffix}@vprint.example`,
    password: "correct horse battery staple",
    name: "队内队员",
  });
  const { cookie: outsideCookie } = await signUp({
    email: `outside-${suffix}@vprint.example`,
    password: "correct horse battery staple",
    name: "队外队员",
  });
  const team = await createTeam(ownerCookie, "内部队伍");
  const creation = await worker.fetch(
    request(`/api/teams/${team.id}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ name: "内部训练" }),
    }),
    env,
  );
  expect(creation.status).toBe(201);
  const contest = (await creation.json()) as { id: string };

  const outsiderCreation = await worker.fetch(
    request(`/api/teams/${team.id}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: outsideCookie },
      body: JSON.stringify({ name: "越权训练" }),
    }),
    env,
  );
  expect(outsiderCreation.status).toBe(403);

  const outsiderDeepLink = await workspace(outsideCookie, { teamId: team.id, contestId: contest.id });
  expect(outsiderDeepLink.status).toBe(403);
});

test("only the owner resets an invitation, and existing members keep their roles", async () => {
  const suffix = Date.now();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }] = await Promise.all([
    signUp({
      email: `reset-owner-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "甲",
    }),
    signUp({
      email: `reset-member-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "乙",
    }),
  ]);
  const team = await createTeam(ownerCookie, "重置邀请");
  await join(memberCookie, team.invitationToken);

  const memberReset = await resetInvitation(memberCookie, team.id);
  expect(memberReset.status).toBe(403);

  const reset = await resetInvitation(ownerCookie, team.id);
  expect(reset.status).toBe(200);
  const resetBody = (await reset.json()) as {
    invitationUrl: string;
    invitationToken: string;
  };
  expect(resetBody.invitationToken === team.invitationToken).toBe(false);
  expect(resetBody.invitationUrl).toBe(`${loopbackOrigin}/invite/${resetBody.invitationToken}`);

  const oldJoin = await join(memberCookie, team.invitationToken);
  expect(oldJoin.status).toBe(404);
  const oldPreview = await previewInvitation(memberCookie, team.invitationToken);
  expect(oldPreview.status).toBe(404);
  const memberPreview = await previewInvitation(
    memberCookie,
    resetBody.invitationToken,
  );
  expect(((await memberPreview.json()) as { joined: boolean }).joined).toBe(true);
  const ownerWorkspace = await workspace(ownerCookie);
  const ownerBody = (await ownerWorkspace.json()) as {
    teams: { id: string; role: string; invitationUrl: string }[];
  };
  expect(ownerBody.teams.find((item) => item.id === team.id)?.role).toBe("owner");
});

test("the owner sees teammates, while members receive a redacted invitation", async () => {
  const suffix = Date.now();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }] = await Promise.all([
    signUp({
      email: `list-owner-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "甲",
    }),
    signUp({
      email: `list-member-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "乙",
    }),
  ]);
  const team = await createTeam(ownerCookie, "队员列表");
  await join(memberCookie, team.invitationToken);

  const ownerId = ((await (
    await worker.fetch(request("/api/me", { headers: { cookie: ownerCookie } }), env)
  ).json()) as { id: string }).id;
  const memberId = ((await (
    await worker.fetch(request("/api/me", { headers: { cookie: memberCookie } }), env)
  ).json()) as { id: string }).id;

  const outsideMemberList = await members(memberCookie, team.id);
  expect(outsideMemberList.status).toBe(403);

  const memberList = await members(ownerCookie, team.id);
  expect(memberList.status).toBe(200);
  const listBody = (await memberList.json()) as {
    members: { id: string; name: string; role: string }[];
  };
  expect(listBody.members).toEqual([
    { id: ownerId, name: "甲", role: "owner" },
    { id: memberId, name: "乙", role: "member" },
  ]);

  const memberSettings = await workspace(memberCookie, { teamId: team.id, view: "settings" });
  expect(await memberSettings.json()).toEqual({
    scope: "team-settings",
    team: { id: team.id, name: expect.any(String), role: "member" },
    invitationUrl: "",
  });
});

test("the owner removes a member and resets the invitation together", async () => {
  const suffix = Date.now();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }, { cookie: outsiderCookie }] =
    await Promise.all([
      signUp({
        email: `remove-owner-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "甲",
      }),
      signUp({
        email: `remove-member-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "乙",
      }),
      signUp({
        email: `remove-outsider-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "丙",
      }),
    ]);
  const team = await createTeam(ownerCookie, "移除队员");
  await join(memberCookie, team.invitationToken);
  const memberId = ((await (
    await worker.fetch(request("/api/me", { headers: { cookie: memberCookie } }), env)
  ).json()) as { id: string }).id;
  const ownerId = ((await (
    await worker.fetch(request("/api/me", { headers: { cookie: ownerCookie } }), env)
  ).json()) as { id: string }).id;

  const memberSelfRemoval = await removeMember(memberCookie, team.id, memberId);
  expect(memberSelfRemoval.status).toBe(400);
  const memberRemovingOwner = await removeMember(memberCookie, team.id, ownerId);
  expect(memberRemovingOwner.status).toBe(403);
  const ownerSelfRemoval = await removeMember(ownerCookie, team.id, ownerId);
  expect(ownerSelfRemoval.status).toBe(400);

  expect((await leaveTeam(ownerCookie, team.id)).ok).toBe(false);
  expect((await removeMember(ownerCookie, team.id, "absent")).ok).toBe(false);
  expect(await env.DB.prepare("SELECT invitationToken FROM team WHERE id = ?").bind(team.id).first("invitationToken")).toBe(team.invitationToken);

  const removal = await removeMember(ownerCookie, team.id, memberId);
  expect(removal.status).toBe(200);
  expect(
    ((await removal.json()) as { invitationToken: string }).invitationToken ===
      team.invitationToken,
  ).toBe(false);

  const oldInvitation = await join(memberCookie, team.invitationToken);
  expect(oldInvitation.status).toBe(404);
  const removedWorkspace = await workspace(memberCookie, { teamId: team.id });
  expect(removedWorkspace.status).toBe(403);

  const reset = (await (await resetInvitation(ownerCookie, team.id)).json()) as {
    invitationToken: string;
  };
  const newcomerJoin = await join(outsiderCookie, reset.invitationToken);
  expect(newcomerJoin.status).toBe(200);
});

test("a member can leave while the invitation keeps inviting others", async () => {
  const suffix = Date.now();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }, { cookie: newcomerCookie }] =
    await Promise.all([
      signUp({
        email: `leave-owner-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "甲",
      }),
      signUp({
        email: `leave-member-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "乙",
      }),
      signUp({
        email: `leave-newcomer-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "丙",
      }),
    ]);
  const team = await createTeam(ownerCookie, "主动退队");
  await join(memberCookie, team.invitationToken);

  const leave = await leaveTeam(memberCookie, team.id);
  expect(leave.status).toBe(200);
  const leftWorkspace = await workspace(memberCookie);
  expect(((await leftWorkspace.json()) as { teams: unknown[] }).teams).toEqual([]);

  const nextJoin = await join(newcomerCookie, team.invitationToken);
  expect(nextJoin.status).toBe(200);
});

test("a concurrent invitation reset and join leave one consistent membership state", async () => {
  const suffix = Date.now();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }] = await Promise.all([
    signUp({
      email: `race-owner-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "甲",
    }),
    signUp({
      email: `race-member-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "乙",
    }),
  ]);
  const team = await createTeam(ownerCookie, "并发入队");
  const memberId = ((await (
    await worker.fetch(request("/api/me", { headers: { cookie: memberCookie } }), env)
  ).json()) as { id: string }).id;

  const [, oldTokenJoin] = await Promise.all([
    env.DB.prepare("UPDATE team SET invitationToken = ? WHERE id = ?")
      .bind("1".repeat(32), team.id)
      .run(),
    join(memberCookie, team.invitationToken),
  ]);
  const membership = await env.DB.prepare(
    "SELECT role FROM team_member WHERE teamId = ? AND userId = ?",
  )
    .bind(team.id, memberId)
    .first<{ role: string }>();

  if (oldTokenJoin.status === 200) {
    expect(membership?.role).toBe("member");
  } else {
    expect(oldTokenJoin.status).toBe(404);
    expect(membership).toBeNull();
  }
});

test("joining rechecks the token after an earlier reset in the same SQL statement", async () => {
  const suffix = Date.now();
  const { cookie: ownerCookie } = await signUp({
    email: `post-reset-owner-${suffix}@vprint.example`,
    password: "correct horse battery staple",
    name: "甲",
  });
  const { cookie: memberCookie } = await signUp({
    email: `post-reset-member-${suffix}@vprint.example`,
    password: "correct horse battery staple",
    name: "乙",
  });
  const team = await createTeam(ownerCookie, "并发入队");
  const resetResponse = await resetInvitation(ownerCookie, team.id);
  expect(resetResponse.status).toBe(200);

  const oldTokenJoin = await join(memberCookie, team.invitationToken);
  expect(oldTokenJoin.status).toBe(404);

  const membership = await env.DB.prepare(
    "SELECT role FROM team_member WHERE teamId = ? AND userId = ?",
  )
    .bind(
      team.id,
      ((await (
        await worker.fetch(request("/api/me", { headers: { cookie: memberCookie } }), env)
      ).json()) as { id: string }).id,
    )
    .first<{ role: string }>();
  expect(membership).toBeNull();
});

test("cross-origin browser form posts cannot mutate team management routes", async () => {
  const suffix = Date.now();
  const { cookie } = await signUp({
    email: `csrf-owner-${suffix}@vprint.example`,
    password: "correct horse battery staple",
    name: "甲",
  });
  const team = await createTeam(cookie, "跨源防护");

  const crossOriginReset = await worker.fetch(request(`/api/teams/${team.id}/invitation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "https://attacker.example",
    },
    body: "{}",
  }), env);
  expect(crossOriginReset.status).toBe(403);
});

test("the current owner can transfer ownership to an existing member", async () => {
  const suffix = crypto.randomUUID();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }] = await Promise.all([
    signUp({
      email: `transfer-owner-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "原队长",
    }),
    signUp({
      email: `transfer-member-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "新队长",
    }),
  ]);
  const team = await createTeam(ownerCookie, "火苗");
  await join(memberCookie, team.invitationToken);
  const member = (await (
    await worker.fetch(request("/api/me", { headers: { cookie: memberCookie } }), env)
  ).json()) as { id: string };

  for (const [cookie, target] of [[memberCookie, member.id], [ownerCookie, "unknown"]]) {
    const denied = await worker.fetch(request(`/api/teams/${team.id}/ownership`, {
      method: "PUT", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: target }),
    }), env);
    expect(denied.status).toBe(403);
  }

  const transfer = await worker.fetch(
    request(`/api/teams/${team.id}/ownership`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ userId: member.id }),
    }),
    env,
  );
  expect(transfer.status).toBe(200);
  expect(((await transfer.json()) as { ownerUserId: string }).ownerUserId).toBe(member.id);

  for (const [cookie, expectedRole] of [
    [ownerCookie, "member"],
    [memberCookie, "owner"],
  ] as const) {
    const currentWorkspace = await workspace(cookie);
    const currentTeam = ((await currentWorkspace.json()) as {
      teams: { id: string; role: string }[];
    }).teams.find((listedTeam) => listedTeam.id === team.id);
    expect(currentTeam?.role).toBe(expectedRole);
  }
});

test("only the current owner can delete a selected contest and its printouts", async () => {
  const suffix = crypto.randomUUID();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }] = await Promise.all([
    signUp({
      email: `contest-owner-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "队长",
    }),
    signUp({
      email: `contest-member-${suffix}@vprint.example`,
      password: "correct horse battery staple",
      name: "队员",
    }),
  ]);
  const team = await createTeam(ownerCookie, "火苗");
  await join(memberCookie, team.invitationToken);
  const ownerId = await userId(ownerCookie);
  const contests = await Promise.all(
    ["周六训练", "周日训练"].map((name) =>
      worker.fetch(
        request(`/api/teams/${team.id}/contests`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ name }),
        }),
        env,
      ),
    ),
  );
  const [saturday, sunday] = await Promise.all(
    contests.map((response) => response.json() as Promise<{ id: string }>),
  );
  const inserted = await insertPrintout({
    id: crypto.randomUUID(),
    contestId: saturday.id,
    userId: ownerId,
    requestId: crypto.randomUUID(),
    filename: "A.cpp",
  });
  await insertPrintout({
    id: crypto.randomUUID(),
    contestId: sunday.id,
    userId: ownerId,
    requestId: crypto.randomUUID(),
    filename: "B.cpp",
  });
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS printoutCount FROM printout WHERE contestId = ?`,
    )
      .bind(inserted.contestId)
      .first(),
  ).toEqual({ printoutCount: 1 });

  const memberPreview = await worker.fetch(
    request(`/api/contests/${saturday.id}/deletion`, {
      headers: { cookie: memberCookie },
    }),
    env,
  );
  expect(memberPreview.status).toBe(403);
  const memberDelete = await worker.fetch(
    request(`/api/contests/${saturday.id}/deletion`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: "{}",
    }),
    env,
  );
  expect(memberDelete.status).toBe(403);

  const previewResponse = await worker.fetch(
    request(`/api/contests/${saturday.id}/deletion`, {
      headers: { cookie: ownerCookie },
    }),
    env,
  );
  const previewBody = await previewResponse.json();
  expect(previewResponse.status).toBe(200);
  expect(previewBody).toEqual({
    id: inserted.contestId,
    name: "周六训练",
    teamName: "火苗",
    printoutCount: 1,
  });

  const deletion = await worker.fetch(
    request(`/api/contests/${saturday.id}/deletion`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: "{}",
    }),
    env,
  );
  expect(deletion.status).toBe(200);

  const deletedWorkspace = await workspace(ownerCookie, { teamId: team.id, contestId: saturday.id });
  expect(deletedWorkspace.status).toBe(403);
  const remainingWorkspace = await workspace(ownerCookie, { teamId: team.id });
  expect(remainingWorkspace.status).toBe(200);
  expect(((await remainingWorkspace.json()) as { contests: { id: string }[] }).contests.map(
    (contest) => contest.id,
  )).toEqual([sunday.id]);
  const endpoint = `/api/teams/${team.id}/deletion`;
  const totals = await worker.fetch(request(endpoint, { headers: { cookie: ownerCookie } }), env);
  expect(await totals.json()).toMatchObject({ name: "火苗", contestCount: 1, printoutCount: 1 });
  const denied = await worker.fetch(request(endpoint, { method: "DELETE", headers: { cookie: memberCookie } }), env);
  expect(denied.status).toBe(403);
  const dissolved = await worker.fetch(request(endpoint, { method: "DELETE", headers: { cookie: ownerCookie } }), env);
  expect(dissolved.status).toBe(200);
  expect(await env.DB.prepare("SELECT COUNT(*) FROM printout WHERE contestId IN (?, ?)").bind(saturday.id, sunday.id).first("COUNT(*)")).toBe(0);
  expect((await join(memberCookie, team.invitationToken)).status).toBe(404);

});

test("team renaming is owner-only, contest renaming allows teammates, and workspace scopes by teamId", async () => {
  const suffix = crypto.randomUUID();
  const [{ cookie: ownerCookie }, { cookie: memberCookie }, { cookie: outsiderCookie }] =
    await Promise.all([
      signUp({
        email: `rename-owner-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "队长",
      }),
      signUp({
        email: `rename-member-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "队员",
      }),
      signUp({
        email: `rename-outsider-${suffix}@vprint.example`,
        password: "correct horse battery staple",
        name: "外人",
      }),
    ]);

  const firstTeam = await createTeam(ownerCookie, "一队");
  const secondTeam = await createTeam(ownerCookie, "二队");
  await join(memberCookie, firstTeam.invitationToken);

  const contestRes = await worker.fetch(
    request(`/api/teams/${firstTeam.id}/contests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ name: "周六热身" }),
    }),
    env,
  );
  expect(contestRes.status).toBe(201);
  const contest = (await contestRes.json()) as { id: string };

  const memberTeamRename = await worker.fetch(
    request(`/api/teams/${firstTeam.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: memberCookie, origin: loopbackOrigin },
      body: JSON.stringify({ name: "非法改名" }),
    }),
    env,
  );
  expect(memberTeamRename.status).toBe(403);

  const emptyTeamRename = await worker.fetch(
    request(`/api/teams/${firstTeam.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: loopbackOrigin },
      body: JSON.stringify({ name: "   " }),
    }),
    env,
  );
  expect(emptyTeamRename.status).toBe(400);

  const crossOriginTeamRename = await worker.fetch(
    request(`/api/teams/${firstTeam.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ name: "跨源改名" }),
    }),
    env,
  );
  expect(crossOriginTeamRename.status).toBe(403);

  const ownerTeamRename = await worker.fetch(
    request(`/api/teams/${firstTeam.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: loopbackOrigin },
      body: JSON.stringify({ name: "一队（已改名）" }),
    }),
    env,
  );
  expect(ownerTeamRename.status).toBe(200);
  expect(await ownerTeamRename.json()).toEqual({ id: firstTeam.id, name: "一队（已改名）" });

  const outsiderContestRename = await worker.fetch(
    request(`/api/contests/${contest.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: outsiderCookie, origin: loopbackOrigin },
      body: JSON.stringify({ name: "越权改名" }),
    }),
    env,
  );
  expect(outsiderContestRename.status).toBe(403);

  const emptyContestRename = await worker.fetch(
    request(`/api/contests/${contest.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: memberCookie, origin: loopbackOrigin },
      body: JSON.stringify({ name: "" }),
    }),
    env,
  );
  expect(emptyContestRename.status).toBe(400);

  const crossOriginContestRename = await worker.fetch(
    request(`/api/contests/${contest.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: memberCookie,
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ name: "跨源改比赛" }),
    }),
    env,
  );
  expect(crossOriginContestRename.status).toBe(403);

  const memberContestRename = await worker.fetch(
    request(`/api/contests/${contest.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: memberCookie, origin: loopbackOrigin },
      body: JSON.stringify({ name: "周六热身 · 定稿" }),
    }),
    env,
  );
  expect(memberContestRename.status).toBe(200);
  expect(await memberContestRename.json()).toMatchObject({
    id: contest.id,
    name: "周六热身 · 定稿",
    teamId: firstTeam.id,
  });

  const scopedWs = await worker.fetch(
    request(`/api/workspace?teamId=${firstTeam.id}`, { headers: { cookie: ownerCookie } }),
    env,
  );
  expect(scopedWs.status).toBe(200);
  expect(await scopedWs.json()).toEqual({
    scope: "team",
    team: { id: firstTeam.id, name: "一队（已改名）", role: "owner" },
    contests: [{ id: contest.id, name: "周六热身 · 定稿", createdAt: expect.any(Number), printCount: 0 }],
  });
  const home = await workspace(ownerCookie);
  expect(await home.json()).toEqual({
    scope: "user",
    selectedTeamId: expect.any(String),
    teams: expect.arrayContaining([{
      id: firstTeam.id, name: "一队（已改名）", role: "owner", memberCount: 2, contestCount: 1,
    }]),
  });

  const outsiderTeamScope = await worker.fetch(
    request(`/api/workspace?teamId=${secondTeam.id}`, { headers: { cookie: memberCookie } }),
    env,
  );
  expect(outsiderTeamScope.status).toBe(403);
});
