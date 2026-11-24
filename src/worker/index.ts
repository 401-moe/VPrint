import { Hono } from "hono";
import { createAuth, type AuthEnvironment } from "./auth";
import {
  captureDeviceRequest,
  decideDeviceRequest,
  getDeviceRequest,
} from "./cli-device";
import {
  cliToken,
  getCliMe,
  logoutCli,
} from "./cli";

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

app.get("/api/cli/device", (context) => getDeviceRequest(context));
app.post("/api/cli/device/decision", (context) => decideDeviceRequest(context));
app.get("/api/cli/me", (context) => getCliMe(context));
app.post("/api/cli/logout", (context) => logoutCli(context));

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
