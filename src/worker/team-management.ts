import { Hono, type Context } from "hono";
import type { Environment } from "./index";
import { invalidateSubscriptions } from "./notifications";
import { getCurrentUser } from "./auth";

interface MemberRow {
  id: string;
  name: string;
  role: string;
}

type TeamManagementContext = {
  Bindings: Environment;
};

function teamId(value: string) {
  return /^[a-f0-9-]{36}$/i.test(value);
}

function userId(value: string) {
  return value.length > 0;
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function currentUser(context: Context<TeamManagementContext>) {
  return getCurrentUser(context.env, context.req.raw.headers);
}

export const teamManagementRoutes = new Hono<TeamManagementContext>();

teamManagementRoutes.on(
  ["POST", "PUT", "PATCH", "DELETE"],
  "*",
  async (context, next) => {
    const origin = context.req.header("origin");
    const configuredOrigin = context.env.BETTER_AUTH_URL.replace(/\/$/, "");
    if (origin && origin !== configuredOrigin) {
      return context.json({ error: "cross-origin request rejected" }, 403);
    }
    await next();
  },
);

teamManagementRoutes.get("/teams/:teamId/members", async (context) => {
  const user = await currentUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const requestedTeamId = context.req.param("teamId");
  if (!teamId(requestedTeamId)) return context.json({ error: "team not found" }, 404);

  const viewer = await context.env.DB.prepare(
    "SELECT role FROM team_member WHERE teamId = ? AND userId = ?",
  )
    .bind(requestedTeamId, user.id)
    .first<{ role: string }>();
  if (!viewer) return context.json({ error: "team not found" }, 403);
  if (viewer.role !== "owner") return context.json({ error: "owner role required" }, 403);

  const members = await context.env.DB.prepare(
    `
      SELECT user.id, user.name, team_member.role
      FROM team_member
      JOIN user ON user.id = team_member.userId
      WHERE team_member.teamId = ?
      ORDER BY team_member.createdAt, user.id
    `,
  )
    .bind(requestedTeamId)
    .all<MemberRow>();

  return context.json({ members: members.results });
});

teamManagementRoutes.post("/teams/:teamId/invitation", async (context) => {
  const user = await currentUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const requestedTeamId = context.req.param("teamId");
  if (!teamId(requestedTeamId)) return context.json({ error: "team not found" }, 404);
  const token = randomToken();

  const result = await context.env.DB.prepare(
    `
      UPDATE team
      SET invitationToken = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM team_member
          WHERE teamId = team.id AND userId = ? AND role = 'owner'
        )
    `,
  )
    .bind(token, requestedTeamId, user.id)
    .run();
  if (result.meta.changes === 0) return context.json({ error: "owner role required" }, 403);

  return context.json({
    invitationToken: token,
    invitationUrl: `${context.env.BETTER_AUTH_URL.replace(/\/$/, "")}/invite/${token}`,
  });
});

teamManagementRoutes.delete("/teams/:teamId/members/:memberUserId", async (context) => {
  const user = await currentUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const requestedTeamId = context.req.param("teamId");
  const memberUserId = context.req.param("memberUserId");
  if (!teamId(requestedTeamId) || !userId(memberUserId)) {
    return context.json({ error: "team not found" }, 404);
  }
  if (memberUserId === user.id) {
    return context.json({ error: "members cannot remove themselves; leave instead" }, 400);
  }

  const token = randomToken();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `
        UPDATE team
        SET invitationToken = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM team_member
            WHERE teamId = team.id AND userId = ? AND role = 'owner'
          )
          AND EXISTS (
            SELECT 1 FROM team_member WHERE teamId = team.id AND userId = ? AND role = 'member'
          )
      `,
    ).bind(token, requestedTeamId, user.id, memberUserId),
    context.env.DB.prepare(
      `
        DELETE FROM team_member
        WHERE teamId = ? AND userId = ? AND role = 'member' AND EXISTS (
          SELECT 1 FROM team_member AS owner
          WHERE owner.teamId = ? AND owner.userId = ? AND owner.role = 'owner'
        )
      `,
    ).bind(requestedTeamId, memberUserId, requestedTeamId, user.id),
  ]);
  const authorized = results[0].meta.changes === 1;
  if (!authorized) return context.json({ error: "owner role required" }, 403);
  await invalidateSubscriptions(context.env, memberUserId).catch(() => undefined);

  return context.json({
    invitationToken: token,
    invitationUrl: `${context.env.BETTER_AUTH_URL.replace(/\/$/, "")}/invite/${token}`,
  });
});

teamManagementRoutes.delete("/teams/:teamId/membership", async (context) => {
  const user = await currentUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const requestedTeamId = context.req.param("teamId");
  if (!teamId(requestedTeamId)) return context.json({ error: "team not found" }, 404);

  const result = await context.env.DB.prepare(
    "DELETE FROM team_member WHERE teamId = ? AND userId = ? AND role = 'member'",
  )
    .bind(requestedTeamId, user.id)
    .run();
  if (result.meta.changes === 0) return context.json({ error: "team not found" }, 404);

  await invalidateSubscriptions(context.env, user.id).catch(() => undefined);
  return context.json({ leftTeamId: requestedTeamId });
});
