import { createDatabase, schema } from "@flight-lens/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { ApiConfig } from "./config.js";
import { createAuthEmailSender, type AuthEmailSender } from "./auth-email.js";

export type AuthSession = {
  session: { id: string; token: string; expiresAt: Date };
  user: { id: string; name: string; email: string; emailVerified: boolean };
};

export type AuthService = {
  handler(request: Request): Promise<Response>;
  getSession(headers: IncomingHttpHeaders): Promise<AuthSession | null>;
  close(): Promise<void>;
};

type DrizzleAuthDatabase = Parameters<typeof drizzleAdapter>[0];

export function createAuthServiceWithDatabase(
  config: ApiConfig,
  authDatabase: DrizzleAuthDatabase,
  emailSender: AuthEmailSender,
  close: () => Promise<void> = async () => undefined,
): AuthService {
  if (!config.authSecret || !config.authBaseUrl) throw new Error("AUTH_CONFIGURATION_REQUIRED");
  const auth = betterAuth({
    appName: "航探 Flight Lens",
    baseURL: config.authBaseUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: config.webOrigins,
    database: drizzleAdapter(authDatabase, {
      provider: "pg",
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "重置航探密码",
          text: `请使用此一次性链接重置密码：${url}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "验证航探邮箱",
          text: `请在一小时内验证邮箱：${url}`,
        });
      },
    },
    user: {
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    advanced: {
      useSecureCookies: config.nodeEnv === "production",
      ipAddress: { ipAddressHeaders: ["x-flight-lens-client-ip"] },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.nodeEnv === "production",
        sameSite: "lax",
        path: "/",
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: config.nodeEnv === "test" ? 1_000 : 10,
      customRules: {
        "/sign-in/email": { window: 60, max: config.nodeEnv === "test" ? 1_000 : 5 },
        "/request-password-reset": { window: 300, max: config.nodeEnv === "test" ? 1_000 : 3 },
      },
    },
  });

  return {
    handler: (request) => auth.handler(request),
    async getSession(headers) {
      return await auth.api.getSession({ headers: fromNodeHeaders(headers) }) as AuthSession | null;
    },
    close,
  };
}

export function createAuthService(
  config: ApiConfig,
  emailSender: AuthEmailSender | null = createAuthEmailSender(config.resendApiKey, config.authEmailFrom),
): AuthService | null {
  if (!config.databaseUrl || !config.authSecret || !config.authBaseUrl || !emailSender) return null;
  const database = createDatabase(config.databaseUrl);
  return createAuthServiceWithDatabase(config, database.db, emailSender, database.close);
}
