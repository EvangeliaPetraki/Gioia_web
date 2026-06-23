import { betterAuth, type Auth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { PrismaClient } from "@prisma/client";

// Better Auth needs a Prisma client at module scope (before Nest DI is ready).
const prisma = new PrismaClient();

/**
 * Email/password auth with the admin plugin. Sign-up is disabled — users are
 * created only by an admin (the admin plugin's create-user endpoint). The first
 * admin is seeded from ADMIN_EMAIL/ADMIN_PASSWORD (see AdminBootstrapService).
 */
export const auth: Auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // AUTH_SECRET is kept as a temporary compatibility fallback for existing
  // local installations. Use BETTER_AUTH_SECRET for new environments.
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  basePath: "/api/auth",
  trustedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // no public registration; admins create users
  },
  plugins: [admin()],
}) as unknown as Auth;
