import { Hono } from "hono";
import type { Environment } from "./index";
import { createAuth } from "./auth";

export const sessionRoutes = new Hono<{ Bindings: Environment }>();

sessionRoutes.get("/account/sessions", async c => {
  const auth = createAuth(c.env);
  const headers = c.req.raw.headers;
  const identity = await auth.api.getSession({ headers });
  if (!identity) return c.json({ error: "authentication required" }, 401);
  const [web, grants] = await Promise.all([
    auth.api.listSessions({ headers }),
    c.env.DB.prepare(`
      SELECT id, hostname, os, approvedAt, expiresAt FROM vprint_cli_grant
      WHERE userId = ? AND revokedAt IS NULL AND keyThumbprint IS NOT NULL AND expiresAt > unixepoch()
    `).bind(identity.user.id).all<{ id: string; hostname: string; os: string; approvedAt: number; expiresAt: number }>(),
  ]);
  const sessions = [
    ...web.map(s => ({
      id: s.id, type: "web", device: s.userAgent || "未知浏览器",
      createdAt: new Date(s.createdAt).getTime(), expiresAt: new Date(s.expiresAt).getTime(), current: s.id === identity.session.id,
    })),
    ...grants.results.map(g => ({
      id: g.id, type: "cli", device: g.hostname + " · " + ({ darwin: "macOS", win32: "Windows", linux: "Linux" }[g.os] ?? g.os),
      createdAt: g.approvedAt * 1000, expiresAt: g.expiresAt * 1000, current: false,
    })),
  ].sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt - a.createdAt);
  return c.json({ sessions });
});

sessionRoutes.delete("/account/sessions/:type/:id", async c => {
  const identity = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!identity) return c.json({ error: "authentication required" }, 401);
  const { type, id } = c.req.param();
  if (type !== "web" && type !== "cli") return c.json({ error: "invalid session type" }, 400);
  const query = type === "web"
    ? "DELETE FROM session WHERE id = ? AND userId = ? RETURNING id"
    : "UPDATE vprint_cli_grant SET revokedAt = unixepoch(), refreshTokenHash = NULL WHERE id = ? AND userId = ? AND revokedAt IS NULL RETURNING id";
  const result = await c.env.DB.prepare(query).bind(id, identity.user.id).first();
  if (!result) return c.json({ error: "session not found" }, 404);
  return c.json({ current: type === "web" && id === identity.session.id });
});
