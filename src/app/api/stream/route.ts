import { subscribe } from "@/realtime/listen";

export const dynamic = "force-dynamic";

const CHANNELS = ["vehicle_position", "route_updated"] as const;

export async function GET() {
  const encoder = new TextEncoder();
  let cleanups: Array<() => Promise<void>> = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      cleanups = await Promise.all(
        CHANNELS.map((channel) =>
          subscribe(channel, (payload) => {
            controller.enqueue(
              encoder.encode(`event: ${channel}\ndata: ${payload}\n\n`),
            );
          }),
        ),
      );
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      await Promise.all(cleanups.map((c) => c()));
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
