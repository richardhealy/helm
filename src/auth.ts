/**
 * Auth.js v5 entrypoint.
 *
 * Uses the Prisma adapter with database sessions (required by the email
 * magic-link flow and compatible with OAuth). Providers are assembled in
 * `@/lib/providers` so auth modules can extend the set without touching this
 * file.
 */
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { providers } from "@/lib/providers";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  pages: {
    signIn: "/signin",
  },
});
