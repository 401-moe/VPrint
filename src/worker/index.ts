import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { createAuth } from "./auth";

interface Environment {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

const app = new Hono<{ Bindings: Environment }>();

app.all("/api/auth/*", (context) => {
  const auth = createAuth(
    context.env.DB,
    context.env.BETTER_AUTH_SECRET,
    context.env.BETTER_AUTH_URL,
  );
  return auth.handler(context.req.raw);
});

app.get("/api/me", async (context) => {
  const auth = createAuth(
    context.env.DB,
    context.env.BETTER_AUTH_SECRET,
    context.env.BETTER_AUTH_URL,
  );
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
