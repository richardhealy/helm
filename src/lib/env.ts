/**
 * Minimal, dependency-free env access.
 *
 * Values that are always present have sane defaults; secrets are read lazily
 * through getters so a bare scaffold still imports and builds even before
 * `.env.local` is filled in. Access throws only at the point of use.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  isProduction: process.env.NODE_ENV === "production",

  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get authSecret(): string {
    return required("AUTH_SECRET");
  },
} as const;
