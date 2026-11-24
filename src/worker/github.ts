import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateState, parseState } from "better-auth/oauth2";
import { github } from "better-auth/social-providers";
import { z } from "zod";
import type { AuthEnvironment } from "./auth";

type AuthContext = Parameters<typeof generateState>[0];
interface Pending {
  id: string;
  githubId: string;
  login: string;
  verifiedEmail: string | null;
  newUserId: string;
  returnPath: string;
}

function localPath(value: string, origin: string) {
  const url = URL.parse(value, origin);
  if (!url || url.origin !== origin || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search;
}

async function startSession(ctx: AuthContext, userId: string) {
  const user = await ctx.context.internalAdapter.findUserById(userId);
  if (!user) throw new APIError("UNAUTHORIZED");
  const session = await ctx.context.internalAdapter.createSession(user.id);
  await setSessionCookie(ctx, { user, session });
}

export function githubSignIn(env: AuthEnvironment): BetterAuthPlugin {
  const db = env.DB;
  const origin = env.BETTER_AUTH_URL;
  const redirectURI = origin + "/api/auth/callback/github";
  const provider = () => {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new APIError("SERVICE_UNAVAILABLE", { message: "GitHub 登录尚未配置。" });
    return github({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET });
  };
  const pendingCookie = (ctx: AuthContext) => ctx.context.createAuthCookie("github_choice", { maxAge: 600 });
  async function pending(ctx: AuthContext) {
    const id = await ctx.getSignedCookie(pendingCookie(ctx).name, ctx.context.secret);
    if (!id) return null;
    return db.prepare("SELECT * FROM github_choice WHERE id = ? AND expiresAt > unixepoch()").bind(id).first<Pending>();
  }
  function owner(id: string) {
    return db.prepare("SELECT userId FROM account WHERE providerId = 'github' AND accountId = ?").bind(id).first<string>("userId");
  }
  return {
    id: "vprint-github",
    endpoints: {
      githubStart: createAuthEndpoint("/github/start", {
        method: "POST", body: z.object({ callbackURL: z.string().max(2048).default("/") }),
      }, async ctx => {
        ctx.body.callbackURL = origin + localPath(ctx.body.callbackURL, origin);
        const client = provider();
        const session = await getSessionFromCtx(ctx);
        const { state, codeVerifier } = await generateState(ctx, { additionalData: { bindTo: session?.user.id } });
        const url = await client.createAuthorizationURL({ state, codeVerifier, redirectURI, scopes: ["user:email"] });
        return ctx.json({ url: url.href });
      }),
      githubCallback: createAuthEndpoint("/github/verified-callback", {
        method: "GET", query: z.object({ state: z.string(), code: z.string().optional(), error: z.string().optional() }),
      }, async ctx => {
        const state = await parseState(ctx);
        const returnPath = localPath(state.callbackURL, origin);
        if (!ctx.query.code || ctx.query.error) throw ctx.redirect(origin + returnPath);
        const client = provider();
        const tokens = await client.validateAuthorizationCode({ code: ctx.query.code, codeVerifier: state.codeVerifier, redirectURI });
        if (!tokens) throw ctx.redirect(origin + "/github/choice");
        const profile = await client.getUserInfo(tokens);
        if (!profile || !profile.data.id) throw ctx.redirect(origin + "/github/choice");
        const githubId = String(profile.data.id);
        const existing = await owner(githubId);
        if (existing) {
          if (typeof state.bindTo === "string" && state.bindTo !== existing) throw ctx.redirect(origin + "/github/choice?occupied=1");
          if (!state.bindTo) await startSession(ctx, existing);
          throw ctx.redirect(origin + returnPath);
        }
        const choiceId = crypto.randomUUID();
        let email = profile.user.emailVerified && profile.user.email ? profile.user.email.trim().toLowerCase() : null;
        if (!email && tokens.accessToken) {
          const response = await fetch("https://api.github.com/user/emails", { headers: { authorization: "Bearer " + tokens.accessToken, "user-agent": "VPrint" } });
          if (response.ok) {
            const addresses = await response.json() as { email: string; verified: boolean }[];
            email = addresses.find(address => address.verified)?.email.toLowerCase() ?? null;
          }
        }
        await db.batch([
          db.prepare("DELETE FROM github_choice WHERE expiresAt <= unixepoch()"),
          db.prepare("INSERT INTO github_choice (id, githubId, login, verifiedEmail, newUserId, returnPath, expiresAt) VALUES (?, ?, ?, ?, ?, ?, unixepoch() + 600)")
            .bind(choiceId, githubId, profile.data.login, email, crypto.randomUUID(), returnPath),
        ]);
        const cookie = pendingCookie(ctx);
        await ctx.setSignedCookie(cookie.name, choiceId, ctx.context.secret, cookie.attributes);
        throw ctx.redirect(origin + "/github/choice");
      }),
      githubChoice: createAuthEndpoint("/github/choice", { method: "GET" }, async ctx => {
        const choice = await pending(ctx);
        if (!choice) throw new APIError("NOT_FOUND");
        const existing = choice.verifiedEmail && await db.prepare("SELECT email FROM user WHERE email = ? COLLATE NOCASE").bind(choice.verifiedEmail).first();
        return ctx.json({ login: choice.login, email: choice.verifiedEmail, canCreate: Boolean(choice.verifiedEmail && !existing), returnPath: choice.returnPath });
      }),
      githubDecision: createAuthEndpoint("/github/decision", {
        method: "POST", body: z.object({ action: z.enum(["create", "bind", "cancel"]) }),
      }, async ctx => {
        const choice = await pending(ctx);
        if (!choice) throw new APIError("BAD_REQUEST", { message: "GitHub 授权已过期，请重新登录。" });
        const action = ctx.body.action;
        if (action !== "cancel") {
          if (!choice.verifiedEmail) throw new APIError("BAD_REQUEST", { message: "请先在 GitHub 验证邮箱。" });
          const session = await getSessionFromCtx(ctx);
          if (action === "bind" && !session) throw new APIError("UNAUTHORIZED");
          const target = action === "create" ? choice.newUserId : session!.user.id;
          const writes = [];
          if (action === "create") {
            writes.push(db.prepare(`
              INSERT INTO user(id, name, email, emailVerified, createdAt, updatedAt)
              SELECT newUserId, login, verifiedEmail, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM github_choice q
              WHERE q.id = ? AND q.expiresAt > unixepoch()
                AND NOT EXISTS (SELECT 1 FROM user WHERE email = q.verifiedEmail COLLATE NOCASE)
                AND NOT EXISTS (SELECT 1 FROM account WHERE providerId = 'github' AND accountId = q.githubId)
              ON CONFLICT DO NOTHING
            `).bind(choice.id));
          }
          writes.push(db.prepare(`
            INSERT INTO account(id, userId, accountId, providerId, createdAt, updatedAt)
            SELECT ?, u.id, q.githubId, 'github', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM github_choice q JOIN user u ON u.id = ?
            WHERE q.id = ? AND q.expiresAt > unixepoch()
              AND NOT EXISTS (SELECT 1 FROM user other WHERE other.email = q.verifiedEmail COLLATE NOCASE AND other.id != u.id)
            ON CONFLICT(providerId, accountId) DO NOTHING
          `).bind(crypto.randomUUID(), target, choice.id));
          await db.batch(writes);
          if (await owner(choice.githubId) !== target) throw new APIError("CONFLICT", { message: "该身份已占用，或需要验证同邮箱的原账号。" });
          if (action === "create") await startSession(ctx, target);
        }
        await db.prepare("DELETE FROM github_choice WHERE id = ?").bind(choice.id).run();
        const cookie = pendingCookie(ctx);
        ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
        return ctx.json({ returnPath: localPath(choice.returnPath, origin) });
      }),
    },
  };
}
