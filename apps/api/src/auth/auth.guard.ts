import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";

/** Allows a request only if it carries a valid Better Auth session (cookie). */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      throw new UnauthorizedException("Authentication required.");
    }
    // Make the user available to downstream handlers if needed.
    (req as Request & { user?: unknown }).user = session.user;
    return true;
  }
}
