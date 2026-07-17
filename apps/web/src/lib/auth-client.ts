"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, usernameClient } from "better-auth/client/plugins";
import { API_URL } from "./api-url";

/** Browser client for the Better Auth API served by the Nest application. */
export const authClient = createAuthClient({
  baseURL: `${API_URL}/auth`,
  plugins: [adminClient(), usernameClient()],
});
