import { betterAuth, type BetterAuthOptions } from "better-auth";
import { jwt } from "better-auth/plugins";
import {
  oauthDeviceAuthorization,
  oauthProvider,
} from "@better-auth/oauth-provider";
import type { D1Database } from "@cloudflare/workers-types";

export interface AuthEnvironment {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

export function createAuthOptions(env: AuthEnvironment, cliProtocol = false): BetterAuthOptions {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    disabledPaths: ["/device/approve", "/device/deny", ...(cliProtocol ? [] : ["/oauth2/token", "/device/code"])],
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
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

export function createAuth(env: AuthEnvironment, cliProtocol = false) {
  return betterAuth(createAuthOptions(env, cliProtocol));
}
