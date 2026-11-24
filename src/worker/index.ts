import { Hono } from "hono";
import { createAuth, type AuthEnvironment } from "./auth";

export interface Environment extends AuthEnvironment {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const app = new Hono<{ Bindings: Environment }>();

app.all("/api/auth/*", (context) => {
  const auth = createAuth(context.env);
  return auth.handler(context.req.raw);
});

app.get("/api/me", async (context) => {
  const auth = createAuth(context.env);
  const session = await auth.api.getSession({ headers: context.req.raw.headers });

  if (!session) {
    return context.json({ error: "authentication required" }, 401);
  }

  return context.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
});

app.get("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
