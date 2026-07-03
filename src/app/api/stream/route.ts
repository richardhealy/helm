import { subscribe } from "@/realtime/listen";

export const dynamic = "force-dynamic";

const CHANNELS = ["vehicle_position", "route_updated", "stop_status"] as const;

export async function GET() {
  const encoder = new TextEncoder();
  let cleanups: Array<() => Promise<void>> = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const teardown = async () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    await Promise.all(cleanups.map((c) => c()));
  };

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue only while the stream is open. A Postgres notification can
      // still fire between the client disconnecting and cleanup completing;
      // without this guard that throws "Controller is already closed" as an
      // uncaught exception and crashes the worker.
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          void teardown();
        }
      };

      cleanups = await Promise.all(
        CHANNELS.map((channel) =>
          subscribe(channel, (payload) =>
            safeEnqueue(encoder.encode(`event: ${channel}\ndata: ${payload}\n\n`)),
          ),
        ),
      );
      heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15000);
    },
    async cancel() {
      await teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
