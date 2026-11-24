import { Hono } from "hono";
import { createAuth, getCurrentUser, type AuthEnvironment } from "./auth";
import { printoutsRoutes } from "./printouts";
import { teamsRoutes } from "./teams";
import { captureDeviceRequest, decideDeviceRequest, getDeviceRequest } from "./cli-device";
import { cliToken, getCliMe, logoutCli } from "./cli";

export interface Environment extends AuthEnvironment {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const app = new Hono<{ Bindings: Environment }>();

app.post("/api/auth/device/code", captureDeviceRequest);
app.post("/api/auth/oauth2/token", cliToken);

app.all("/api/auth/*", (context) => {
  const auth = createAuth(context.env);
  return auth.handler(context.req.raw);
});

app.get("/api/cli/device", getDeviceRequest);
app.post("/api/cli/device/decision", decideDeviceRequest);
app.get("/api/cli/me", getCliMe);
app.post("/api/cli/logout", logoutCli);
app.route("/api", teamsRoutes);
app.route("/api", printoutsRoutes);

app.get("/api/me", async (context) => {
  const user = await getCurrentUser(context.env, context.req.raw.headers);
  if (!user) {
    return context.json({ error: "authentication required" }, 401);
  }

  return context.json(user);
});

app.get("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
