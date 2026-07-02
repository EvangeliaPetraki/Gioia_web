import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";

/** Allows a request only if it carries a valid session whose user is an admin. */
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      throw new UnauthorizedException("Authentication required.");
    }
    if ((session.user as { role?: string }).role !== "admin") {
      throw new ForbiddenException("Administrator access required.");
    }
    (req as Request & { user?: unknown }).user = session.user;
    return true;
  }
}
