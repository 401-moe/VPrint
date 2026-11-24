import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { createAuth } from "./auth";
import type { Environment } from "./index";

type Subscription = { userId: string; sessionId: string; expiresAt: number; contests: string[] };
type PrintEvent = { contestId: string; printId: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class UserNotifications extends DurableObject<Environment> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/connect") {
      const userId = request.headers.get("x-vprint-user")!;
      const sessionId = request.headers.get("x-vprint-session")!;
      const expiresAt = Number(request.headers.get("x-vprint-expiry"));
      const pair = new WebSocketPair();
      const socket = pair[1];
      this.ctx.acceptWebSocket(socket);
      socket.serializeAttachment({ userId, sessionId, expiresAt, contests: [] } satisfies Subscription);
      const next = await this.ctx.storage.getAlarm();
      if (next === null || expiresAt < next) await this.ctx.storage.setAlarm(expiresAt);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/publish" || path === "/revalidate") {
      const event = path === "/publish" ? await request.json() as PrintEvent : undefined;
      await Promise.all(this.ctx.getWebSockets().map(async socket => {
        const interest = socket.deserializeAttachment() as Subscription;
        if (event && !interest.contests.includes(event.contestId)) return;
        if (!await this.validate(socket, interest)) return;
        if (event && interest.contests.includes(event.contestId)) socket.send(JSON.stringify(event));
      }));
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 65536) { socket.close(1009, "Message too large"); return; }
    let data: { contests?: unknown };
    try { data = JSON.parse(message); } catch { socket.close(1003, "Invalid JSON"); return; }
    if (!Array.isArray(data?.contests) || !data.contests.every(id => typeof id === "string" && uuid.test(id))) {
      socket.close(1003, "Invalid subscriptions"); return;
    }
    const interest = socket.deserializeAttachment() as Subscription;
    interest.contests = [...new Set<string>(data.contests)];
    if (await this.validate(socket, interest)) socket.send(JSON.stringify({ subscribed: interest.contests }));
  }

  private async validate(socket: WebSocket, interest: Subscription) {
    const session = await this.env.DB.prepare("SELECT expiresAt FROM session WHERE id = ? AND userId = ?")
      .bind(interest.sessionId, interest.userId).first<{ expiresAt: string | number }>();
    const expiresAt = session ? new Date(session.expiresAt).getTime() : 0;
    if (!(expiresAt > Date.now())) { socket.close(4001, "Session ended"); return false; }
    interest.expiresAt = expiresAt;
    if (interest.contests.length) {
      const rows = await this.env.DB.prepare(`
        SELECT c.id FROM contest c JOIN team_member m ON m.teamId = c.teamId
        JOIN json_each(?) j ON j.value = c.id WHERE m.userId = ?
      `).bind(JSON.stringify(interest.contests), interest.userId).all<{ id: string }>();
      interest.contests = rows.results.map(row => row.id);
    }
    socket.serializeAttachment(interest);
    return true;
  }

  async alarm() {
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const interest = socket.deserializeAttachment() as Subscription;
      if (await this.validate(socket, interest)) next = Math.min(next, interest.expiresAt);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }

  webSocketClose(socket: WebSocket, code: number) { if (socket.readyState !== WebSocket.CLOSED) socket.close(code === 1006 ? 1000 : code); }
  webSocketError(socket: WebSocket) { socket.close(1011, "Connection failed"); }
}

function notifications(env: Pick<Environment, "NOTIFICATIONS">, userId: string) {
  return env.NOTIFICATIONS.get(env.NOTIFICATIONS.idFromName(userId));
}

export async function publishPrint(env: Pick<Environment, "DB" | "NOTIFICATIONS">, event: PrintEvent) {
  const { results } = await env.DB.prepare("SELECT m.userId FROM team_member m JOIN contest c ON c.teamId = m.teamId WHERE c.id = ?")
    .bind(event.contestId).all<{ userId: string }>();
  await Promise.all(results.map(row => notifications(env, row.userId).fetch("https://internal/publish", { method: "POST", body: JSON.stringify(event) })));
}

export async function invalidateSubscriptions(env: Pick<Environment, "NOTIFICATIONS">, userId: string) {
  await notifications(env, userId).fetch("https://internal/revalidate", { method: "POST" });
}

export const notificationRoutes = new Hono<{ Bindings: Environment }>();
notificationRoutes.get("/notification-session", async c => {
  const identity = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  return identity ? c.json({ id: identity.session.id }) : c.json({ error: "Sign in required" }, 401);
});
notificationRoutes.get("/notifications", async c => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.text("WebSocket required", 426);
  if (c.req.header("origin") !== c.env.BETTER_AUTH_URL) return c.text("Invalid origin", 403);
  const identity = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!identity) return c.text("Sign in required", 401);
  return notifications(c.env, identity.user.id).fetch("https://internal/connect", { headers: {
    Upgrade: "websocket", "x-vprint-user": identity.user.id, "x-vprint-session": identity.session.id,
    "x-vprint-expiry": String(identity.session.expiresAt.getTime()),
  } });
});
