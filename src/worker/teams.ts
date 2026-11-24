import { Hono } from "hono";
import { getCurrentUser, type AuthEnvironment } from "./auth";

interface TeamRow {
  id: string;
  name: string;
  role: string;
  createdAt: number;
  invitationToken?: string;
}

interface TeamResponseRow extends TeamRow {
  invitationUrl: string;
}

interface ContestRow {
  id: string;
  name: string;
  createdAt: number;
}

interface ContestWithTeamRow extends ContestRow {
  teamId: string;
}

type TeamContext = {
  Bindings: AuthEnvironment;
  Variables: Record<string, never>;
};

export const teamsRoutes = new Hono<TeamContext>();

function invitationUrl(env: AuthEnvironment, token: string) {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/invite/${token}`;
}

function teamResponse(row: TeamResponseRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
    invitationUrl: row.invitationUrl,
  };
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestBody(context: { req: { json: () => Promise<unknown> } }) {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

function teamName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 100 ? name : null;
}

function contestName(value: unknown) {
  return teamName(value);
}

function teamId(value: string) {
  return /^[a-f0-9-]{36}$/i.test(value);
}

async function requireUser(context: { env: AuthEnvironment; req: { raw: Request } }) {
  return getCurrentUser(context.env, context.req.raw.headers);
}

teamsRoutes.post("/teams", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const body = await requestBody(context);
  const name = teamName((body as { name?: unknown } | null)?.name);
  if (!name) return context.json({ error: "invalid team name" }, 400);

  const id = crypto.randomUUID();
  const token = randomToken();
  const createdAt = Date.now();
  await context.env.DB.batch([
    context.env.DB.prepare(
      "INSERT INTO team (id, name, invitationToken, createdAt) VALUES (?, ?, ?, ?)",
    ).bind(id, name, token, createdAt),
    context.env.DB.prepare(
      "INSERT INTO team_member (teamId, userId, role, createdAt) VALUES (?, ?, 'owner', ?)",
    ).bind(id, user.id, createdAt),
  ]);

  return context.json(
    {
      ...teamResponse({
        id,
        name,
        role: "owner",
        createdAt,
        invitationToken: token,
        invitationUrl: invitationUrl(context.env, token),
      }),
      invitationToken: token,
    },
    201,
  );
});

teamsRoutes.post("/team-invitations/:token/join", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const token = context.req.param("token");
  const team = await context.env.DB.prepare(
    `
      SELECT team.id, team.name, team.createdAt
      FROM team
      WHERE team.invitationToken = ?
    `,
  )
    .bind(token)
    .first<TeamRow>();
  if (!team) return context.json({ error: "invitation not found" }, 404);

  const result = await context.env.DB.prepare(
    `
      INSERT INTO team_member (teamId, userId, role, createdAt)
      VALUES (?, ?, 'member', ?)
      ON CONFLICT(teamId, userId) DO NOTHING
    `,
  )
    .bind(team.id, user.id, Date.now())
    .run();
  if (!result.success) return context.json({ error: "failed to join team" }, 500);

  return context.json({ id: team.id, name: team.name, role: "member" });
});

teamsRoutes.post("/teams/:teamId/contests", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const teamIdValue = context.req.param("teamId");
  if (!teamId(teamIdValue)) return context.json({ error: "team not found" }, 404);

  const body = await requestBody(context);
  const name = contestName((body as { name?: unknown } | null)?.name);
  if (!name) return context.json({ error: "invalid contest name" }, 400);

  const membership = await context.env.DB.prepare(
    "SELECT role FROM team_member WHERE teamId = ? AND userId = ?",
  )
    .bind(teamIdValue, user.id)
    .first<{ role: string }>();
  if (!membership) return context.json({ error: "team not found" }, 403);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const result = await context.env.DB.prepare(
    "INSERT INTO contest (id, teamId, name, createdAt) VALUES (?, ?, ?, ?)",
  )
    .bind(id, teamIdValue, name, createdAt)
    .run();
  if (!result.success) return context.json({ error: "failed to create contest" }, 500);

  return context.json({ id, name, createdAt }, 201);
});

teamsRoutes.put("/teams/:teamId/selection", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const teamIdValue = context.req.param("teamId");
  if (!teamId(teamIdValue)) return context.json({ error: "team not found" }, 404);

  const result = await context.env.DB.prepare(
    `
      INSERT INTO team_selection (userId, teamId, updatedAt)
      SELECT ?, teamId, ?
      FROM team_member
      WHERE teamId = ? AND userId = ?
      ON CONFLICT(userId) DO UPDATE SET teamId = excluded.teamId, updatedAt = excluded.updatedAt
    `,
  )
    .bind(user.id, Date.now(), teamIdValue, user.id)
    .run();
  if (result.meta.changes === 0) return context.json({ error: "team not found" }, 403);

  return context.json({ selectedTeamId: teamIdValue });
});

teamsRoutes.get("/workspace", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const requestedContestId = context.req.query("contestId");
  if (requestedContestId && !teamId(requestedContestId)) {
    return context.json({ error: "contest not found" }, 403);
  }

  if (requestedContestId) {
    const membership = await context.env.DB.prepare(
      `
        SELECT contest.id
        FROM contest
        JOIN team_member ON team_member.teamId = contest.teamId
        WHERE contest.id = ? AND team_member.userId = ?
      `,
    )
      .bind(requestedContestId, user.id)
      .first<{ id: string }>();
    if (!membership) return context.json({ error: "contest not found" }, 403);
  }

  const teams = await context.env.DB.prepare(
    `
      SELECT team.id, team.name, team_member.role, team.createdAt, team.invitationToken
      FROM team_member
      JOIN team ON team.id = team_member.teamId
      WHERE team_member.userId = ?
      ORDER BY team.name, team.id
    `,
  )
    .bind(user.id)
    .all<TeamRow>();

  if (teams.results.length === 0) {
    return context.json({ teams: [], selectedTeamId: null, contests: [], contest: null });
  }

  let contest: ContestWithTeamRow | null = null;
  let selectedTeam: TeamRow | undefined;

  if (requestedContestId) {
    contest = await context.env.DB.prepare(
      `
        SELECT contest.id, contest.name, contest.createdAt, contest.teamId
        FROM contest
        JOIN team_member ON team_member.teamId = contest.teamId
        WHERE contest.id = ? AND team_member.userId = ?
      `,
    )
      .bind(requestedContestId, user.id)
      .first<ContestWithTeamRow>();
    if (!contest) return context.json({ error: "contest not found" }, 403);

    selectedTeam = teams.results.find((team) => team.id === contest?.teamId);
  }

  if (!selectedTeam) {
    const selection = await context.env.DB.prepare(
      `
        SELECT team.id, team.name, team_member.role, team.createdAt, team.invitationToken
        FROM team_selection
        JOIN team ON team.id = team_selection.teamId
        JOIN team_member ON team_member.teamId = team.id AND team_member.userId = ?
        WHERE team_selection.userId = ?
      `,
    )
      .bind(user.id, user.id)
    .first<TeamRow>();
    selectedTeam = selection ?? teams.results[0];
  }

  const contests = await context.env.DB.prepare(
    `
      SELECT id, name, createdAt
      FROM contest
      WHERE teamId = ?
      ORDER BY createdAt DESC, id DESC
    `,
  )
    .bind(selectedTeam.id)
    .all<ContestRow>();

  return context.json({
    teams: teams.results.map((team) => ({
      id: team.id,
      name: team.name,
      role: team.role,
      createdAt: team.createdAt,
      invitationUrl: invitationUrl(context.env, team.invitationToken ?? ""),
    })),
    selectedTeamId: selectedTeam.id,
    contests: contests.results,
    contest,
  });
});
