import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import {
  oauthDeviceAuthorization,
  oauthProvider,
} from "@better-auth/oauth-provider";
import type { D1Database } from "@cloudflare/workers-types";
import { githubSignIn } from "./github";
import { createEmailOtpPlugin } from "./email-otp";

export interface AuthEnvironment {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  EMAIL?: SendEmail;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

interface SendEmail {
  send: (message: {
    to: string;
    from: string;
    subject: string;
    text: string;
  }) => Promise<void>;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthOptions {
  cliProtocol?: boolean;
  existingAccountOnly?: boolean;
}

function createAuthOptions(env: AuthEnvironment, { cliProtocol, existingAccountOnly }: AuthOptions): BetterAuthOptions {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    disabledPaths: ["/device/approve", "/device/deny", ...(cliProtocol ? [] : ["/oauth2/token", "/device/code"])],
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path !== "/sign-up/email") return;
        const name = ctx.body?.name;
        if (typeof name !== "string" || !name.trim()) {
          throw new APIError("BAD_REQUEST", { message: "请输入姓名。" });
        }
        return { context: { body: { ...ctx.body, name: name.trim() } } };
      }),
    },
    plugins: [
      createEmailOtpPlugin(env, existingAccountOnly),
      githubSignIn(env),
      jwt(),
      oauthProvider({
        scopes: [
          "offline_access",
          "vprint:teams:read",
          "vprint:print",
        ],
        loginPage: `${env.BETTER_AUTH_URL}/`,
        consentPage: `${env.BETTER_AUTH_URL}/device`,
        grantTypes: ["authorization_code", "refresh_token"],
        enforcePerClientResources: false,
        resources: [
          {
            identifier: `${env.BETTER_AUTH_URL}/api`,
            allowedScopes: [
              "vprint:teams:read",
              "vprint:print",
            ],
            dpopBoundAccessTokensRequired: true,
            accessTokenTtl: 3600,
          },
        ],
        resourceSeedScope: "process",
      }),
      oauthDeviceAuthorization({
        verificationUri: `${env.BETTER_AUTH_URL}/device`,
        validateClient: (clientId) => clientId === "vprint-cli",
      }),
    ],
  };
}

export function createAuth(env: AuthEnvironment, options: AuthOptions = {}) {
  return betterAuth(createAuthOptions(env, options));
}

export async function getCurrentUser(env: AuthEnvironment, headers: Headers) {
  const session = await createAuth(env).api.getSession({ headers });
  if (!session) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  } satisfies AuthUser;
}
