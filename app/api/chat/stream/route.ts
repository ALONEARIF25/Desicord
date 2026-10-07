import postgres from "postgres";

export const runtime = "nodejs";

const realtimeUrl = process.env.REALTIME_DB_URL ?? process.env.DB_URL?.replace("-pooler.", ".") ?? "";
const sql = postgres(realtimeUrl, { max: 1 });
const subscribers = new Set<{ serverId: string; controller: ReadableStreamDefaultController<Uint8Array> }>();
let listenerReady: Promise<void> | null = null;
const encoder = new TextEncoder();

function startListener() {
  if (listenerReady) return listenerReady;
  listenerReady = sql.listen("chat_messages", (payload) => {
    try {
      const event = JSON.parse(payload) as { serverId: string; message: object };
      const chunk = encoder.encode(`data: ${JSON.stringify(event.message)}\n\n`);
      for (const subscriber of subscribers) {
        if (subscriber.serverId === event.serverId) subscriber.controller.enqueue(chunk);
      }
    } catch (error) {
      console.error("Chat realtime event failed", error);
    }
  }).then(() => undefined).catch((error) => {
    listenerReady = null;
    throw error;
  });
  return listenerReady;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serverId = url.searchParams.get("serverId");
  const userId = url.searchParams.get("userId");
  if (!serverId) return Response.json({ error: "A server is required." }, { status: 400 });
  const [server] = await sql`
    SELECT s.access_mode AS "accessMode",
      EXISTS (
        SELECT 1 FROM chat_server_allowlist a
        WHERE a.server_id = s.id AND a.user_id = ${userId}::uuid
      ) AS allowed
    FROM chat_servers s WHERE s.id = ${serverId}
  `;
  if (!server) return Response.json({ error: "That room does not exist." }, { status: 404 });
  if (server.accessMode === "private" && !server.allowed) {
    return Response.json({ error: "You are not allowed to view this room." }, { status: 403 });
  }
  await startListener();

  let subscriber: { serverId: string; controller: ReadableStreamDefaultController<Uint8Array> };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = { serverId, controller };
      subscribers.add(subscriber);
      controller.enqueue(encoder.encode(": connected\n\n"));
      request.signal.addEventListener("abort", () => {
        subscribers.delete(subscriber);
        controller.close();
      }, { once: true });
    },
    cancel() {
      subscribers.delete(subscriber);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}
