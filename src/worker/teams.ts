import type { Contest, ContestSummary, TeamSummary, WorkspaceData, WorkspaceTeam } from "../shared/workspace";
import { Hono } from "hono";
import { getCurrentUser, type AuthEnvironment } from "./auth";

type TeamContext = {
  Bindings: AuthEnvironment;
  Variables: Record<string, never>;
};

export const teamsRoutes = new Hono<TeamContext>();

function invitationUrl(env: AuthEnvironment, token: string) {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/invite/${token}`;
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

function userId(value: string) {
  return value.length > 0 && value.length <= 128;
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
      id, name, role: "owner", createdAt,
      invitationUrl: invitationUrl(context.env, token),
      invitationToken: token,
    },
    201,
  );
});

teamsRoutes.post("/team-invitations/:token/join", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const token = context.req.param("token");
  const [, lookup] = await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO team_member (teamId, userId, role, createdAt)
      SELECT id, ?, 'member', ? FROM team WHERE invitationToken = ?
      ON CONFLICT(teamId, userId) DO NOTHING
    `).bind(user.id, Date.now(), token),
    context.env.DB.prepare(`
      SELECT t.id, t.name, m.role FROM team t
      JOIN team_member m ON m.teamId = t.id
      WHERE t.invitationToken = ? AND m.userId = ?
    `).bind(token, user.id),
  ]);
  const team = lookup.results[0];
  if (!team) return context.json({ error: "invitation not found" }, 404);
  return context.json(team);
});

teamsRoutes.post("/teams/:teamId/contests", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const teamIdValue = context.req.param("teamId");
  if (!teamId(teamIdValue)) return context.json({ error: "team not found" }, 404);

  const body = await requestBody(context);
  const name = contestName((body as { name?: unknown } | null)?.name);
  if (!name) return context.json({ error: "invalid contest name" }, 400);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const result = await context.env.DB.prepare(`
    INSERT INTO contest (id, teamId, name, createdAt)
    SELECT ?, teamId, ?, ? FROM team_member WHERE teamId = ? AND userId = ?
  `).bind(id, name, createdAt, teamIdValue, user.id).run();
  if (result.meta.changes !== 1) return context.json({ error: "team not found" }, 403);

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

teamsRoutes.put("/teams/:teamId/ownership", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const targetTeamId = context.req.param("teamId");
  if (!teamId(targetTeamId)) return context.json({ error: "team not found" }, 404);

  const body = await requestBody(context);
  const nextOwnerUserId = (body as { userId?: unknown } | null)?.userId;
  if (typeof nextOwnerUserId !== "string" || !userId(nextOwnerUserId)) {
    return context.json({ error: "invalid team member" }, 400);
  }

  const transfer = await context.env.DB.prepare(`
    WITH eligible AS MATERIALIZED (
      SELECT current.userId AS previous, following.userId AS successor
      FROM team_member current JOIN team_member following ON following.teamId = current.teamId
      WHERE current.teamId = ? AND current.userId = ? AND current.role = 'owner'
        AND following.userId = ? AND following.role = 'member'
    )
    UPDATE team_member SET role = CASE WHEN userId = ? THEN 'owner' ELSE 'member' END
    WHERE teamId = ? AND userId IN (SELECT previous FROM eligible UNION ALL SELECT successor FROM eligible)
    RETURNING userId
  `).bind(targetTeamId, user.id, nextOwnerUserId, nextOwnerUserId, targetTeamId).all();
  if (transfer.results.length !== 2) return context.json({ error: "无法转让队长。" }, 403);

  return context.json({ ownerUserId: nextOwnerUserId });
});

teamsRoutes.get("/workspace", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const contestId = context.req.query("contestId");
  const teamId = context.req.query("teamId");
  const db = context.env.DB;

  if (contestId !== undefined) {
    const row = await db.prepare(`
      SELECT c.id, c.name, c.createdAt, t.id AS teamId, t.name AS teamName, m.role
      FROM contest c
      JOIN team t ON t.id = c.teamId
      JOIN team_member m ON m.teamId = t.id
      WHERE c.id = ? AND t.id = ? AND m.userId = ?
    `).bind(contestId, teamId ?? "", user.id)
      .first<Contest & { teamId: string; teamName: string; role: WorkspaceTeam["role"] }>();
    if (!row) return context.json({ error: "contest not found" }, 403);
    return context.json({
      scope: "contest",
      team: { id: row.teamId, name: row.teamName, role: row.role },
      contest: { id: row.id, name: row.name, createdAt: row.createdAt },
    } satisfies WorkspaceData);
  }

  if (teamId !== undefined) {
    const membership = db.prepare(`
      SELECT t.id, t.name, m.role, t.invitationToken
      FROM team t JOIN team_member m ON m.teamId = t.id
      WHERE t.id = ? AND m.userId = ?
    `).bind(teamId, user.id);
    if (context.req.query("view") === "settings") {
      const row = await membership.first<WorkspaceTeam & { invitationToken: string }>();
      if (!row) return context.json({ error: "team not found" }, 403);
      const { invitationToken, ...team } = row;
      return context.json({
        scope: "team-settings", team,
        invitationUrl: team.role === "owner" ? invitationUrl(context.env, invitationToken) : "",
      } satisfies WorkspaceData);
    }

    const [row, contests] = await Promise.all([
      membership.first<WorkspaceTeam>(),
      db.prepare(`
        SELECT c.id, c.name, c.createdAt,
          (SELECT COUNT(*) FROM printout WHERE contestId = c.id) AS printCount
        FROM contest c JOIN team_member m ON m.teamId = c.teamId
        WHERE c.teamId = ? AND m.userId = ?
        ORDER BY c.createdAt DESC, c.id DESC
      `).bind(teamId, user.id).all<ContestSummary>(),
    ]);
    if (!row) return context.json({ error: "team not found" }, 403);
    return context.json({
      scope: "team",
      team: { id: row.id, name: row.name, role: row.role },
      contests: contests.results,
    } satisfies WorkspaceData);
  }

  const { results } = await db.prepare(`
    SELECT t.id, t.name, m.role, s.teamId IS NOT NULL AS selected,
      (SELECT COUNT(*) FROM team_member WHERE teamId = t.id) AS memberCount,
      (SELECT COUNT(*) FROM contest WHERE teamId = t.id) AS contestCount
    FROM team_member m JOIN team t ON t.id = m.teamId
    LEFT JOIN team_selection s ON s.userId = m.userId AND s.teamId = t.id
    WHERE m.userId = ?
    ORDER BY t.name, t.id
  `).bind(user.id).all<TeamSummary & { selected: number }>();
  return context.json({
    scope: "user",
    teams: results.map(({ selected, ...team }) => team),
    selectedTeamId: results.find(team => team.selected)?.id ?? null,
  } satisfies WorkspaceData);
});
