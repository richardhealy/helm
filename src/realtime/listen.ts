import { Client } from "pg";

/**
 * Open a dedicated Postgres connection that LISTENs on `channel` and calls
 * `onPayload` for each notification. Returns a cleanup function that stops
 * listening and closes the connection.
 *
 * A dedicated client (not the Prisma pool) is required: LISTEN binds to a
 * single physical connection for the life of the subscription.
 */
export async function subscribe(
  channel: string,
  onPayload: (payload: string) => void,
): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  client.on("notification", (msg) => {
    if (msg.channel === channel && msg.payload) onPayload(msg.payload);
  });
  await client.query(`LISTEN ${channel}`);

  return async () => {
    try {
      await client.query(`UNLISTEN ${channel}`);
    } finally {
      await client.end();
    }
  };
}
