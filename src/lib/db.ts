/**
 * Prisma 7 client singleton (driver-adapter pattern).
 *
 * The client is generated into `src/generated/prisma` by `prisma generate`, so
 * run that before typechecking or building. A single instance is reused across
 * hot reloads in development.
 */
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * True when Postgres refused a write because a foreign key points at a row
 * that does not exist (Prisma error P2003). Callers decide what the missing
 * row means, for example an unknown vehicle id.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}
