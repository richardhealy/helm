import { subscribe } from "@/realtime/listen";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let cleanup: (() => Promise<void>) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      cleanup = await subscribe("vehicle_position", (payload) => {
        controller.enqueue(
          encoder.encode(`event: vehicle_position\ndata: ${payload}\n\n`),
        );
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (cleanup) await cleanup();
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
