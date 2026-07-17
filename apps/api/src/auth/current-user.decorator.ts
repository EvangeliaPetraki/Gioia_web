import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** The Better Auth session user attached to the request by AuthGuard/AdminGuard. */
export interface SessionUser {
  id: string;
  role?: string | null;
  email?: string;
  name?: string;
}

/** Injects the authenticated user (requires AuthGuard/AdminGuard on the route). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser =>
    (ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>().user ?? {
      id: "",
    }) as SessionUser,
);

/** A view of the current user for ownership checks. */
export interface Viewer {
  id: string;
  isAdmin: boolean;
}

/** Build a Viewer from the session user. */
export const toViewer = (user: SessionUser): Viewer => ({
  id: user.id,
  isAdmin: user.role === "admin",
});
