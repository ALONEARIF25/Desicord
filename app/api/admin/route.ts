import { randomUUID } from "crypto";
import postgres from "postgres";

export const runtime = "nodejs";

const sql = postgres(process.env.DB_URL ?? "");
let setupReady: Promise<void> | null = null;

function setup() {
  if (setupReady) return setupReady;
  setupReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS chat_users (
        id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
        college_roll text NOT NULL, bio text NOT NULL DEFAULT '', pfp text NOT NULL DEFAULT 'N', created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS chat_servers (
        id text PRIMARY KEY, name text NOT NULL, description text NOT NULL, accent text NOT NULL,
        locked boolean NOT NULL DEFAULT false
      )
    `;
    await sql`ALTER TABLE chat_servers ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE chat_servers ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'public'`;
    await sql`UPDATE chat_servers SET access_mode = 'private' WHERE locked = true AND access_mode = 'public'`;
    await sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id uuid PRIMARY KEY, server_id text REFERENCES chat_servers(id) ON DELETE CASCADE,
        user_id uuid REFERENCES chat_users(id) ON DELETE CASCADE, content text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS chat_server_allowlist (
        server_id text REFERENCES chat_servers(id) ON DELETE CASCADE,
        user_id uuid REFERENCES chat_users(id) ON DELETE CASCADE,
        PRIMARY KEY (server_id, user_id)
      )
    `;
  })().catch((error) => {
    setupReady = null;
    throw error;
  });
  return setupReady;
}

function configuredAdmins() {
  return new Set(
    (process.env.ADMIN_USERNAMES ?? "")
      .split(",")
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function isAdmin(userId: string | null) {
  if (!userId || configuredAdmins().size === 0) return false;
  const [user] = await sql`SELECT username FROM chat_users WHERE id = ${userId}::uuid`;
  return Boolean(user && configuredAdmins().has(user.username.toLowerCase()));
}

async function requireAdmin(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!(await isAdmin(userId))) return null;
  return userId;
}

async function allowUsers(serverId: string, usernames: string[]) {
  await sql`DELETE FROM chat_server_allowlist WHERE server_id = ${serverId}`;
  if (!usernames.length) return;
  const users = await sql`
    SELECT id, username FROM chat_users
    WHERE lower(username) = ANY(${sql.array(usernames.map((username) => username.toLowerCase()))}::text[])
  `;
  await Promise.all(
    users.map((user) => sql`
      INSERT INTO chat_server_allowlist (server_id, user_id)
      VALUES (${serverId}, ${user.id}) ON CONFLICT DO NOTHING
    `),
  );
}

export async function GET(request: Request) {
  try {
    await setup();
    if (!(await requireAdmin(request))) {
      return Response.json({ error: "Admin access is required." }, { status: 403 });
    }
    const servers = await sql`
      SELECT s.id, s.name, s.description, s.accent, s.access_mode AS "accessMode",
        (SELECT count(*)::int FROM chat_messages m WHERE m.server_id = s.id) AS "messageCount"
      FROM chat_servers s ORDER BY s.name
    `;
    const serverDetails = await Promise.all(
      servers.map(async (server) => {
        const allowed = await sql`
          SELECT u.username FROM chat_server_allowlist a
          JOIN chat_users u ON u.id = a.user_id
          WHERE a.server_id = ${server.id} ORDER BY u.username
        `;
        return { ...server, allowedUsernames: allowed.map((user) => user.username) };
      }),
    );
    const users = await sql`
      SELECT u.id, u.username, u.college_roll AS roll, u.bio, u.pfp, u.created_at AS "createdAt",
        (SELECT count(*)::int FROM chat_messages m WHERE m.user_id = u.id) AS "messageCount"
      FROM chat_users u ORDER BY u.username
    `;
    return Response.json({ servers: serverDetails, users });
  } catch (error) {
    console.error("Admin fetch failed", error);
    return Response.json({ error: "Could not load admin data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await setup();
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId : null;
    if (!(await isAdmin(userId))) {
      return Response.json({ error: "Admin access is required." }, { status: 403 });
    }

    const action = typeof body.action === "string" ? body.action : "";
    const serverId = typeof body.serverId === "string" ? body.serverId : "";
    const usernames = Array.isArray(body.allowedUsernames)
      ? body.allowedUsernames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (action === "createServer") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 160) : "";
      const accent = typeof body.accent === "string" ? body.accent : "#d5f05f";
      const accessMode = body.accessMode === "read-only" || body.accessMode === "private" ? body.accessMode : "public";
      const requestedId = typeof body.id === "string" ? body.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) : "";
      const id = requestedId || `room-${randomUUID().slice(0, 8)}`;
      if (!name) return Response.json({ error: "A room name is required." }, { status: 400 });
      await sql`
        INSERT INTO chat_servers (id, name, description, accent, access_mode, locked)
        VALUES (${id}, ${name}, ${description}, ${accent}, ${accessMode}, ${accessMode === "private"})
      `;
      await allowUsers(id, usernames);
      return Response.json({ ok: true });
    }

    if (action === "updateServer") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 160) : "";
      const accent = typeof body.accent === "string" ? body.accent : "#d5f05f";
      const accessMode = body.accessMode === "read-only" || body.accessMode === "private" ? body.accessMode : "public";
      if (!serverId || !name) return Response.json({ error: "A room and name are required." }, { status: 400 });
      await sql`
        UPDATE chat_servers SET name = ${name}, description = ${description}, accent = ${accent}, access_mode = ${accessMode}, locked = ${accessMode === "private"}
        WHERE id = ${serverId}
      `;
      await allowUsers(serverId, usernames);
      return Response.json({ ok: true });
    }

    if (action === "deleteServer") {
      await sql`DELETE FROM chat_servers WHERE id = ${serverId}`;
      return Response.json({ ok: true });
    }

    if (action === "deleteServerMessages") {
      await sql`DELETE FROM chat_messages WHERE server_id = ${serverId}`;
      return Response.json({ ok: true });
    }

    if (action === "deleteMessagesByDate") {
      const from = typeof body.from === "string" ? body.from : "";
      const to = typeof body.to === "string" ? body.to : "";
      if (!serverId || !from || !to) return Response.json({ error: "Choose a room and both dates." }, { status: 400 });
      await sql`
        DELETE FROM chat_messages
        WHERE server_id = ${serverId}
          AND created_at >= ${from}::timestamptz
          AND created_at <= ${to}::timestamptz
      `;
      return Response.json({ ok: true });
    }

    if (action === "deleteUser") {
      const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : "";
      if (!targetUserId || targetUserId === userId) return Response.json({ error: "You cannot delete the current admin user." }, { status: 400 });
      await sql`DELETE FROM chat_users WHERE id = ${targetUserId}::uuid`;
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown admin action." }, { status: 400 });
  } catch (error) {
    console.error("Admin action failed", error);
    const message = error instanceof Error && error.message.includes("duplicate")
      ? "That room ID already exists."
      : "Could not complete that admin action.";
    return Response.json({ error: message }, { status: 500 });
  }
}
