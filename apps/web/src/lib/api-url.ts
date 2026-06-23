const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const trimmedApiUrl = configuredApiUrl.replace(/\/+$/, "");

/**
 * The backend has Nest's global `/api` prefix. Accept either the Railway
 * origin or an origin already ending in `/api` to make deployment setup less
 * fragile.
 */
export const API_URL = trimmedApiUrl.endsWith("/api")
  ? trimmedApiUrl
  : `${trimmedApiUrl}/api`;
