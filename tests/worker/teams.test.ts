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

async function workspace(cookie: string, contestId?: string) {
  return worker.fetch(
    request(`/api/workspace${contestId ? `?contestId=${contestId}` : ""}`, {
      headers: { cookie },
    }),
    env,
  );
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

  const listed = await workspace(memberCookie);
  const listBody = (await listed.json()) as {
    selectedTeamId: string;
    contests: { id: string; name: string; createdAt: number }[];
  };
  expect(listBody.selectedTeamId).toBe(team.id);
  expect(listBody.contests.map((contest) => contest.id)).toEqual([
    secondContest.id,
    firstContest.id,
  ]);
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

  const deepLinked = await workspace(cookie, createdContest.id);
  const deepLinkedBody = (await deepLinked.json()) as {
    selectedTeamId: string;
    contest: { id: string };
  };
  expect(deepLinkedBody.selectedTeamId).toBe(firstTeam.id);
  expect(deepLinkedBody.contest.id).toBe(createdContest.id);

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

  const outsiderDeepLink = await workspace(outsideCookie, contest.id);
  expect(outsiderDeepLink.status).toBe(403);
});
