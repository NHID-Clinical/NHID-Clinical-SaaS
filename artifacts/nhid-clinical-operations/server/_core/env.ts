export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

/**
 * Fails fast on configuration that must never fall back to a default.
 *
 * `JWT_SECRET` is the important one: it signs and verifies session cookies,
 * and an empty string is a perfectly valid HMAC key, so an unset value would
 * silently produce forgeable sessions rather than an error.
 */
export function assertRequiredEnv() {
  const missing: string[] = [];

  if (!ENV.cookieSecret || ENV.cookieSecret.length < 16) {
    missing.push("JWT_SECRET (must be set and at least 16 characters)");
  }
  if (!ENV.databaseUrl) {
    missing.push("DATABASE_URL");
  }

  if (missing.length) {
    throw new Error(
      `Refusing to start. Missing or invalid configuration:\n  - ${missing.join("\n  - ")}`
    );
  }
}
