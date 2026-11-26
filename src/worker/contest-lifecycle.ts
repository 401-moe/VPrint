import { Hono } from "hono";
import { getCurrentUser, type AuthEnvironment } from "./auth";

type ContestLifecycleContext = {
  Bindings: AuthEnvironment;
  Variables: Record<string, never>;
};

export const contestLifecycleRoutes = new Hono<ContestLifecycleContext>();

contestLifecycleRoutes.on(
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

function identifier(value: string) {
  return /^[a-f0-9-]{36}$/i.test(value);
}

async function requireUser(context: { env: AuthEnvironment; req: { raw: Request } }) {
  return getCurrentUser(context.env, context.req.raw.headers);
}

contestLifecycleRoutes.patch("/contests/:contestId", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const contestId = context.req.param("contestId");
  if (!identifier(contestId)) return context.json({ error: "contest not found" }, 404);

  let body: { name?: unknown } | null = null;
  try {
    body = await context.req.json();
  } catch {
    body = null;
  }
  const rawName = body?.name;
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";
  if (trimmed.length === 0 || trimmed.length > 100) {
    return context.json({ error: "invalid contest name" }, 400);
  }

  const updated = await context.env.DB.prepare(
    `
      UPDATE contest
      SET name = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM team_member
          WHERE team_member.teamId = contest.teamId AND team_member.userId = ?
        )
      RETURNING id, name, createdAt, teamId
    `,
  )
    .bind(trimmed, contestId, user.id)
    .first<{ id: string; name: string; createdAt: number; teamId: string }>();

  return updated
    ? context.json(updated)
    : context.json({ error: "contest not found" }, 403);
});

contestLifecycleRoutes.get("/contests/:contestId/deletion", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const contestId = context.req.param("contestId");
  if (!identifier(contestId)) return context.json({ error: "contest not found" }, 404);

  const preview = await context.env.DB.prepare(
    `
      SELECT contest.id, contest.name, team.name AS teamName,
        (SELECT COUNT(*) FROM printout WHERE printout.contestId = contest.id) AS printoutCount
      FROM contest
      JOIN team ON team.id = contest.teamId
      JOIN team_member ON team_member.teamId = team.id
      WHERE contest.id = ? AND team_member.userId = ? AND team_member.role = 'owner'
    `,
  )
    .bind(contestId, user.id)
    .first<{ id: string; name: string; teamName: string; printoutCount: number }>();
  if (!preview) return context.json({ error: "contest not found" }, 403);

  return context.json(preview);
});

contestLifecycleRoutes.delete("/contests/:contestId/deletion", async (context) => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const contestId = context.req.param("contestId");
  if (!identifier(contestId)) return context.json({ error: "contest not found" }, 404);

  const result = await context.env.DB.prepare(`
    DELETE FROM contest WHERE id = ? AND teamId IN (
      SELECT teamId FROM team_member WHERE userId = ? AND role = 'owner'
    ) RETURNING id
  `).bind(contestId, user.id).first();
  return result ? context.json(result) : context.json({ error: "contest not found" }, 403);
});

contestLifecycleRoutes.get("/teams/:teamId/deletion", async context => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const preview = await context.env.DB.prepare(`
    SELECT t.id, t.name, COUNT(DISTINCT c.id) AS contestCount, COUNT(p.id) AS printoutCount
    FROM team t JOIN team_member m ON m.teamId = t.id
    LEFT JOIN contest c ON c.teamId = t.id LEFT JOIN printout p ON p.contestId = c.id
    WHERE t.id = ? AND m.userId = ? AND m.role = 'owner'
    GROUP BY t.id
  `).bind(context.req.param("teamId"), user.id).first();
  return preview ? context.json(preview) : context.json({ error: "team not found" }, 403);
});

contestLifecycleRoutes.delete("/teams/:teamId/deletion", async context => {
  const user = await requireUser(context);
  if (!user) return context.json({ error: "authentication required" }, 401);
  const result = await context.env.DB.prepare(`
    DELETE FROM team WHERE id = ? AND id IN (
      SELECT teamId FROM team_member WHERE userId = ? AND role = 'owner'
    ) RETURNING id
  `).bind(context.req.param("teamId"), user.id).first();
  return result ? context.json(result) : context.json({ error: "team not found" }, 403);
});
