export { UserNotifications } from "./notifications";
import { invalidateSubscriptions, notificationRoutes } from "./notifications";
import { Hono } from "hono";
import { createAuth, getCurrentUser, type AuthEnvironment } from "./auth";
import { contestLifecycleRoutes } from "./contest-lifecycle";
import { printoutsRoutes } from "./printouts";
import { teamManagementRoutes } from "./team-management";
import { sessionRoutes } from "./sessions";
import { teamsRoutes } from "./teams";
import { captureDeviceRequest, decideDeviceRequest, getDeviceRequest } from "./cli-device";
import { cliToken, getCliMe, logoutCli } from "./cli";

export interface Environment extends AuthEnvironment {
  NOTIFICATIONS: DurableObjectNamespace;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const app = new Hono<{ Bindings: Environment }>();

app.post("/api/auth/device/code", captureDeviceRequest);
app.post("/api/auth/oauth2/token", cliToken);

app.get("/api/auth/callback/github", context => {
  const url = new URL(context.req.url);
  url.pathname = "/api/auth/github/verified-callback";
  return createAuth(context.env).handler(new Request(url, context.req.raw));
});

app.post("/api/auth/sign-out", async c => {
  const auth = createAuth(c.env);
  const identity = await auth.api.getSession({ headers: c.req.raw.headers });
  const result = await auth.handler(c.req.raw);
  if (result.ok && identity) await invalidateSubscriptions(c.env, identity.user.id).catch(() => undefined);
  return result;
});

app.route("/api", notificationRoutes);
app.all("/api/auth/*", (context) => {
  const auth = createAuth(context.env);
  return auth.handler(context.req.raw);
});

app.get("/api/cli/device", getDeviceRequest);
app.post("/api/cli/device/decision", decideDeviceRequest);
app.get("/api/cli/me", getCliMe);
app.post("/api/cli/logout", logoutCli);
app.route("/api", sessionRoutes);
app.route("/api", teamsRoutes);
app.route("/api", contestLifecycleRoutes);
app.route("/api", printoutsRoutes);
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
