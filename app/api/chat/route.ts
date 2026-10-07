import { randomUUID, scryptSync, timingSafeEqual } from "crypto";
import postgres from "postgres";
import { signAvatar } from "../../lib/avatar";

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
        id text PRIMARY KEY, name text NOT NULL, description text NOT NULL, accent text NOT NULL
      )
    `;
    await sql`ALTER TABLE chat_servers ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE chat_servers ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'public'`;
    await sql`UPDATE chat_servers SET access_mode = 'private' WHERE locked = true AND access_mode = 'public'`;
    await sql`
      CREATE TABLE IF NOT EXISTS chat_server_allowlist (
        server_id text REFERENCES chat_servers(id) ON DELETE CASCADE,
        user_id uuid REFERENCES chat_users(id) ON DELETE CASCADE,
        PRIMARY KEY (server_id, user_id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS chat_memberships (
        user_id uuid REFERENCES chat_users(id) ON DELETE CASCADE, server_id text REFERENCES chat_servers(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, server_id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id uuid PRIMARY KEY, server_id text REFERENCES chat_servers(id) ON DELETE CASCADE, user_id uuid REFERENCES chat_users(id) ON DELETE CASCADE,
        content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  })().catch((error) => {
    setupReady = null;
    throw error;
  });
  return setupReady;
}

function hashPassword(password: string) {
  const salt = randomUUID();
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function getUser(id: string) {
  const [user] = await sql`SELECT id, username, college_roll AS roll, bio, pfp FROM chat_users WHERE id = ${id}::uuid`;
  return user ? { ...user, pfp: await signAvatar(user.pfp) } : null;
}

export async function GET(request: Request) {
  try {
    await setup();
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const serverId = url.searchParams.get("serverId");
    const servers = await sql`SELECT id, name, description, accent, access_mode AS "accessMode" FROM chat_servers ORDER BY id`;
    const user = userId ? await getUser(userId) : null;
    const joined = user ? await sql`SELECT server_id AS id FROM chat_memberships WHERE user_id = ${userId}::uuid` : [];
    const allowedServers = userId
      ? await sql`SELECT server_id AS id FROM chat_server_allowlist WHERE user_id = ${userId}::uuid`
      : [];
    const allowedServerIds = new Set(allowedServers.map((server) => server.id));
    const accessibleServers = servers.map((server) => {
      const canRead = server.accessMode !== "private" || allowedServerIds.has(server.id);
      const canWrite = server.accessMode === "public" || allowedServerIds.has(server.id);
      return { ...server, canRead, canWrite };
    });
    const pageSize = 30;
    const before = url.searchParams.get("before");
    let members: { id: string; username: string; bio: string; pfp: string }[] = [];
    let messages: any[] = [];
    if (serverId) {
      const [server] = servers.filter((item) => item.id === serverId);
      const canRead = server && (server.accessMode !== "private" || allowedServerIds.has(serverId));
      if (!canRead) return Response.json({ error: "You are not allowed to view this room." }, { status: 403 });
      const memberRows = (server.accessMode === "private"
        ? await sql`
            SELECT u.id, u.username, u.bio, u.pfp
            FROM chat_server_allowlist a JOIN chat_users u ON u.id = a.user_id
            WHERE a.server_id = ${serverId} ORDER BY u.username
          `
        : await sql`SELECT id, username, bio, pfp FROM chat_users ORDER BY username`) as unknown as { id: string; username: string; bio: string; pfp: string }[];
      members = await Promise.all(memberRows.map(async (member) => ({ ...member, pfp: await signAvatar(member.pfp) })));
      messages = before
        ? await sql`
            SELECT m.id, m.content, m.created_at AS "createdAt", u.username, u.pfp
            FROM chat_messages m JOIN chat_users u ON u.id = m.user_id
            WHERE m.server_id = ${serverId} AND m.created_at < ${before}::timestamptz
            ORDER BY m.created_at DESC LIMIT ${pageSize + 1}
          `
        : await sql`
            SELECT m.id, m.content, m.created_at AS "createdAt", u.username, u.pfp
            FROM chat_messages m JOIN chat_users u ON u.id = m.user_id
            WHERE m.server_id = ${serverId}
            ORDER BY m.created_at DESC LIMIT ${pageSize + 1}
          `
          ;
      }
    const hasMore = messages.length > pageSize;
    const page = messages.slice(0, pageSize).reverse();
    const signedMessages = await Promise.all(page.map(async (message) => ({ ...message, pfp: await signAvatar(message.pfp) })));
    return Response.json({ servers: accessibleServers, user, joined: joined.map((item) => item.id), messages: signedMessages, members, hasMore });
  } catch (error) {
    console.error("Chat fetch failed", error);
    return Response.json({ error: "Could not load the chat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await setup();
    const body = await request.json() as Record<string, string>;
    const action = body.action;

    if (action === "register") {
      const username = body.username?.trim().slice(0, 24);
      const password = body.password ?? "";
      const roll = body.roll?.trim().slice(0, 40);
      if (!username || password.length < 6 || !roll) return Response.json({ error: "Add a username, a 6 character password, and your college roll." }, { status: 400 });
      const [user] = await sql`
        INSERT INTO chat_users (id, username, password_hash, college_roll, pfp) VALUES (${randomUUID()}, ${username}, ${hashPassword(password)}, ${roll}, ${username[0].toUpperCase()})
        RETURNING id
      `;
      return Response.json({ userId: user.id }, { status: 201 });
    }

    if (action === "login") {
      const [user] = await sql`SELECT id, password_hash FROM chat_users WHERE username = ${body.username?.trim()}`;
      if (!user || !checkPassword(body.password ?? "", user.password_hash)) return Response.json({ error: "That username or password is not right." }, { status: 401 });
      return Response.json({ userId: user.id });
    }

    if (action === "join") {
      const [server] = await sql`SELECT access_mode AS "accessMode" FROM chat_servers WHERE id = ${body.serverId}`;
      if (!server) return Response.json({ error: "That room does not exist." }, { status: 404 });
      if (server.accessMode === "private") {
        const [allowed] = await sql`SELECT 1 FROM chat_server_allowlist WHERE server_id = ${body.serverId} AND user_id = ${body.userId}::uuid`;
        if (!allowed) return Response.json({ error: "You are not allowed into this room." }, { status: 403 });
      }
      await sql`INSERT INTO chat_memberships (user_id, server_id) VALUES (${body.userId}::uuid, ${body.serverId}) ON CONFLICT DO NOTHING`;
      return Response.json({ ok: true });
    }

    if (action === "send") {
      const content = body.content?.trim().slice(0, 1000);
      if (!content) return Response.json({ error: "Write a message first." }, { status: 400 });
      const [server] = await sql`SELECT access_mode AS "accessMode" FROM chat_servers WHERE id = ${body.serverId}`;
      if (!server) return Response.json({ error: "That room does not exist." }, { status: 404 });
      if (server.accessMode !== "public") {
        const [allowed] = await sql`SELECT 1 FROM chat_server_allowlist WHERE server_id = ${body.serverId} AND user_id = ${body.userId}::uuid`;
        if (!allowed) return Response.json({ error: "You are not allowed to message in this room." }, { status: 403 });
      }
      const [message] = await sql`
        WITH inserted AS (
          INSERT INTO chat_messages (id, server_id, user_id, content)
          VALUES (${randomUUID()}, ${body.serverId}, ${body.userId}::uuid, ${content})
          RETURNING id, content, created_at, user_id
        )
        SELECT inserted.id, inserted.content, inserted.created_at AS "createdAt", users.username, users.pfp
        FROM inserted JOIN chat_users users ON users.id = inserted.user_id
      `;
      const nextMessage = { id: message.id, content: message.content, createdAt: message.createdAt, username: message.username, pfp: await signAvatar(message.pfp) };
      await sql.notify("chat_messages", JSON.stringify({
        serverId: body.serverId,
        message: nextMessage,
      }));
      return Response.json({ ok: true, message: nextMessage }, { status: 201 });
    }

    if (action === "profile") {
      await sql`UPDATE chat_users SET bio = ${body.bio?.trim().slice(0, 160) ?? ""}, pfp = ${body.pfp?.trim().slice(0, 2).toUpperCase() || "N"} WHERE id = ${body.userId}::uuid`;
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("unique") ? "That username is already taken." : "Could not save that yet.";
    console.error("Chat action failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
