import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { auth } from "./auth";

/**
 * Seeds the first admin from ADMIN_EMAIL / ADMIN_PASSWORD on boot if that user
 * doesn't exist yet. After this, the admin creates other users from the app.
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const email = process.env.ADMIN_EMAIL?.trim();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      this.logger.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin bootstrap.");
      return;
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    try {
      // Hash with Better Auth's own hasher so sign-in verifies correctly.
      const ctx = await auth.$context;
      const hashed = await ctx.password.hash(password);
      const now = new Date();
      const userId = randomUUID();

      await this.prisma.$transaction([
        this.prisma.user.create({
          data: {
            id: userId,
            name: "Admin",
            email,
            emailVerified: true,
            role: "admin",
            createdAt: now,
            updatedAt: now,
          },
        }),
        this.prisma.account.create({
          data: {
            id: randomUUID(),
            userId,
            providerId: "credential",
            accountId: userId,
            password: hashed,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ]);
      this.logger.log(`Bootstrapped admin user "${email}".`);
    } catch (e) {
      this.logger.error(`Admin bootstrap failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
