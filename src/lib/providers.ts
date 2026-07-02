/**
 * Auth.js providers with Google enabled.
 *
 * This file is shipped by the `auth-google` module and overlays the base
 * `providers.ts` from `auth-email` (it is copied afterwards, so it wins). It
 * keeps the env-gated Resend magic-link provider and adds Google, whose
 * credentials come from the env vars the scaffolder writes to `.env.example`.
 */
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";

export const providers: Provider[] = [
  Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }),
];

if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
  providers.push(
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    }),
  );
}
