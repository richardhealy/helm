/**
 * Delivery status rules shared by the server and the console. Kept free of
 * Prisma so client components can import it.
 */

/** A stop in one of these states is finished: it can't be reassigned or unassigned. */
export const FINAL_STATUSES = ["delivered", "failed"] as const;

export function isFinal(status: string): boolean {
  return (FINAL_STATUSES as readonly string[]).includes(status);
}
