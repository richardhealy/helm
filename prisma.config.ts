import { config } from "dotenv";
// Prisma 7's CLI no longer auto-loads .env. Load .env.local first (Next.js's
// convention) then fall back to .env, so migrations use the same URL as the app.
config({ path: [".env.local", ".env"] });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
