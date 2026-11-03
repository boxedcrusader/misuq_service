import { ConfigService } from "@nestjs/config";

export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

export interface AuthConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

const MIN_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60; // short-lived: a leaked access token expires fast
const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

// Fails at boot, not at first login. Secrets get NO fallback value: a
// hardcoded default secret would silently make every token forgeable by
// anyone who has read this file. TTLs do get defaults -- a missing TTL is a
// tuning choice, not a security hole.
export function loadAuthConfig(config: ConfigService): AuthConfig {
  const accessSecret = requireSecret(config, "JWT_ACCESS_SECRET");
  const refreshSecret = requireSecret(config, "JWT_REFRESH_SECRET");
  if (accessSecret === refreshSecret) {
    // Separate secrets are what stop a refresh token being replayed as an
    // access token (and vice versa) even before the `typ` claim is checked.
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values");
  }

  return {
    accessSecret,
    refreshSecret,
    accessTtlSeconds: readTtl(config, "JWT_ACCESS_TTL_SECONDS", DEFAULT_ACCESS_TTL_SECONDS),
    refreshTtlSeconds: readTtl(config, "JWT_REFRESH_TTL_SECONDS", DEFAULT_REFRESH_TTL_SECONDS),
  };
}

function requireSecret(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${key} must be set to at least ${MIN_SECRET_LENGTH} characters ` +
        `(generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")`,
    );
  }
  return value;
}

function readTtl(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer number of seconds, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}
