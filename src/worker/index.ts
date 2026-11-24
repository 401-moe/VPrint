import { Hono } from "hono";
import { createAuth, getCurrentUser, type AuthEnvironment } from "./auth";
import { teamManagementRoutes } from "./team-management";
import { teamsRoutes } from "./teams";

export interface Environment extends AuthEnvironment {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const app = new Hono<{ Bindings: Environment }>();

app.all("/api/auth/*", (context) => {
  const auth = createAuth(context.env);
  return auth.handler(context.req.raw);
});

app.route("/api", teamsRoutes);
app.route("/api", teamManagementRoutes);

app.get("/api/me", async (context) => {
  const user = await getCurrentUser(context.env, context.req.raw.headers);
  if (!user) {
    return context.json({ error: "authentication required" }, 401);
  }

  return context.json(user);
});

app.get("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
