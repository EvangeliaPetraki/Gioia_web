"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/** Browser client for the Better Auth API served by the Nest application. */
export const authClient = createAuthClient({
  baseURL: `${apiUrl}/auth`,
  plugins: [adminClient()],
});
