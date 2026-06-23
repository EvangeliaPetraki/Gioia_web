"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "./auth-client";

/**
 * Redirect to the login page when there is no Better Auth session. Returns
 * whether the session has been established so callers can defer protected work.
 */
export function useRequireAuth(): boolean {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) router.replace("/");
  }, [isPending, router, session]);

  return !isPending && !!session;
}
